const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { ThermalPrinter, PrinterTypes } = require('node-thermal-printer');

let mainWindow;
let db;
const dbDir = app.getPath('userData');
const dbPath = path.join(dbDir, 'technologies_soft.db');
const backupDir = path.join(dbDir, 'backups');
const logsDir = path.join(dbDir, 'logs');
const imagesDir = path.join(dbDir, 'product-images');

if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
if (!fs.existsSync(imagesDir)) fs.mkdirSync(imagesDir, { recursive: true });

// ========== تهيئة قاعدة البيانات ==========
function initializeDatabase() {
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');

    const createTables = `
        CREATE TABLE IF NOT EXISTS companies (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            phone TEXT,
            address TEXT,
            tax_number TEXT,
            tax_rate REAL DEFAULT 0,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            full_name TEXT,
            username TEXT UNIQUE,
            password_hash TEXT,
            role TEXT DEFAULT 'cashier',
            is_blocked INTEGER DEFAULT 0,
            failed_attempts INTEGER DEFAULT 0,
            locked_until DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS permissions (
            user_id INTEGER PRIMARY KEY,
            can_edit_products INTEGER DEFAULT 0,
            can_edit_prices INTEGER DEFAULT 0,
            can_edit_users INTEGER DEFAULT 0,
            can_view_reports INTEGER DEFAULT 0,
            can_close_shift INTEGER DEFAULT 0,
            can_refund INTEGER DEFAULT 0,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            name TEXT,
            FOREIGN KEY(company_id) REFERENCES companies(id)
        );
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            name TEXT,
            category_id INTEGER,
            price REAL,
            cost REAL DEFAULT 0,
            barcode TEXT,
            recipe TEXT,
            image TEXT,
            unit TEXT DEFAULT 'قطعة',
            is_active INTEGER DEFAULT 1,
            daily_forecast INTEGER DEFAULT 0,
            monthly_forecast INTEGER DEFAULT 0,
            FOREIGN KEY(company_id) REFERENCES companies(id),
            FOREIGN KEY(category_id) REFERENCES categories(id)
        );
        CREATE TABLE IF NOT EXISTS raw_materials (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            name TEXT,
            unit TEXT,
            current_stock REAL DEFAULT 0,
            min_stock REAL DEFAULT 0,
            purchase_price REAL DEFAULT 0,
            FOREIGN KEY(company_id) REFERENCES companies(id)
        );
        CREATE TABLE IF NOT EXISTS tables (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            name TEXT,
            status TEXT DEFAULT 'free',
            FOREIGN KEY(company_id) REFERENCES companies(id)
        );
        CREATE TABLE IF NOT EXISTS waiters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            name TEXT,
            user_id INTEGER,
            FOREIGN KEY(company_id) REFERENCES companies(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS shifts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            user_id INTEGER,
            opening_cash REAL,
            closing_cash REAL,
            expected_cash REAL,
            cash_difference REAL,
            date TEXT,
            status TEXT DEFAULT 'open',
            closed_at DATETIME,
            FOREIGN KEY(company_id) REFERENCES companies(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            table_id INTEGER,
            waiter_id INTEGER,
            user_id INTEGER,
            total REAL,
            tax REAL DEFAULT 0,
            total_with_tax REAL,
            discount REAL DEFAULT 0,
            payment_method TEXT DEFAULT 'cash',
            paid_amount REAL,
            change_amount REAL,
            date TEXT,
            time TEXT,
            shift_id INTEGER,
            status TEXT DEFAULT 'completed',
            order_type TEXT DEFAULT 'dine_in',
            FOREIGN KEY(company_id) REFERENCES companies(id),
            FOREIGN KEY(table_id) REFERENCES tables(id),
            FOREIGN KEY(waiter_id) REFERENCES waiters(id),
            FOREIGN KEY(user_id) REFERENCES users(id),
            FOREIGN KEY(shift_id) REFERENCES shifts(id)
        );
        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER,
            product_id INTEGER,
            qty INTEGER,
            price REAL,
            FOREIGN KEY(order_id) REFERENCES orders(id),
            FOREIGN KEY(product_id) REFERENCES products(id)
        );
        CREATE TABLE IF NOT EXISTS refunds (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id INTEGER,
            user_id INTEGER,
            amount REAL,
            reason TEXT,
            date TEXT,
            FOREIGN KEY(order_id) REFERENCES orders(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS inventory_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            material_id INTEGER,
            qty_change REAL,
            type TEXT,
            reference TEXT,
            date TEXT,
            user_id INTEGER,
            FOREIGN KEY(company_id) REFERENCES companies(id),
            FOREIGN KEY(material_id) REFERENCES raw_materials(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS expenses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            company_id INTEGER,
            month TEXT,
            category TEXT,
            description TEXT,
            amount REAL,
            type TEXT DEFAULT 'fixed',
            date TEXT,
            user_id INTEGER,
            FOREIGN KEY(company_id) REFERENCES companies(id),
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT,
            details TEXT,
            ip TEXT,
            date DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(user_id) REFERENCES users(id)
        );
        CREATE TABLE IF NOT EXISTS settings (
            company_id INTEGER PRIMARY KEY,
            safe_mode INTEGER DEFAULT 0,
            currency TEXT DEFAULT 'SAR',
            pagination INTEGER DEFAULT 20,
            show_company_screen INTEGER DEFAULT 1,
            profit_margin_percent REAL DEFAULT 30,
            FOREIGN KEY(company_id) REFERENCES companies(id)
        );
    `;
    db.exec(createTables);

    // ترقية تلقائية لقواعد بيانات قديمة قد لا تحتوي بعض الأعمدة
    safeAddColumn('orders', 'order_type', "TEXT DEFAULT 'dine_in'");
    safeAddColumn('users', 'failed_attempts', 'INTEGER DEFAULT 0');
    safeAddColumn('users', 'locked_until', 'DATETIME');
    safeAddColumn('products', 'is_active', 'INTEGER DEFAULT 1');

    try {
        db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_date_type ON orders(date, order_type);`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_products_company ON products(company_id);`);
        db.exec(`CREATE INDEX IF NOT EXISTS idx_orders_company_date ON orders(company_id, date);`);
    } catch (e) { /* الفهارس موجودة مسبقاً */ }

    seedDefaultData();
}

function safeAddColumn(table, column, definition) {
    try {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all();
        const exists = cols.some(c => c.name === column);
        if (!exists) {
            db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
        }
    } catch (e) {
        console.error(`فشل تحديث جدول ${table}.${column}:`, e.message);
    }
}

function seedDefaultData() {
    const row = db.prepare("SELECT COUNT(*) as count FROM companies").get();
    if (row && row.count > 0) return;

    const companyId = 1;
    db.prepare("INSERT INTO companies (id, name, phone, address, tax_rate) VALUES (?, ?, ?, ?, ?)")
      .run(companyId, 'مطعم تقنيات سوفت', '773579486', 'اليمن - صنعاء', 0);

    // كلمات مرور افتراضية مختلفة لكل دور (وليست متطابقة) — يجب تغييرها فوراً بعد أول دخول
    const defaultPasswords = {
        admin: 'Admin@2026',
        accountant: 'Acc@2026',
        cashier: 'Cash@2026'
    };

    const hashAdmin = bcrypt.hashSync(defaultPasswords.admin, 10);
    db.prepare("INSERT INTO users (id, company_id, full_name, username, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)")
      .run(1, companyId, 'المدير العام', 'admin', hashAdmin, 'admin');
    db.prepare("INSERT INTO permissions (user_id, can_edit_products, can_edit_prices, can_edit_users, can_view_reports, can_close_shift, can_refund) VALUES (?,1,1,1,1,1,1)")
      .run(1);

    const hashAcc = bcrypt.hashSync(defaultPasswords.accountant, 10);
    const accResult = db.prepare("INSERT INTO users (company_id, full_name, username, password_hash, role) VALUES (?, ?, ?, ?, ?)")
      .run(companyId, 'المحاسب', 'accountant', hashAcc, 'accountant');
    db.prepare("INSERT INTO permissions (user_id, can_edit_products, can_edit_prices, can_edit_users, can_view_reports, can_close_shift, can_refund) VALUES (?,0,0,0,1,1,0)")
      .run(accResult.lastInsertRowid);

    const hashCash = bcrypt.hashSync(defaultPasswords.cashier, 10);
    const cashResult = db.prepare("INSERT INTO users (company_id, full_name, username, password_hash, role) VALUES (?, ?, ?, ?, ?)")
      .run(companyId, 'الكاشير', 'cashier', hashCash, 'cashier');
    db.prepare("INSERT INTO permissions (user_id, can_edit_products, can_edit_prices, can_edit_users, can_view_reports, can_close_shift, can_refund) VALUES (?,0,0,0,0,0,0)")
      .run(cashResult.lastInsertRowid);

    db.prepare("INSERT INTO settings (company_id) VALUES (?)").run(companyId);

    const categories = ['أكلات شعبية', 'غداء', 'المعصوب', 'مشروبات'];
    for (const cat of categories) {
        db.prepare("INSERT INTO categories (company_id, name) VALUES (?,?)").run(companyId, cat);
    }

    // نكتب بيانات الدخول الافتراضية في ملف نصي محلي بدل كتابتها كنص ثابت يقرأه الجميع في الكود
    try {
        const credsFile = path.join(dbDir, 'بيانات_الدخول_الافتراضية.txt');
        const content =
`بيانات الدخول الافتراضية - يجب تغييرها فوراً بعد أول دخول

مدير عام:  admin / ${defaultPasswords.admin}
محاسب:     accountant / ${defaultPasswords.accountant}
كاشير:     cashier / ${defaultPasswords.cashier}

تنبيه: احذف هذا الملف بعد تغيير كلمات المرور.`;
        fs.writeFileSync(credsFile, content, 'utf8');
    } catch (e) { /* ليس حرجاً */ }
}

// ========== نافذة التطبيق ==========
function createWindow() {
    const iconPath = path.join(__dirname, 'assets', 'icon.ico');
    const windowOptions = {
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 720,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        }
    };
    // الأيقونة اختيارية: لا نكسر التشغيل إذا لم يوجد ملف assets/icon.ico بعد
    if (fs.existsSync(iconPath)) {
        windowOptions.icon = iconPath;
    }
    mainWindow = new BrowserWindow(windowOptions);
    mainWindow.loadFile('index.html');
    mainWindow.setMenuBarVisibility(false);
}

app.whenReady().then(() => {
    try {
        initializeDatabase();
    } catch (e) {
        dialog.showErrorBox('خطأ في قاعدة البيانات', 'فشل تهيئة قاعدة البيانات: ' + e.message);
        app.quit();
        return;
    }
    createWindow();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        if (db) db.close();
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ========== أدوات مساعدة ==========
function logAudit(userId, action, details) {
    try {
        db.prepare("INSERT INTO audit_log (user_id, action, details) VALUES (?,?,?)")
          .run(userId, action, details);
    } catch (e) { /* لا نوقف العملية بسبب فشل تسجيل التدقيق */ }
}

function backupDatabase() {
    const backupFile = path.join(backupDir, `backup_${new Date().toISOString().slice(0,10)}_${Date.now()}.db`);
    try {
        fs.copyFileSync(dbPath, backupFile);
        const files = fs.readdirSync(backupDir)
            .filter(f => f.startsWith('backup_') && f.endsWith('.db'))
            .map(f => ({
                name: f,
                path: path.join(backupDir, f),
                mtime: fs.statSync(path.join(backupDir, f)).mtimeMs
            }))
            .sort((a, b) => b.mtime - a.mtime);

        if (files.length > 7) {
            files.slice(7).forEach(f => {
                try { fs.unlinkSync(f.path); } catch (e) { /* تجاهل */ }
            });
        }
        return { success: true, path: backupFile };
    } catch (e) {
        console.error('فشل النسخ الاحتياطي:', e);
        return { success: false, error: e.message };
    }
}

function dbAll(sql, params = []) {
    try {
        return Promise.resolve(db.prepare(sql).all(...params));
    } catch (err) {
        return Promise.reject(err);
    }
}
function dbGet(sql, params = []) {
    try {
        return Promise.resolve(db.prepare(sql).get(...params));
    } catch (err) {
        return Promise.reject(err);
    }
}
function dbRun(sql, params = []) {
    try {
        const info = db.prepare(sql).run(...params);
        return Promise.resolve({ changes: info.changes, lastInsertRowid: info.lastInsertRowid });
    } catch (err) {
        return Promise.reject(err);
    }
}

// قائمة بيضاء لمنع استخدام db-query/db-run/db-get كقناة لتنفيذ أي SQL خطير من الواجهة
// (طبقة دفاع إضافية حتى لو تم استغلال ثغرة XSS بسيطة في الواجهة)
const ALLOWED_TABLES = ['companies','users','permissions','categories','products','raw_materials',
    'tables','waiters','shifts','orders','order_items','refunds','inventory_transactions',
    'expenses','audit_log','settings'];

function isSelectSafe(sql) {
    const trimmed = sql.trim().toUpperCase();
    if (!trimmed.startsWith('SELECT')) return false;
    if (trimmed.includes('ATTACH') || trimmed.includes('PRAGMA') || trimmed.includes(';--')) return false;
    return true;
}

// ========== IPC: قاعدة البيانات (محصورة بعمليات SELECT فقط عبر db-query/db-get) ==========
ipcMain.handle('db-query', (event, sql, params) => {
    if (!isSelectSafe(sql)) return Promise.reject(new Error('استعلام غير مسموح'));
    return dbAll(sql, params);
});
ipcMain.handle('db-get', (event, sql, params) => {
    if (!isSelectSafe(sql)) return Promise.reject(new Error('استعلام غير مسموح'));
    return dbGet(sql, params);
});
// db-run يُستخدم فقط داخلياً من عمليات محددة؛ نسمح به فقط لتحديث حالة الطاولة (الاستخدام الوحيد المتبقي في الواجهة)
ipcMain.handle('db-run', (event, sql, params) => {
    const trimmed = sql.trim().toUpperCase();
    const allowedPatterns = [
        /^UPDATE TABLES SET STATUS=.* WHERE ID=\?$/i
    ];
    const isAllowed = allowedPatterns.some(p => p.test(sql.trim()));
    if (!isAllowed) return Promise.reject(new Error('عملية تعديل غير مسموحة عبر هذه القناة'));
    return dbRun(sql, params);
});

// ========== IPC: المصادقة والمستخدمين ==========
const MAX_LOGIN_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

ipcMain.handle('login', async (event, { username, password }) => {
    const user = await dbGet("SELECT * FROM users WHERE username=?", [username]);
    if (!user) return { success: false, error: 'اسم المستخدم غير موجود' };
    if (user.is_blocked) return { success: false, error: 'هذا الحساب محظور' };

    if (user.locked_until && new Date(user.locked_until) > new Date()) {
        const remaining = Math.ceil((new Date(user.locked_until) - new Date()) / 60000);
        return { success: false, error: `الحساب مقفل مؤقتاً. حاول بعد ${remaining} دقيقة` };
    }

    const valid = bcrypt.compareSync(password, user.password_hash);
    if (!valid) {
        const attempts = (user.failed_attempts || 0) + 1;
        if (attempts >= MAX_LOGIN_ATTEMPTS) {
            const lockUntil = new Date(Date.now() + LOCK_MINUTES * 60000).toISOString();
            await dbRun("UPDATE users SET failed_attempts=0, locked_until=? WHERE id=?", [lockUntil, user.id]);
            logAudit(user.id, 'account_locked', `قفل الحساب بعد ${attempts} محاولات فاشلة`);
            return { success: false, error: `تم قفل الحساب لمدة ${LOCK_MINUTES} دقيقة بسبب محاولات خاطئة متكررة` };
        }
        await dbRun("UPDATE users SET failed_attempts=? WHERE id=?", [attempts, user.id]);
        return { success: false, error: 'كلمة المرور خاطئة' };
    }

    await dbRun("UPDATE users SET failed_attempts=0, locked_until=NULL WHERE id=?", [user.id]);
    const perms = await dbGet("SELECT * FROM permissions WHERE user_id=?", [user.id]) || {};
    logAudit(user.id, 'login', 'تسجيل دخول');
    const { password_hash, ...safeUser } = user;
    return { success: true, user: { ...safeUser, permissions: perms } };
});

ipcMain.handle('create-user', async (event, data) => {
    const { company_id, full_name, username, password, role, currentUserId } = data;
    const requester = await dbGet("SELECT role FROM users WHERE id=?", [currentUserId]);
    if (!requester || requester.role !== 'admin') {
        return { success: false, error: 'فقط المدير يستطيع إضافة مستخدمين' };
    }
    const existing = await dbGet("SELECT id FROM users WHERE username=?", [username]);
    if (existing) return { success: false, error: 'اسم المستخدم مستخدم مسبقاً' };
    if (!password || password.length < 6) return { success: false, error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' };

    const hash = bcrypt.hashSync(password, 10);
    const result = await dbRun(
        "INSERT INTO users (company_id, full_name, username, password_hash, role) VALUES (?,?,?,?,?)",
        [company_id, full_name, username, hash, role]
    );
    const perms = {
        admin: { can_edit_products: 1, can_edit_prices: 1, can_edit_users: 1, can_view_reports: 1, can_close_shift: 1, can_refund: 1 },
        accountant: { can_edit_products: 0, can_edit_prices: 0, can_edit_users: 0, can_view_reports: 1, can_close_shift: 1, can_refund: 0 },
        cashier: { can_edit_products: 0, can_edit_prices: 0, can_edit_users: 0, can_view_reports: 0, can_close_shift: 0, can_refund: 0 }
    };
    const p = perms[role] || perms.cashier;
    await dbRun(
        "INSERT INTO permissions (user_id, can_edit_products, can_edit_prices, can_edit_users, can_view_reports, can_close_shift, can_refund) VALUES (?,?,?,?,?,?,?)",
        [result.lastInsertRowid, p.can_edit_products, p.can_edit_prices, p.can_edit_users, p.can_view_reports, p.can_close_shift, p.can_refund]
    );
    logAudit(currentUserId, 'create_user', `إنشاء مستخدم: ${username}`);
    return { success: true, id: result.lastInsertRowid };
});

ipcMain.handle('update-user', async (event, data) => {
    const { id, full_name, username, password, role, currentUserId } = data;
    const requester = await dbGet("SELECT role FROM users WHERE id=?", [currentUserId]);
    if (!requester || (requester.role !== 'admin' && currentUserId !== id)) {
        return { success: false, error: 'ليس لديك صلاحية لتعديل هذا المستخدم' };
    }
    // مستخدم عادي يغيّر بيانات نفسه لا يستطيع تغيير دوره
    const finalRole = (requester.role === 'admin') ? role : (await dbGet("SELECT role FROM users WHERE id=?", [id])).role;

    if (password && password.length > 0) {
        if (password.length < 6) return { success: false, error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' };
        const hash = bcrypt.hashSync(password, 10);
        await dbRun("UPDATE users SET full_name=?, username=?, password_hash=?, role=? WHERE id=?",
            [full_name, username, hash, finalRole, id]);
    } else {
        await dbRun("UPDATE users SET full_name=?, username=?, role=? WHERE id=?",
            [full_name, username, finalRole, id]);
    }
    logAudit(currentUserId, 'update_user', `تحديث بيانات المستخدم: ${username}`);
    return { success: true };
});

ipcMain.handle('toggle-block', async (event, { userId, currentUserId }) => {
    if (userId === currentUserId) return { success: false, error: 'لا يمكنك حظر نفسك' };
    const requester = await dbGet("SELECT role FROM users WHERE id=?", [currentUserId]);
    if (!requester || requester.role !== 'admin') return { success: false, error: 'فقط المدير يملك هذه الصلاحية' };

    const user = await dbGet("SELECT is_blocked FROM users WHERE id=?", [userId]);
    if (!user) return { success: false, error: 'المستخدم غير موجود' };
    await dbRun("UPDATE users SET is_blocked=? WHERE id=?", [user.is_blocked ? 0 : 1, userId]);
    logAudit(currentUserId, 'toggle_block', `تغيير حالة الحظر للمستخدم #${userId}`);
    return { success: true };
});

// ========== IPC: الشركة والإعدادات ==========
ipcMain.handle('get-company', async () => {
    return await dbGet("SELECT * FROM companies LIMIT 1");
});

ipcMain.handle('update-company', async (event, data) => {
    const { name, phone, address, tax_number, tax_rate, userId } = data;
    if (!name || !name.trim()) return { success: false, error: 'اسم المطعم مطلوب' };
    await dbRun("UPDATE companies SET name=?, phone=?, address=?, tax_number=?, tax_rate=? WHERE id=1",
        [name, phone, address, tax_number, tax_rate || 0]);
    logAudit(userId, 'update_company', 'تعديل بيانات المطعم');
    return { success: true };
});

ipcMain.handle('get-tax-rate', async () => {
    const row = await dbGet("SELECT tax_rate FROM companies WHERE id=1");
    return row ? row.tax_rate : 0;
});

ipcMain.handle('get-settings', async (event, companyId) => {
    const row = await dbGet("SELECT * FROM settings WHERE company_id=?", [companyId]);
    return row || {};
});

ipcMain.handle('save-settings', async (event, { companyId, settings, userId }) => {
    await dbRun("UPDATE settings SET safe_mode=?, pagination=?, profit_margin_percent=? WHERE company_id=?",
        [settings.safe_mode || 0, settings.pagination || 20, settings.profit_margin_percent || 30, companyId]);
    logAudit(userId, 'save_settings', 'تعديل الإعدادات');
    return { success: true };
});

// ========== IPC: المنتجات ==========
ipcMain.handle('save-product', async (event, data) => {
    const { id, company_id, name, price, cost, category_id, barcode, recipe, unit, image, userId } = data;
    if (!name || !name.trim()) return { success: false, error: 'اسم المنتج مطلوب' };
    if (isNaN(price) || price < 0) return { success: false, error: 'سعر غير صالح' };

    if (id) {
        await dbRun("UPDATE products SET name=?, price=?, category_id=?, cost=?, barcode=?, recipe=?, unit=?, image=? WHERE id=? AND company_id=?",
            [name, price, category_id, cost || 0, barcode || null, recipe || null, unit, image, id, company_id]);
        logAudit(userId, 'edit_product', `تعديل منتج: ${name}`);
        return { success: true, id };
    } else {
        const result = await dbRun(
            "INSERT INTO products (company_id, name, price, category_id, cost, barcode, recipe, unit, image) VALUES (?,?,?,?,?,?,?,?,?)",
            [company_id, name, price, category_id, cost || 0, barcode || null, recipe || null, unit, image]
        );
        logAudit(userId, 'add_product', `إضافة منتج: ${name}`);
        return { success: true, id: result.lastInsertRowid };
    }
});

ipcMain.handle('delete-product', async (event, { id, company_id, userId }) => {
    await dbRun("DELETE FROM products WHERE id=? AND company_id=?", [id, company_id]);
    logAudit(userId, 'delete_product', `حذف منتج #${id}`);
    return { success: true };
});

// ========== IPC: الأقسام ==========
ipcMain.handle('save-category', async (event, { company_id, name, userId }) => {
    if (!name || !name.trim()) return { success: false, error: 'اسم القسم مطلوب' };
    const result = await dbRun("INSERT INTO categories (company_id, name) VALUES (?,?)", [company_id, name]);
    logAudit(userId, 'add_category', `إضافة قسم: ${name}`);
    return { success: true, id: result.lastInsertRowid };
});

ipcMain.handle('delete-category', async (event, { id, userId }) => {
    const inUse = await dbGet("SELECT COUNT(*) as c FROM products WHERE category_id=?", [id]);
    if (inUse && inUse.c > 0) {
        return { success: false, error: 'لا يمكن حذف قسم مرتبط بمنتجات. احذف أو نقل المنتجات أولاً' };
    }
    await dbRun("DELETE FROM categories WHERE id=?", [id]);
    logAudit(userId, 'delete_category', `حذف قسم #${id}`);
    return { success: true };
});

// ========== IPC: المواد الخام ==========
ipcMain.handle('save-material', async (event, data) => {
    const { id, company_id, name, unit, min_stock, purchase_price } = data;
    if (!name || !name.trim()) return { success: false, error: 'اسم المادة مطلوب' };
    if (id) {
        await dbRun("UPDATE raw_materials SET name=?, unit=?, min_stock=?, purchase_price=? WHERE id=? AND company_id=?",
            [name, unit, min_stock, purchase_price, id, company_id]);
        return { success: true, id };
    } else {
        const result = await dbRun(
            "INSERT INTO raw_materials (company_id, name, unit, min_stock, purchase_price) VALUES (?,?,?,?,?)",
            [company_id, name, unit, min_stock, purchase_price]
        );
        return { success: true, id: result.lastInsertRowid };
    }
});

ipcMain.handle('delete-material', async (event, { id, company_id }) => {
    await dbRun("DELETE FROM raw_materials WHERE id=? AND company_id=?", [id, company_id]);
    return { success: true };
});

ipcMain.handle('add-stock', async (event, { material_id, qty, userId }) => {
    if (isNaN(qty) || qty <= 0) return { success: false, error: 'كمية غير صالحة' };
    await dbRun("UPDATE raw_materials SET current_stock = current_stock + ? WHERE id=?", [qty, material_id]);
    const material = await dbGet("SELECT company_id FROM raw_materials WHERE id=?", [material_id]);
    await dbRun(
        "INSERT INTO inventory_transactions (company_id, material_id, qty_change, type, reference, date, user_id) VALUES (?,?,?,?,?,?,?)",
        [material ? material.company_id : null, material_id, qty, 'supply', 'توريد يدوي', new Date().toISOString().slice(0,10), userId]
    );
    logAudit(userId, 'add_stock', `توريد مادة #${material_id} بكمية ${qty}`);
    return { success: true };
});

// ========== IPC: الطاولات ==========
ipcMain.handle('save-table', async (event, { company_id, name }) => {
    if (!name || !name.trim()) return { success: false, error: 'اسم الطاولة مطلوب' };
    await dbRun("INSERT INTO tables (company_id, name) VALUES (?,?)", [company_id, name]);
    return { success: true };
});

ipcMain.handle('delete-table', async (event, { id }) => {
    await dbRun("DELETE FROM tables WHERE id=?", [id]);
    return { success: true };
});

// ========== IPC: الكباتن ==========
ipcMain.handle('save-waiter', async (event, { company_id, name }) => {
    if (!name || !name.trim()) return { success: false, error: 'اسم الكابتن مطلوب' };
    await dbRun("INSERT INTO waiters (company_id, name) VALUES (?,?)", [company_id, name]);
    return { success: true };
});

ipcMain.handle('delete-waiter', async (event, { id }) => {
    await dbRun("DELETE FROM waiters WHERE id=?", [id]);
    return { success: true };
});

// ========== IPC: الطلبات والوردية ==========
ipcMain.handle('create-order', async (event, data) => {
    const { company_id, table_id, waiter_id, user_id, total, tax, total_with_tax, discount, payment_method, paid_amount, shift_id, items, order_type } = data;
    if (!items || items.length === 0) return { success: false, error: 'لا توجد عناصر في الطلب' };

    const today = new Date().toISOString().slice(0,10);
    const time = new Date().toLocaleTimeString('ar-SA');

    const insertOrder = db.transaction(() => {
        const result = db.prepare(
            `INSERT INTO orders (company_id, table_id, waiter_id, user_id, total, tax, total_with_tax, discount, payment_method, paid_amount, date, time, shift_id, order_type)
             VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
        ).run(company_id, table_id, waiter_id, user_id, total, tax || 0, total_with_tax || total, discount || 0, payment_method, paid_amount, today, time, shift_id, order_type || 'dine_in');

        const orderId = result.lastInsertRowid;
        for (const item of items) {
            db.prepare("INSERT INTO order_items (order_id, product_id, qty, price) VALUES (?,?,?,?)")
              .run(orderId, item.id, item.qty, item.price);
            if (item.recipe) {
                try {
                    const recipe = JSON.parse(item.recipe);
                    for (const comp of recipe) {
                        db.prepare("UPDATE raw_materials SET current_stock = current_stock - ? WHERE id=? AND company_id=?")
                          .run(comp.qty * item.qty, comp.material_id, company_id);
                        db.prepare(
                            "INSERT INTO inventory_transactions (company_id, material_id, qty_change, type, reference, date, user_id) VALUES (?,?,?,?,?,?,?)"
                        ).run(company_id, comp.material_id, -comp.qty * item.qty, 'consumption', `طلب #${orderId}`, today, user_id);
                    }
                } catch (e) { /* وصفة غير صالحة، نتجاهل خصم المخزون لهذا العنصر */ }
            }
        }
        if (table_id) {
            db.prepare("UPDATE tables SET status='occupied' WHERE id=?").run(table_id);
        }
        return orderId;
    });

    try {
        const orderId = insertOrder();
        logAudit(user_id, 'create_order', `طلب #${orderId} بقيمة ${total}`);
        return { success: true, orderId };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('refund-order', async (event, { orderId, userId, reason }) => {
    const requester = await dbGet("SELECT role FROM users WHERE id=?", [userId]);
    const perms = await dbGet("SELECT can_refund FROM permissions WHERE user_id=?", [userId]);
    if (!perms || !perms.can_refund) return { success: false, error: 'ليس لديك صلاحية الإرجاع' };

    const order = await dbGet("SELECT * FROM orders WHERE id=?", [orderId]);
    if (!order) return { success: false, error: 'الطلب غير موجود' };
    if (order.status === 'refunded') return { success: false, error: 'الطلب مرتجع مسبقاً' };

    const refundTx = db.transaction(() => {
        const items = db.prepare("SELECT * FROM order_items WHERE order_id=?").all(orderId);
        for (const item of items) {
            const product = db.prepare("SELECT * FROM products WHERE id=?").get(item.product_id);
            if (product && product.recipe) {
                try {
                    const recipe = JSON.parse(product.recipe);
                    for (const comp of recipe) {
                        db.prepare("UPDATE raw_materials SET current_stock = current_stock + ? WHERE id=?")
                          .run(comp.qty * item.qty, comp.material_id);
                    }
                } catch (e) { /* تجاهل */ }
            }
        }
        db.prepare("UPDATE orders SET status='refunded' WHERE id=?").run(orderId);
        db.prepare("INSERT INTO refunds (order_id, user_id, amount, reason, date) VALUES (?,?,?,?,?)")
          .run(orderId, userId, order.total, reason, new Date().toISOString());
        if (order.table_id) {
            db.prepare("UPDATE tables SET status='free' WHERE id=?").run(order.table_id);
        }
    });

    try {
        refundTx();
        logAudit(userId, 'refund_order', `إرجاع طلب #${orderId} - السبب: ${reason}`);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

ipcMain.handle('open-shift', async (event, { company_id, user_id, opening_cash }) => {
    if (isNaN(opening_cash) || opening_cash < 0) return { success: false, error: 'رصيد افتتاحي غير صالح' };
    const today = new Date().toISOString().slice(0,10);
    const result = await dbRun(
        "INSERT INTO shifts (company_id, user_id, opening_cash, date, status) VALUES (?,?,?,?,?)",
        [company_id, user_id, opening_cash, today, 'open']
    );
    logAudit(user_id, 'open_shift', `فتح وردية #${result.lastInsertRowid} برصيد ${opening_cash}`);
    return { success: true, shiftId: result.lastInsertRowid };
});

ipcMain.handle('close-shift', async (event, { shiftId, actual_cash, userId }) => {
    const perms = await dbGet("SELECT can_close_shift FROM permissions WHERE user_id=?", [userId]);
    if (!perms || !perms.can_close_shift) return { success: false, error: 'ليس لديك صلاحية إغلاق الوردية' };

    const shift = await dbGet("SELECT * FROM shifts WHERE id=?", [shiftId]);
    if (!shift) return { success: false, error: 'الوردية غير موجودة' };
    if (shift.status !== 'open') return { success: false, error: 'الوردية مغلقة مسبقاً' };
    if (isNaN(actual_cash) || actual_cash < 0) return { success: false, error: 'قيمة الكاش غير صالحة' };

    const totalSales = await dbGet(
        "SELECT COALESCE(SUM(total_with_tax),0) as total FROM orders WHERE shift_id=? AND status='completed' AND payment_method='cash'",
        [shiftId]
    );
    const expected = shift.opening_cash + (totalSales ? totalSales.total : 0);
    const difference = actual_cash - expected;

    await dbRun("UPDATE shifts SET closing_cash=?, expected_cash=?, cash_difference=?, status='closed', closed_at=CURRENT_TIMESTAMP WHERE id=?",
        [actual_cash, expected, difference, shiftId]);
    backupDatabase();
    logAudit(userId, 'close_shift', `إغلاق وردية #${shiftId}، المتوقع: ${expected}، الفعلي: ${actual_cash}، الفارق: ${difference}`);
    return { success: true, expected, difference };
});

// ========== IPC: المصروفات ==========
ipcMain.handle('add-expense', async (event, data) => {
    const { company_id, month, category, description, amount, type, user_id } = data;
    if (!category || !category.trim()) return { success: false, error: 'الفئة مطلوبة' };
    if (isNaN(amount) || amount <= 0) return { success: false, error: 'مبلغ غير صالح' };
    await dbRun(
        "INSERT INTO expenses (company_id, month, category, description, amount, type, date, user_id) VALUES (?,?,?,?,?,?,?,?)",
        [company_id, month, category, description, amount, type, new Date().toISOString().slice(0,10), user_id]
    );
    logAudit(user_id, 'add_expense', `إضافة مصروف: ${description} بقيمة ${amount}`);
    return { success: true };
});

ipcMain.handle('delete-expense', async (event, { id, userId }) => {
    await dbRun("DELETE FROM expenses WHERE id=?", [id]);
    logAudit(userId, 'delete_expense', `حذف مصروف #${id}`);
    return { success: true };
});

// ========== IPC: التقارير ==========
ipcMain.handle('get-sales-report', async (event, { startDate, endDate, companyId }) => {
    return await dbAll(
        `SELECT date, order_type, COUNT(*) as count, SUM(total) as total, SUM(tax) as tax, SUM(total_with_tax) as total_with_tax,
         payment_method, SUM(paid_amount) as paid
         FROM orders WHERE company_id=? AND date BETWEEN ? AND ? AND status='completed'
         GROUP BY date, payment_method, order_type
         ORDER BY date`,
        [companyId, startDate, endDate]
    );
});

ipcMain.handle('get-profit-report', async (event, { startDate, endDate, companyId }) => {
    const orders = await dbAll(
        `SELECT o.id, o.total, oi.product_id, oi.qty, p.cost
         FROM orders o
         JOIN order_items oi ON o.id = oi.order_id
         JOIN products p ON oi.product_id = p.id
         WHERE o.company_id=? AND o.date BETWEEN ? AND ? AND o.status='completed'`,
        [companyId, startDate, endDate]
    );
    let totalCost = 0;
    const distinctOrders = new Set();
    for (const row of orders) {
        totalCost += (row.cost || 0) * row.qty;
        distinctOrders.add(row.id);
    }
    // نحسب إجمالي المبيعات من جدول orders مباشرة لتجنب التكرار بسبب JOIN مع order_items
    const salesTotalRow = await dbGet(
        "SELECT COALESCE(SUM(total),0) as total FROM orders WHERE company_id=? AND date BETWEEN ? AND ? AND status='completed'",
        [companyId, startDate, endDate]
    );
    const totalSales = salesTotalRow ? salesTotalRow.total : 0;
    const profit = totalSales - totalCost;
    return { totalSales, totalCost, profit };
});

ipcMain.handle('get-expense-report', async (event, { startDate, endDate, companyId }) => {
    return await dbAll(
        "SELECT category, SUM(amount) as total FROM expenses WHERE company_id=? AND date BETWEEN ? AND ? GROUP BY category",
        [companyId, startDate, endDate]
    );
});

// ========== IPC: الطباعة الحرارية ==========
ipcMain.handle('print-thermal', async (event, { html, userId }) => {
    try {
        const printer = new ThermalPrinter({
            type: PrinterTypes.EPSON,
            interface: process.env.THERMAL_PRINTER_INTERFACE || 'printer:auto',
            options: { timeout: 5000 }
        });
        const isConnected = await printer.isPrinterConnected().catch(() => false);
        if (!isConnected) {
            return { success: true, method: 'fallback', reason: 'no_printer_detected' };
        }
        await printer.raw(Buffer.from(html));
        logAudit(userId, 'print_receipt', 'طباعة فاتورة حرارية');
        return { success: true, method: 'thermal' };
    } catch (e) {
        console.warn('فشلت الطباعة الحرارية، استخدام نافذة الطباعة الاحتياطية:', e.message);
        return { success: true, method: 'fallback' };
    }
});

// ========== IPC: صور المنتجات ==========
ipcMain.handle('save-product-image', async (event, { fileName, buffer }) => {
    try {
        const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9_.-]/g, '_');
        const filePath = path.join(imagesDir, safeName);
        fs.writeFileSync(filePath, Buffer.from(buffer, 'base64'));
        return { success: true, imagePath: `product-images/${safeName}` };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('get-product-image', (event, imagePath) => {
    try {
        if (!imagePath) return { success: false };
        const fullPath = path.join(app.getPath('userData'), imagePath);
        if (fs.existsSync(fullPath)) {
            const buffer = fs.readFileSync(fullPath);
            return { success: true, buffer: buffer.toString('base64') };
        }
        return { success: false };
    } catch (e) {
        return { success: false };
    }
});

// يحوّل مسار صورة نسبي إلى file:// URL صحيح على كل من ويندوز/لينكس بدل بنائه يدوياً في الواجهة
ipcMain.handle('resolve-image-url', (event, imagePath) => {
    try {
        if (!imagePath) return null;
        const fullPath = path.join(app.getPath('userData'), imagePath);
        if (!fs.existsSync(fullPath)) return null;
        return require('url').pathToFileURL(fullPath).href;
    } catch (e) {
        return null;
    }
});

// ========== IPC: النسخ الاحتياطي ==========
ipcMain.handle('manual-backup', async () => {
    return backupDatabase();
});

// ========== IPC: سجل التدقيق ==========
ipcMain.handle('get-audit-log', async (event, { limit = 100 }) => {
    return await dbAll("SELECT * FROM audit_log ORDER BY date DESC LIMIT ?", [limit]);
});

// ========== IPC: متفرقات ==========
ipcMain.handle('get-user-data-path', () => {
    return app.getPath('userData');
});

ipcMain.handle('quit-app', () => {
    app.quit();
});

process.on('uncaughtException', (err) => {
    console.error('خطأ غير متوقع:', err);
});

console.log('✅ نظام تقنيات سوفت المطور جاهز (مع خاصية سفري/محلي)');
