// ========== استخدام واجهة API الآمنة المكشوفة من preload.js ==========
// بدلاً من require('electron') المباشر (غير آمن وممنوع الآن بسبب contextIsolation:true)
const api = window.api;

// ========== المتغيرات العامة ==========
let currentUser = null;
let currentCompany = null;
let currentShift = null;
let cart = [];
let totalSalesCash = 0;
let currentCategory = 'all';
let selectedPayment = 'cash';
let selectedOrderType = 'dine_in';
let currentShiftId = null;
let taxRate = 0;
let userDataPath = null;

let pendingOrderData = null;

// ========== أدوات مساعدة عامة ==========
function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showCustomConfirm(message) {
    return new Promise((resolve) => {
        const modalContent = document.getElementById('modal-content');
        modalContent.innerHTML = `
            <h3 style="margin-bottom:15px;">تأكيد</h3>
            <p style="margin-bottom:20px;">${escapeHtml(message)}</p>
            <button class="btn btn-danger" id="confirm-yes" style="width:48%;">نعم</button>
            <button class="btn btn-secondary" id="confirm-no" style="width:48%; float:left;">إلغاء</button>
        `;
        document.getElementById('modal').classList.add('active');
        document.getElementById('confirm-yes').onclick = () => { closeModal(); resolve(true); };
        document.getElementById('confirm-no').onclick = () => { closeModal(); resolve(false); };
    });
}

function showCustomPrompt(message, defaultValue = '') {
    return new Promise((resolve) => {
        const modalContent = document.getElementById('modal-content');
        modalContent.innerHTML = `
            <h3 style="margin-bottom:15px;">${escapeHtml(message)}</h3>
            <div class="form-group"><input type="number" step="0.01" id="prompt-input" value="${escapeHtml(defaultValue)}"></div>
            <button class="btn btn-primary" id="prompt-ok" style="width:48%;">تأكيد</button>
            <button class="btn btn-secondary" id="prompt-cancel" style="width:48%; float:left;">إلغاء</button>
        `;
        document.getElementById('modal').classList.add('active');
        const input = document.getElementById('prompt-input');
        input.focus();
        document.getElementById('prompt-ok').onclick = () => {
            const val = input.value;
            closeModal();
            resolve(val);
        };
        document.getElementById('prompt-cancel').onclick = () => { closeModal(); resolve(null); };
    });
}

// ========== تسجيل الدخول ==========
async function submitLogin() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    if (!username || !password) return alert('أدخل اسم المستخدم وكلمة المرور');

    const loginBtn = document.querySelector('#login-screen button.btn-primary');
    if (loginBtn) loginBtn.disabled = true;

    try {
        const result = await api.invoke('login', { username, password });
        if (!result.success) {
            alert(result.error || 'بيانات الدخول خاطئة');
            return;
        }
        currentUser = result.user;
        document.getElementById('current-user-display').innerText = currentUser.full_name;
        document.getElementById('user-role-badge').innerText =
            currentUser.role === 'admin' ? 'مدير' : currentUser.role === 'accountant' ? 'محاسب' : 'كاشير';

        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('app-main').style.display = 'flex';

        await loadCompanyData();
        const settings = await api.invoke('get-settings', currentCompany.id);
        window.appSettings = settings || {};

        await initUserDataPath();
        await openShiftIfNeeded();

        const passwordChangeKey = `pwd_changed_${currentUser.id}`;
        if (!localStorage.getItem(passwordChangeKey)) {
            setTimeout(async () => {
                const wantsChange = await showCustomConfirm('⚠️ تم تسجيل دخولك بكلمة المرور الافتراضية. هل تريد تغييرها الآن؟ (مُوصى به بشدة)');
                if (wantsChange) {
                    openPasswordModal();
                } else {
                    localStorage.setItem(passwordChangeKey, 'skipped');
                }
            }, 500);
        }

        if (!currentCompany.name || currentCompany.name === 'مطعم تقنيات سوفت' || taxRate === 0) {
            openCompanyModal();
        } else {
            switchTab('dashboard');
        }
    } catch (err) {
        alert('حدث خطأ أثناء تسجيل الدخول: ' + err.message);
    } finally {
        if (loginBtn) loginBtn.disabled = false;
    }
}

async function initUserDataPath() {
    userDataPath = await api.invoke('get-user-data-path');
}

async function loadCompanyData() {
    const company = await api.invoke('get-company');
    if (company) {
        currentCompany = company;
        taxRate = company.tax_rate || 0;
        document.title = `تقنيات سوفت - ${currentCompany.name}`;
    }
}

function openCompanyModal() {
    document.getElementById('company-name').value = currentCompany ? currentCompany.name : '';
    document.getElementById('company-phone').value = currentCompany ? (currentCompany.phone || '') : '';
    document.getElementById('company-address').value = currentCompany ? (currentCompany.address || '') : '';
    document.getElementById('company-tax').value = currentCompany ? (currentCompany.tax_number || '') : '';
    document.getElementById('company-tax-rate').value = currentCompany ? (currentCompany.tax_rate || 0) : 0;
    document.getElementById('company-modal').style.display = 'flex';
}

async function saveCompanyFromModal() {
    const name = document.getElementById('company-name').value.trim();
    const phone = document.getElementById('company-phone').value.trim();
    const address = document.getElementById('company-address').value.trim();
    const tax_number = document.getElementById('company-tax').value.trim();
    const tax_rate = parseFloat(document.getElementById('company-tax-rate').value) || 0;
    if (!name) { alert('اسم المطعم مطلوب'); return; }
    try {
        const result = await api.invoke('update-company', { name, phone, address, tax_number, tax_rate, userId: currentUser.id });
        if (!result.success) { alert('فشل الحفظ: ' + (result.error || '')); return; }
        currentCompany.name = name;
        currentCompany.phone = phone;
        currentCompany.address = address;
        currentCompany.tax_number = tax_number;
        currentCompany.tax_rate = tax_rate;
        taxRate = tax_rate;
        document.title = `تقنيات سوفت - ${name}`;
        document.getElementById('company-modal').style.display = 'none';
        alert(`تم حفظ بيانات المطعم ونسبة الضريبة: ${tax_rate}%`);
        switchTab('dashboard');
    } catch (err) {
        alert('فشل حفظ بيانات الشركة: ' + err.message);
    }
}

// ========== الوردية ==========
async function openShiftIfNeeded() {
    const today = new Date().toISOString().slice(0,10);
    try {
        const shift = await api.invoke('db-get',
            "SELECT * FROM shifts WHERE company_id=? AND date=? AND status='open' AND user_id=?",
            [currentCompany.id, today, currentUser.id]
        );
        if (shift) {
            currentShift = shift;
            currentShiftId = shift.id;
            const total = await api.invoke('db-get',
                "SELECT COALESCE(SUM(total_with_tax),0) as total FROM orders WHERE company_id=? AND date=? AND shift_id=? AND payment_method='cash' AND status='completed'",
                [currentCompany.id, today, currentShift.id]
            );
            totalSalesCash = total ? total.total : 0;
        } else {
            const opening = await showCustomPrompt('أدخل رصيد افتتاح الصندوق (ر.س):', '0');
            if (opening === null) {
                alert('يجب فتح وردية للمتابعة. سيتم إغلاق البرنامج.');
                await api.invoke('quit-app');
                return;
            }
            const openingCash = parseFloat(opening) || 0;
            const result = await api.invoke('open-shift', {
                company_id: currentCompany.id,
                user_id: currentUser.id,
                opening_cash: openingCash
            });
            if (result.success) {
                currentShiftId = result.shiftId;
                const newShift = await api.invoke('db-get', "SELECT * FROM shifts WHERE id=?", [result.shiftId]);
                currentShift = newShift;
            } else {
                alert('فشل فتح الوردية: ' + (result.error || ''));
            }
            totalSalesCash = 0;
        }
    } catch (err) {
        alert('خطأ في فتح الوردية: ' + err.message);
    }
}

// ========== التنقل بين الصفحات ==========
async function switchTab(tab) {
    const perms = currentUser.permissions || {};
    const restrictedTabs = {
        'users': perms.can_edit_users,
        'reports': perms.can_view_reports,
        'expenses': perms.can_view_reports,
        'audit': perms.can_view_reports
    };
    if (restrictedTabs[tab] !== undefined && !restrictedTabs[tab]) {
        alert('ليس لديك صلاحية للوصول إلى هذه الصفحة');
        return;
    }

    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const navBtn = document.querySelector(`.nav-btn[data-tab="${tab}"]`);
    if (navBtn) navBtn.classList.add('active');
    const main = document.getElementById('main-content');
    main.innerHTML = '<div style="text-align:center; padding:40px; color:#7f8c8d;">جارٍ التحميل...</div>';
    try {
        switch (tab) {
            case 'dashboard': await renderDashboard(); break;
            case 'pos': await renderPOS(); break;
            case 'products': await renderProducts(); break;
            case 'categories': await renderCategories(); break;
            case 'materials': await renderMaterials(); break;
            case 'tables': await renderTables(); break;
            case 'waiters': await renderWaiters(); break;
            case 'reports': await renderReports(); break;
            case 'expenses': await renderExpenses(); break;
            case 'audit': await renderAudit(); break;
            case 'users': await renderUsers(); break;
            case 'settings': await renderSettings(); break;
            default: main.innerHTML = '<div class="alert-warning">صفحة غير معروفة</div>';
        }
    } catch (err) {
        main.innerHTML = `<div class="alert-warning">حدث خطأ أثناء تحميل الصفحة: ${escapeHtml(err.message)}</div>`;
    }
}

// ========== لوحة التحكم ==========
async function renderDashboard() {
    const today = new Date().toISOString().slice(0,10);
    const orders = await api.invoke('db-query',
        "SELECT * FROM orders WHERE company_id=? AND date=? AND status='completed'", [currentCompany.id, today]
    );
    const totalSales = orders.reduce((s,o) => s + o.total, 0);
    const totalTax = orders.reduce((s,o) => s + (o.tax || 0), 0);
    const totalWithTax = orders.reduce((s,o) => s + (o.total_with_tax || o.total), 0);
    const lowStock = await api.invoke('db-query',
        "SELECT * FROM raw_materials WHERE company_id=? AND current_stock <= min_stock", [currentCompany.id]
    );
    const occupiedTables = await api.invoke('db-query',
        "SELECT COUNT(*) as cnt FROM tables WHERE company_id=? AND status='occupied'", [currentCompany.id]
    );
    const roleLabel = currentUser.role === 'admin' ? 'مدير' : currentUser.role === 'accountant' ? 'محاسب' : 'كاشير';

    document.getElementById('main-content').innerHTML = `
        <div class="page-header"><h1>لوحة التحكم - ${escapeHtml(currentCompany.name)}</h1>
            <span class="badge">${roleLabel}</span>
        </div>
        <div class="stats-grid">
            <div class="stat-card"><div class="stat-icon"><i class="fas fa-money-bill"></i></div><div class="stat-info"><h3>مبيعات اليوم</h3><p>${totalSales.toFixed(2)} ر.س</p></div></div>
            <div class="stat-card"><div class="stat-icon"><i class="fas fa-percent"></i></div><div class="stat-info"><h3>الضريبة</h3><p>${totalTax.toFixed(2)} ر.س</p></div></div>
            <div class="stat-card"><div class="stat-icon"><i class="fas fa-receipt"></i></div><div class="stat-info"><h3>الإجمالي مع الضريبة</h3><p>${totalWithTax.toFixed(2)} ر.س</p></div></div>
            <div class="stat-card"><div class="stat-icon"><i class="fas fa-shopping-cart"></i></div><div class="stat-info"><h3>عدد الطلبات</h3><p>${orders.length}</p></div></div>
            <div class="stat-card"><div class="stat-icon"><i class="fas fa-chair"></i></div><div class="stat-info"><h3>طاولات مشغولة</h3><p>${occupiedTables.length > 0 ? occupiedTables[0].cnt : 0}</p></div></div>
            <div class="stat-card"><div class="stat-icon"><i class="fas fa-exclamation-triangle"></i></div><div class="stat-info"><h3>مواد حرجة</h3><p>${lowStock.length}</p></div></div>
        </div>
        <h3>آخر الطلبات</h3>
        <table><thead><tr><th>رقم</th><th>نوع الطلب</th><th>المبلغ</th><th>الضريبة</th><th>الإجمالي</th><th>طريقة الدفع</th><th>التاريخ</th></tr></thead><tbody>
        ${orders.slice(-5).reverse().map(o => `<tr>
            <td>${o.id}</td>
            <td><span class="badge ${o.order_type === 'dine_in' ? 'badge-dine' : 'badge-take'}">${o.order_type === 'dine_in' ? '🍽️ محلي' : '🛍️ سفري'}</span></td>
            <td>${o.total.toFixed(2)}</td>
            <td>${(o.tax || 0).toFixed(2)}</td>
            <td>${(o.total_with_tax || o.total).toFixed(2)}</td>
            <td>${escapeHtml(o.payment_method)}</td>
            <td>${escapeHtml(o.time)}</td>
        </tr>`).join('') || '<tr><td colspan="7" style="text-align:center; color:#7f8c8d;">لا توجد طلبات اليوم</td></tr>'}
        </tbody></table>
    `;
}

// ========== نقطة البيع ==========
async function renderPOS() {
    const perms = currentUser.permissions || {};
    const categories = await api.invoke('db-query', "SELECT * FROM categories WHERE company_id=?", [currentCompany.id]);
    const tables = await api.invoke('db-query', "SELECT * FROM tables WHERE company_id=? AND status='free'", [currentCompany.id]);
    const waiters = await api.invoke('db-query', "SELECT * FROM waiters WHERE company_id=?", [currentCompany.id]);

    const iconMap = { 'أكلات شعبية': '🍗', 'غداء': '🍚', 'المعصوب': '🍰', 'مشروبات': '🥤' };
    const catBtns = categories.map(c => {
        const icon = iconMap[c.name] || '📦';
        return `<button class="cat-btn" data-cat-id="${c.id}">${icon} ${escapeHtml(c.name)}</button>`;
    }).join('');
    const tableOpts = tables.map(t => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join('');
    const waiterOpts = waiters.map(w => `<option value="${w.id}">${escapeHtml(w.name)}</option>`).join('');

    const dineActive = selectedOrderType === 'dine_in' ? 'active-dine' : '';
    const takeActive = selectedOrderType === 'takeaway' ? 'active-take' : '';

    document.getElementById('main-content').innerHTML = `
        <div class="page-header"><h1>نقطة البيع (الضريبة: ${taxRate}%)</h1>
            <div>
                ${perms.can_refund ? `<button class="btn btn-warning" id="btn-open-refund"><i class="fas fa-undo"></i> إرجاع طلب</button>` : ''}
                <button class="btn btn-danger" id="btn-close-shift"><i class="fas fa-lock"></i> إغلاق الوردية</button>
            </div>
        </div>
        <div class="pos-container">
            <div class="menu-section">
                <div class="category-grid">
                    <button class="cat-btn active" data-cat-id="all">📋 الكل</button>
                    ${catBtns}
                </div>
                <input type="text" id="pos-search" placeholder="بحث..." style="margin-bottom:10px; padding:8px; width:100%;">
                <div class="items-grid" id="pos-items-grid"></div>
            </div>
            <div class="invoice-section">
                <div class="shift-info-box">
                    <span>الوردية: <span id="shift-total">${totalSalesCash.toFixed(2)}</span> ر.س</span>
                    <span>#${currentShiftId || ''}</span>
                </div>
                <select id="pos-table" style="width:100%; padding:8px; margin-bottom:5px;"><option value="">بدون طاولة</option>${tableOpts}</select>
                <select id="pos-waiter" style="width:100%; padding:8px; margin-bottom:5px;"><option value="">بدون كابتن</option>${waiterOpts}</select>

                <div class="order-type">
                    <button class="type-btn ${dineActive}" data-order-type="dine_in">🍽️ محلي</button>
                    <button class="type-btn ${takeActive}" data-order-type="takeaway">🛍️ سفري</button>
                </div>

                <div class="cart-items" id="cart-items"></div>
                <div class="cart-total">
                    <div>المجموع: <span id="cart-subtotal">0.00</span> ر.س</div>
                    <div>الضريبة (${taxRate}%): <span id="cart-tax">0.00</span> ر.س</div>
                    <div style="font-weight:800; font-size:22px;">الإجمالي: <span id="cart-total">0.00</span> ر.س</div>
                </div>
                <div class="payment-options">
                    <button class="active" data-payment="cash">💰 نقدي</button>
                    <button data-payment="card">💳 بطاقة</button>
                    <button data-payment="bank">🏦 تحويل</button>
                </div>
                <button class="btn btn-success" style="width:100%; margin-bottom:5px;" id="btn-checkout">إنهاء الطلب</button>
                <button class="btn btn-danger" style="width:100%;" id="btn-clear-cart">مسح السلة</button>
            </div>
        </div>
    `;

    // ربط الأحداث برمجياً بدل onclick المضمّن في النص (أكثر أماناً وأسهل صيانة)
    document.querySelectorAll('.cat-btn').forEach(btn => {
        btn.addEventListener('click', () => filterPOS(btn.dataset.catId, btn));
    });
    document.querySelectorAll('.type-btn').forEach(btn => {
        btn.addEventListener('click', () => selectOrderType(btn.dataset.orderType));
    });
    document.querySelectorAll('.payment-options button').forEach(btn => {
        btn.addEventListener('click', () => selectPayment(btn.dataset.payment));
    });
    document.getElementById('pos-search').addEventListener('input', searchPOS);
    document.getElementById('btn-checkout').addEventListener('click', checkoutPOS);
    document.getElementById('btn-clear-cart').addEventListener('click', clearCart);
    document.getElementById('btn-close-shift').addEventListener('click', closeShift);
    const refundBtn = document.getElementById('btn-open-refund');
    if (refundBtn) refundBtn.addEventListener('click', openRefundModal);

    await filterPOS('all');
    updateCartUI();
}

function selectPayment(method) {
    selectedPayment = method;
    document.querySelectorAll('.payment-options button').forEach(b => {
        b.classList.toggle('active', b.dataset.payment === method);
    });
}

function selectOrderType(type) {
    selectedOrderType = type;
    document.querySelectorAll('.type-btn').forEach(b => {
        b.classList.remove('active-dine', 'active-take');
        if (b.dataset.orderType === type) {
            b.classList.add(type === 'dine_in' ? 'active-dine' : 'active-take');
        }
    });
}

async function filterPOS(catId, btnEl) {
    currentCategory = catId;
    document.querySelectorAll('.cat-btn').forEach(b => b.classList.remove('active'));
    if (btnEl) btnEl.classList.add('active');
    else {
        const fallbackBtn = document.querySelector(`.cat-btn[data-cat-id="${catId}"]`);
        if (fallbackBtn) fallbackBtn.classList.add('active');
    }

    let products;
    if (catId === 'all') {
        products = await api.invoke('db-query', "SELECT * FROM products WHERE company_id=? AND is_active=1", [currentCompany.id]);
    } else {
        products = await api.invoke('db-query', "SELECT * FROM products WHERE company_id=? AND category_id=? AND is_active=1", [currentCompany.id, catId]);
    }
    await renderPOSItems(products);
}

async function searchPOS() {
    const q = document.getElementById('pos-search').value;
    const products = await api.invoke('db-query',
        "SELECT * FROM products WHERE company_id=? AND is_active=1 AND name LIKE ?", [currentCompany.id, `%${q}%`]
    );
    await renderPOSItems(products);
}

async function renderPOSItems(products) {
    const grid = document.getElementById('pos-items-grid');
    if (!grid) return;

    const placeholderImg = `<div style="width:100%; height:80px; background:#f0f0f0; display:flex; align-items:center; justify-content:center; border-radius:4px; font-size:24px;">🍽️</div>`;

    grid.innerHTML = products.map(p => `<div class="item-card" data-product-id="${p.id}">
        <div class="item-img-slot" data-image="${p.image ? escapeHtml(p.image) : ''}">${placeholderImg}</div>
        <div class="item-name">${escapeHtml(p.name)}</div>
        <div class="item-price">${p.price.toFixed(2)} ر.س</div>
    </div>`).join('') || '<p style="text-align:center; color:#7f8c8d; padding:20px;">لا توجد منتجات</p>';

    document.querySelectorAll('.item-card').forEach(card => {
        card.addEventListener('click', () => addToCartPOS(parseInt(card.dataset.productId)));
    });

    // تحميل الصور بشكل غير متزامن عبر main process (مسار صحيح على كل الأنظمة)
    document.querySelectorAll('.item-img-slot[data-image]').forEach(async (slot) => {
        const imagePath = slot.dataset.image;
        if (!imagePath) return;
        try {
            const url = await api.invoke('resolve-image-url', imagePath);
            if (url) {
                slot.innerHTML = `<img src="${url}" style="width:100%; height:80px; object-fit:cover; border-radius:4px;" onerror="this.parentElement.innerHTML=this.parentElement.dataset.fallback">`;
            }
        } catch (e) { /* تبقى الصورة الافتراضية */ }
    });
}

async function addToCartPOS(productId) {
    const product = await api.invoke('db-get', "SELECT * FROM products WHERE id=?", [productId]);
    if (!product) return;
    const existing = cart.find(i => i.id === productId);
    if (existing) existing.qty += 1;
    else cart.push({ ...product, qty: 1 });
    updateCartUI();
}

function updateCartUI() {
    const container = document.getElementById('cart-items');
    const subtotalEl = document.getElementById('cart-subtotal');
    const taxEl = document.getElementById('cart-tax');
    const totalEl = document.getElementById('cart-total');
    if (!container) return;
    let subtotal = 0;
    container.innerHTML = cart.map((item, idx) => {
        subtotal += item.price * item.qty;
        return `<div class="cart-item">
            <span>${escapeHtml(item.name)} x${item.qty}</span>
            <span>${(item.price * item.qty).toFixed(2)}</span>
            <button class="btn btn-danger btn-sm" data-remove-idx="${idx}">×</button>
        </div>`;
    }).join('') || '<p style="text-align:center; color:#7f8c8d; padding:15px;">السلة فارغة</p>';

    container.querySelectorAll('[data-remove-idx]').forEach(btn => {
        btn.addEventListener('click', () => removeFromCart(parseInt(btn.dataset.removeIdx)));
    });

    const tax = subtotal * (taxRate / 100);
    const total = subtotal + tax;
    subtotalEl.innerText = subtotal.toFixed(2);
    taxEl.innerText = tax.toFixed(2);
    totalEl.innerText = total.toFixed(2);
}

function removeFromCart(index) { cart.splice(index, 1); updateCartUI(); }
function clearCart() { cart = []; updateCartUI(); }

async function checkoutPOS() {
    if (cart.length === 0) return alert('السلة فارغة');
    const tableId = document.getElementById('pos-table').value || null;
    const waiterId = document.getElementById('pos-waiter').value || null;
    const subtotal = cart.reduce((s, i) => s + (i.price * i.qty), 0);
    const tax = subtotal * (taxRate / 100);
    const total = subtotal + tax;

    if (selectedPayment === 'cash') {
        pendingOrderData = { tableId, waiterId, subtotal, tax, total };
        document.getElementById('cash-modal-total').innerText = `الإجمالي: ${total.toFixed(2)} ر.س`;
        document.getElementById('cash-paid-amount').value = total.toFixed(2);
        document.getElementById('cash-modal').style.display = 'flex';
        document.getElementById('cash-paid-amount').focus();
        return;
    } else {
        await finishOrder(tableId, waiterId, subtotal, tax, total, total);
    }
}

async function confirmCashPayment() {
    const paidInput = document.getElementById('cash-paid-amount');
    const paidAmount = parseFloat(paidInput.value);
    if (isNaN(paidAmount) || paidAmount <= 0) {
        alert('أدخل مبلغاً صحيحاً');
        return;
    }
    if (!pendingOrderData) { alert('لا توجد بيانات طلب معلّقة'); return; }
    const { tableId, waiterId, subtotal, tax, total } = pendingOrderData;
    if (paidAmount < total) {
        alert('المبلغ المدفوع أقل من الإجمالي');
        return;
    }
    document.getElementById('cash-modal').style.display = 'none';
    await finishOrder(tableId, waiterId, subtotal, tax, total, paidAmount);
}

function cancelCashPayment() {
    document.getElementById('cash-modal').style.display = 'none';
    pendingOrderData = null;
}

async function finishOrder(tableId, waiterId, subtotal, tax, total, paidAmount) {
    const checkoutBtn = document.getElementById('btn-checkout');
    if (checkoutBtn) checkoutBtn.disabled = true;
    try {
        const result = await api.invoke('create-order', {
            company_id: currentCompany.id,
            table_id: tableId,
            waiter_id: waiterId,
            user_id: currentUser.id,
            total: subtotal,
            tax: tax,
            total_with_tax: total,
            discount: 0,
            payment_method: selectedPayment,
            paid_amount: paidAmount,
            shift_id: currentShiftId,
            order_type: selectedOrderType,
            items: cart.map(i => ({ id: i.id, qty: i.qty, price: i.price, recipe: i.recipe }))
        });

        if (!result.success) {
            alert('فشل حفظ الطلب: ' + (result.error || ''));
            return;
        }

        if (selectedPayment === 'cash') {
            totalSalesCash += total;
            const shiftTotalEl = document.getElementById('shift-total');
            if (shiftTotalEl) shiftTotalEl.innerText = totalSalesCash.toFixed(2);
        }
        await printInvoice(result.orderId, cart, subtotal, tax, total, paidAmount);
        cart = [];
        updateCartUI();
        await filterPOS(currentCategory);
        pendingOrderData = null;
    } catch (err) {
        alert('خطأ أثناء إنهاء الطلب: ' + err.message);
    } finally {
        if (checkoutBtn) checkoutBtn.disabled = false;
    }
}

async function printInvoice(orderId, items, subtotal, tax, total, paidAmount) {
    const dateStr = new Date().toLocaleString('ar-SA');
    const change = paidAmount - total;
    const orderTypeLabel = selectedOrderType === 'dine_in' ? '🍽️ محلي' : '🛍️ سفري';
    const rows = items.map(i => `<tr><td>${escapeHtml(i.name)}</td><td style="text-align:center;">${i.qty}</td><td style="text-align:left;">${(i.price * i.qty).toFixed(2)}</td></tr>`).join('');

    const html = `
    <!DOCTYPE html>
    <html dir="rtl">
    <head><meta charset="UTF-8"><style>
        @page { size: 74mm auto; margin: 0; }
        body { font-family: 'Tajawal', Arial, sans-serif; direction: rtl; width: 74mm; margin: 0 auto; padding: 2mm; font-size: 12px; background: white; color: black; }
        .receipt-header { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 4px; margin-bottom: 6px; }
        .receipt-header h3 { font-size: 14px; font-weight: 800; margin: 0 0 2px; }
        .receipt-header p { font-size: 10px; margin: 2px 0; }
        .receipt-table { width: 100%; border-collapse: collapse; margin-top: 4px; }
        .receipt-table th, .receipt-table td { font-size: 11px; padding: 3px 2px; text-align: right; border-bottom: 1px dotted #ccc; }
        .receipt-table th { font-weight: 700; border-bottom: 1px solid #000; }
        .receipt-divider { border-top: 1px dashed #000; margin: 6px 0; }
        .receipt-total-row { display: flex; justify-content: space-between; font-size: 13px; font-weight: 800; padding: 2px 0; }
        .receipt-footer { text-align: center; font-size: 9px; margin-top: 10px; border-top: 1px dashed #000; padding-top: 4px; }
    </style></head>
    <body>
        <div class="receipt-header">
            <h3>${escapeHtml(currentCompany.name)}</h3>
            <p>📞 ${escapeHtml(currentCompany.phone || '')}</p>
            <p>📍 ${escapeHtml(currentCompany.address || '')}</p>
            ${currentCompany.tax_number ? `<p>الرقم الضريبي: ${escapeHtml(currentCompany.tax_number)}</p>` : ''}
            <p>رقم الفاتورة: #${orderId}</p>
            <p>${dateStr}</p>
            <p>نوع الطلب: ${orderTypeLabel}</p>
            <p>طريقة الدفع: ${selectedPayment === 'cash' ? 'نقدي' : selectedPayment === 'card' ? 'بطاقة' : 'تحويل بنكي'}</p>
        </div>
        <table class="receipt-table">
            <thead><tr><th>الصنف</th><th style="text-align:center; width:30px;">كم</th><th style="text-align:left; width:50px;">السعر</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
        <div class="receipt-divider"></div>
        <div class="receipt-total-row"><span>المجموع</span><span>${subtotal.toFixed(2)} ر.س</span></div>
        <div class="receipt-total-row"><span>الضريبة (${taxRate}%)</span><span>${tax.toFixed(2)} ر.س</span></div>
        <div class="receipt-total-row" style="font-size:15px;"><span>الإجمالي</span><span>${total.toFixed(2)} ر.س</span></div>
        ${selectedPayment === 'cash' ? `<div class="receipt-total-row"><span>المدفوع</span><span>${paidAmount.toFixed(2)} ر.س</span></div>
        <div class="receipt-total-row"><span>الباقي</span><span>${change.toFixed(2)} ر.س</span></div>` : ''}
        <div class="receipt-footer"><p>شكراً لزيارتكم</p></div>
    </body></html>`;

    try {
        const printResult = await api.invoke('print-thermal', { html, userId: currentUser.id });
        if (printResult.method === 'fallback') {
            printViaBrowserWindow(html);
        }
    } catch (e) {
        printViaBrowserWindow(html);
    }
}

function printViaBrowserWindow(html) {
    try {
        const win = window.open('', '_blank', 'width=300,height=500');
        win.document.write(html);
        win.document.close();
        win.focus();
        setTimeout(() => { win.print(); }, 250);
    } catch (err2) {
        alert('تعذر فتح نافذة الطباعة: ' + err2.message);
    }
}

function openRefundModal() {
    document.getElementById('refund-modal').style.display = 'flex';
    document.getElementById('refund-order-id').value = '';
    document.getElementById('refund-reason').value = '';
}

async function processRefund() {
    const orderId = parseInt(document.getElementById('refund-order-id').value);
    const reason = document.getElementById('refund-reason').value.trim();
    if (!orderId) { alert('أدخل رقم الطلب'); return; }
    if (!reason) { alert('أدخل سبب الإرجاع'); return; }
    try {
        const result = await api.invoke('refund-order', { orderId, userId: currentUser.id, reason });
        if (result.success) {
            alert(`تم إرجاع الطلب #${orderId} بنجاح`);
            document.getElementById('refund-modal').style.display = 'none';
        } else {
            alert('فشل الإرجاع: ' + (result.error || ''));
        }
    } catch (err) {
        alert('خطأ: ' + err.message);
    }
}

async function closeShift() {
    const perms = currentUser.permissions || {};
    if (!perms.can_close_shift) {
        alert('ليس لديك صلاحية لإغلاق الوردية');
        return;
    }
    const actual = await showCustomPrompt('أدخل النقد الفعلي بالدرج (ر.س):', '0');
    if (actual === null) return;
    const actualCash = parseFloat(actual);
    if (isNaN(actualCash)) { alert('قيمة غير صالحة'); return; }

    try {
        const result = await api.invoke('close-shift', { shiftId: currentShiftId, actual_cash: actualCash, userId: currentUser.id });
        if (!result.success) {
            alert('فشل إغلاق الوردية: ' + (result.error || ''));
            return;
        }

        const diff = result.difference;
        const html = `
        <!DOCTYPE html>
        <html dir="rtl">
        <head><meta charset="UTF-8"><style>
            @page { size: 74mm auto; margin: 0; }
            body { font-family: 'Tajawal', Arial, sans-serif; direction: rtl; width: 74mm; margin: 0 auto; padding: 2mm; font-size: 12px; }
            .header { text-align: center; border-bottom: 1px dashed #000; padding-bottom: 4px; }
            .row { display: flex; justify-content: space-between; padding: 3px 0; }
            .total { font-weight: 800; font-size: 13px; border-top: 1px dashed #000; padding-top: 4px; margin-top: 4px; }
            .footer { text-align: center; font-size: 9px; border-top: 1px dashed #000; padding-top: 4px; margin-top: 8px; }
        </style></head>
        <body>
            <div class="header">
                <h3>تقرير إغلاق الوردية</h3>
                <p>${new Date().toLocaleString('ar-SA')}</p>
                <p>${escapeHtml(currentCompany.name)}</p>
            </div>
            <div class="row"><span>إجمالي المبيعات النقدية:</span><span>${totalSalesCash.toFixed(2)} ر.س</span></div>
            <div class="row"><span>الكاش الفعلي:</span><span>${actualCash.toFixed(2)} ر.س</span></div>
            <div class="row total"><span>الفارق:</span><span>${diff.toFixed(2)} (${diff >= 0 ? 'فائض' : 'عجز'})</span></div>
            <div class="footer"><p>نهاية التقرير</p></div>
        </body></html>`;

        const printResult = await api.invoke('print-thermal', { html, userId: currentUser.id });
        if (printResult.method === 'fallback') {
            printViaBrowserWindow(html);
        }
        alert('تم إغلاق الوردية');
        location.reload();
    } catch (err) {
        alert('خطأ: ' + err.message);
    }
}

// ========== المنتجات ==========
async function renderProducts() {
    const perms = currentUser.permissions || {};
    const products = await api.invoke('db-query',
        "SELECT p.*, c.name as cat FROM products p LEFT JOIN categories c ON p.category_id=c.id WHERE p.company_id=?",
        [currentCompany.id]
    );
    document.getElementById('main-content').innerHTML = `
        <div class="page-header"><h1>المنتجات</h1>
            ${perms.can_edit_products ? `<button class="btn btn-primary" id="btn-add-product">إضافة منتج</button>` : ''}
        </div>
        <table><tr><th>الاسم</th><th>القسم</th><th>سعر البيع</th><th>التكلفة</th>
        ${perms.can_edit_products ? '<th></th>' : ''}</tr>
        ${products.map(p => `<tr>
            <td>${escapeHtml(p.name)}</td><td>${escapeHtml(p.cat || '')}</td>
            <td>${p.price.toFixed(2)}</td><td>${(p.cost || 0).toFixed(2)}</td>
            ${perms.can_edit_products ? `<td><button class="btn btn-sm btn-primary" data-edit-product="${p.id}">تعديل</button>
            <button class="btn btn-sm btn-danger" data-delete-product="${p.id}">حذف</button></td>` : ''}
        </tr>`).join('') || `<tr><td colspan="5" style="text-align:center;">لا توجد منتجات</td></tr>`}</table>
    `;

    const addBtn = document.getElementById('btn-add-product');
    if (addBtn) addBtn.addEventListener('click', () => openProductModal());
    document.querySelectorAll('[data-edit-product]').forEach(b => b.addEventListener('click', () => editProduct(parseInt(b.dataset.editProduct))));
    document.querySelectorAll('[data-delete-product]').forEach(b => b.addEventListener('click', () => deleteProduct(parseInt(b.dataset.deleteProduct))));
}

async function openProductModal(id = null) {
    const perms = currentUser.permissions || {};
    if (!perms.can_edit_products) { alert('ليس لديك صلاحية'); return; }

    let product = { id: null, name: '', price: '', cost: '', category_id: '', image: '', unit: 'قطعة' };
    if (id) {
        const found = await api.invoke('db-get', "SELECT * FROM products WHERE id=? AND company_id=?", [id, currentCompany.id]);
        if (found) product = found;
    }
    const categories = await api.invoke('db-query', "SELECT * FROM categories WHERE company_id=?", [currentCompany.id]);
    const catOpts = categories.map(c => `<option value="${c.id}" ${c.id == product.category_id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');

    let previewHtml = '';
    if (product.image) {
        const url = await api.invoke('resolve-image-url', product.image);
        if (url) previewHtml = `<img src="${url}" style="max-width:100px; max-height:100px; border:1px solid #ddd; border-radius:4px;">`;
    }

    const modalContent = document.getElementById('modal-content');
    modalContent.innerHTML = `
        <h3>${id ? 'تعديل' : 'إضافة'} منتج</h3>
        <div class="form-group"><label>الاسم</label><input type="text" id="prod-name" value="${escapeHtml(product.name || '')}"></div>
        <div class="form-group"><label>سعر البيع (ر.س)</label><input type="number" id="prod-price" value="${product.price || ''}" step="0.01"></div>
        <div class="form-group"><label>سعر الشراء (ر.س)</label><input type="number" id="prod-cost" value="${product.cost || ''}" step="0.01"></div>
        <div class="form-group"><label>القسم</label><select id="prod-category">${catOpts}</select></div>
        <div class="form-group"><label>الوحدة</label><input type="text" id="prod-unit" value="${escapeHtml(product.unit || 'قطعة')}"></div>
        <div class="form-group">
            <label>صورة المنتج</label>
            <div id="prod-image-preview" style="margin-bottom:5px;">${previewHtml}</div>
            <input type="file" id="prod-image-input" accept="image/*" style="display:block; margin-top:5px;">
        </div>
        <button class="btn btn-primary" id="btn-save-product">حفظ</button>
        <button class="btn btn-secondary" id="btn-cancel-product">إلغاء</button>
    `;
    document.getElementById('modal').classList.add('active');

    document.getElementById('prod-image-input').addEventListener('change', function(e) {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                const preview = document.getElementById('prod-image-preview');
                preview.innerHTML = `<img src="${ev.target.result}" style="max-width:100px; max-height:100px; border:1px solid #ddd; border-radius:4px;">`;
            };
            reader.readAsDataURL(file);
        }
    });
    document.getElementById('btn-save-product').addEventListener('click', () => saveProduct(id));
    document.getElementById('btn-cancel-product').addEventListener('click', closeModal);
}

async function saveProduct(id) {
    const name = document.getElementById('prod-name').value.trim();
    const price = parseFloat(document.getElementById('prod-price').value);
    const cost = parseFloat(document.getElementById('prod-cost').value) || 0;
    const category_id = document.getElementById('prod-category').value || null;
    const unit = document.getElementById('prod-unit').value.trim() || 'قطعة';
    if (!name || isNaN(price)) { alert('الاسم والسعر مطلوبان'); return; }

    let imagePath = null;
    const fileInput = document.getElementById('prod-image-input');
    if (fileInput.files && fileInput.files[0]) {
        const file = fileInput.files[0];
        if (file.size > 5 * 1024 * 1024) { alert('حجم الصورة كبير جداً (الحد الأقصى 5MB)'); return; }
        const reader = new FileReader();
        const base64 = await new Promise((resolve) => {
            reader.onload = (e) => resolve(e.target.result.split(',')[1]);
            reader.readAsDataURL(file);
        });
        const safeFileName = `product_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9_.-]/g, '_')}`;
        const result = await api.invoke('save-product-image', { fileName: safeFileName, buffer: base64 });
        if (result.success) imagePath = result.imagePath;
    } else if (id) {
        const old = await api.invoke('db-get', "SELECT image FROM products WHERE id=?", [id]);
        if (old && old.image) imagePath = old.image;
    }

    try {
        const result = await api.invoke('save-product', {
            id: id || null,
            company_id: currentCompany.id,
            name, price, cost, category_id,
            unit, image: imagePath || '',
            userId: currentUser.id
        });
        if (!result.success) { alert('فشل حفظ المنتج: ' + (result.error || '')); return; }
        closeModal();
        switchTab('products');
    } catch (err) {
        alert('فشل حفظ المنتج: ' + err.message);
    }
}

function editProduct(id) { openProductModal(id); }

async function deleteProduct(id) {
    const confirmed = await showCustomConfirm('حذف المنتج نهائياً؟');
    if (!confirmed) return;
    await api.invoke('delete-product', { id, company_id: currentCompany.id, userId: currentUser.id });
    switchTab('products');
}

// ========== الأقسام ==========
async function renderCategories() {
    const perms = currentUser.permissions || {};
    const categories = await api.invoke('db-query', "SELECT * FROM categories WHERE company_id=?", [currentCompany.id]);
    document.getElementById('main-content').innerHTML = `
        <div class="page-header"><h1>الأقسام</h1>
            ${perms.can_edit_products ? `<button class="btn btn-primary" id="btn-add-category">إضافة قسم</button>` : ''}
        </div>
        <table><tr><th>الاسم</th>${perms.can_edit_products ? '<th></th>' : ''}</tr>
        ${categories.map(c => `<tr><td>${escapeHtml(c.name)}</td>
            ${perms.can_edit_products ? `<td><button class="btn btn-sm btn-danger" data-delete-cat="${c.id}">حذف</button></td>` : ''}
        </tr>`).join('') || `<tr><td colspan="2" style="text-align:center;">لا توجد أقسام</td></tr>`}</table>
    `;
    const addBtn = document.getElementById('btn-add-category');
    if (addBtn) addBtn.addEventListener('click', openCategoryModal);
    document.querySelectorAll('[data-delete-cat]').forEach(b => b.addEventListener('click', () => deleteCategory(parseInt(b.dataset.deleteCat))));
}

function openCategoryModal() {
    const modalContent = document.getElementById('modal-content');
    modalContent.innerHTML = `
        <h3>إضافة قسم</h3>
        <div class="form-group"><label>اسم القسم</label><input type="text" id="cat-name"></div>
        <button class="btn btn-primary" id="btn-save-category">حفظ</button>
        <button class="btn btn-secondary" id="btn-cancel-category">إلغاء</button>
    `;
    document.getElementById('modal').classList.add('active');
    document.getElementById('btn-save-category').addEventListener('click', saveCategory);
    document.getElementById('btn-cancel-category').addEventListener('click', closeModal);
}

async function saveCategory() {
    const name = document.getElementById('cat-name').value.trim();
    if (!name) { alert('أدخل اسم القسم'); return; }
    try {
        const result = await api.invoke('save-category', { company_id: currentCompany.id, name, userId: currentUser.id });
        if (!result.success) { alert('فشل: ' + (result.error || '')); return; }
        closeModal();
        switchTab('categories');
    } catch (err) {
        alert('فشل حفظ القسم: ' + err.message);
    }
}

async function deleteCategory(id) {
    const confirmed = await showCustomConfirm('حذف القسم؟');
    if (!confirmed) return;
    const result = await api.invoke('delete-category', { id, userId: currentUser.id });
    if (!result.success) { alert(result.error || 'فشل الحذف'); return; }
    switchTab('categories');
}

// ========== المواد الخام ==========
async function renderMaterials() {
    const perms = currentUser.permissions || {};
    const materials = await api.invoke('db-query', "SELECT * FROM raw_materials WHERE company_id=?", [currentCompany.id]);
    document.getElementById('main-content').innerHTML = `
        <div class="page-header"><h1>المواد الخام</h1>
            ${perms.can_edit_products ? `<button class="btn btn-primary" id="btn-add-material">إضافة مادة</button>` : ''}
        </div>
        <table><tr><th>الاسم</th><th>المخزون</th><th>الوحدة</th><th>الحد الأدنى</th><th>سعر الشراء</th>
        ${perms.can_edit_products ? '<th></th>' : ''}</tr>
        ${materials.map(m => `<tr class="${m.current_stock <= m.min_stock ? 'stock-danger' : ''}">
            <td>${escapeHtml(m.name)}</td><td>${m.current_stock}</td><td>${escapeHtml(m.unit)}</td>
            <td>${m.min_stock}</td><td>${(m.purchase_price || 0).toFixed(2)}</td>
            ${perms.can_edit_products ? `<td><button class="btn btn-sm btn-success" data-add-stock="${m.id}">توريد</button>
            <button class="btn btn-sm btn-primary" data-edit-material="${m.id}">تعديل</button>
            <button class="btn btn-sm btn-danger" data-delete-material="${m.id}">حذف</button></td>` : ''}
        </tr>`).join('') || `<tr><td colspan="6" style="text-align:center;">لا توجد مواد خام</td></tr>`}</table>
    `;
    const addBtn = document.getElementById('btn-add-material');
    if (addBtn) addBtn.addEventListener('click', () => openMaterialModal());
    document.querySelectorAll('[data-add-stock]').forEach(b => b.addEventListener('click', () => addStock(parseInt(b.dataset.addStock))));
    document.querySelectorAll('[data-edit-material]').forEach(b => b.addEventListener('click', () => editMaterial(parseInt(b.dataset.editMaterial))));
    document.querySelectorAll('[data-delete-material]').forEach(b => b.addEventListener('click', () => deleteMaterial(parseInt(b.dataset.deleteMaterial))));
}

async function openMaterialModal(id = null) {
    let material = { name: '', unit: 'كجم', min_stock: 0, purchase_price: 0 };
    if (id) {
        const found = await api.invoke('db-get', "SELECT * FROM raw_materials WHERE id=? AND company_id=?", [id, currentCompany.id]);
        if (found) material = found;
    }
    const modalContent = document.getElementById('modal-content');
    modalContent.innerHTML = `
        <h3>${id ? 'تعديل' : 'إضافة'} مادة</h3>
        <div class="form-group"><label>الاسم</label><input type="text" id="mat-name" value="${escapeHtml(material.name || '')}"></div>
        <div class="form-group"><label>الوحدة</label><input type="text" id="mat-unit" value="${escapeHtml(material.unit || 'كجم')}"></div>
        <div class="form-group"><label>الحد الأدنى</label><input type="number" id="mat-min" value="${material.min_stock || 0}"></div>
        <div class="form-group"><label>سعر الشراء</label><input type="number" id="mat-price" value="${material.purchase_price || 0}" step="0.01"></div>
        <button class="btn btn-primary" id="btn-save-material">حفظ</button>
        <button class="btn btn-secondary" id="btn-cancel-material">إلغاء</button>
    `;
    document.getElementById('modal').classList.add('active');
    document.getElementById('btn-save-material').addEventListener('click', () => saveMaterial(id));
    document.getElementById('btn-cancel-material').addEventListener('click', closeModal);
}

async function saveMaterial(id) {
    const name = document.getElementById('mat-name').value.trim();
    const unit = document.getElementById('mat-unit').value.trim();
    const min_stock = parseFloat(document.getElementById('mat-min').value) || 0;
    const purchase_price = parseFloat(document.getElementById('mat-price').value) || 0;
    if (!name) { alert('الاسم مطلوب'); return; }
    try {
        const result = await api.invoke('save-material', {
            id: id || null, company_id: currentCompany.id, name, unit, min_stock, purchase_price
        });
        if (!result.success) { alert('فشل: ' + (result.error || '')); return; }
        closeModal();
        switchTab('materials');
    } catch (err) {
        alert('فشل حفظ المادة: ' + err.message);
    }
}

function editMaterial(id) { openMaterialModal(id); }

async function deleteMaterial(id) {
    const confirmed = await showCustomConfirm('حذف المادة؟');
    if (!confirmed) return;
    await api.invoke('delete-material', { id, company_id: currentCompany.id });
    switchTab('materials');
}

async function addStock(id) {
    const qty = await showCustomPrompt('أدخل كمية التوريد:', '0');
    if (qty === null) return;
    const qtyNum = parseFloat(qty);
    if (isNaN(qtyNum) || qtyNum <= 0) { alert('كمية غير صالحة'); return; }
    const result = await api.invoke('add-stock', { material_id: id, qty: qtyNum, userId: currentUser.id });
    if (!result.success) { alert(result.error || 'فشل التوريد'); return; }
    switchTab('materials');
}

// ========== الطاولات ==========
async function renderTables() {
    const tables = await api.invoke('db-query', "SELECT * FROM tables WHERE company_id=?", [currentCompany.id]);
    document.getElementById('main-content').innerHTML = `
        <div class="page-header"><h1>الطاولات</h1><button class="btn btn-primary" id="btn-add-table">إضافة طاولة</button></div>
        <div class="stats-grid">
            ${tables.map(t => `<div class="stat-card"><div style="width:100%;"><h3>${escapeHtml(t.name)}</h3><p>${t.status === 'free' ? '🟢 متاحة' : '🔴 مشغولة'}</p>
                <button class="btn btn-sm btn-danger" data-delete-table="${t.id}">حذف</button></div></div>`).join('') || '<p style="color:#7f8c8d;">لا توجد طاولات</p>'}
        </div>
    `;
    document.getElementById('btn-add-table').addEventListener('click', openTableModal);
    document.querySelectorAll('[data-delete-table]').forEach(b => b.addEventListener('click', () => deleteTable(parseInt(b.dataset.deleteTable))));
}

function openTableModal() {
    const modalContent = document.getElementById('modal-content');
    modalContent.innerHTML = `
        <h3>إضافة طاولة</h3>
        <div class="form-group"><label>اسم الطاولة</label><input type="text" id="table-name"></div>
        <button class="btn btn-primary" id="btn-save-table">حفظ</button>
        <button class="btn btn-secondary" id="btn-cancel-table">إلغاء</button>
    `;
    document.getElementById('modal').classList.add('active');
    document.getElementById('btn-save-table').addEventListener('click', saveTable);
    document.getElementById('btn-cancel-table').addEventListener('click', closeModal);
}

async function saveTable() {
    const name = document.getElementById('table-name').value.trim();
    if (!name) { alert('أدخل اسم الطاولة'); return; }
    const result = await api.invoke('save-table', { company_id: currentCompany.id, name });
    if (!result.success) { alert(result.error || 'فشل الحفظ'); return; }
    closeModal();
    switchTab('tables');
}

async function deleteTable(id) {
    const confirmed = await showCustomConfirm('حذف الطاولة؟');
    if (!confirmed) return;
    await api.invoke('delete-table', { id });
    switchTab('tables');
}

// ========== الكباتن ==========
async function renderWaiters() {
    const waiters = await api.invoke('db-query', "SELECT * FROM waiters WHERE company_id=?", [currentCompany.id]);
    document.getElementById('main-content').innerHTML = `
        <div class="page-header"><h1>الكباتن</h1><button class="btn btn-primary" id="btn-add-waiter">إضافة كابتن</button></div>
        <table><tr><th>الاسم</th><th></th></tr>
        ${waiters.map(w => `<tr><td>${escapeHtml(w.name)}</td><td><button class="btn btn-sm btn-danger" data-delete-waiter="${w.id}">حذف</button></td></tr>`).join('') || '<tr><td colspan="2" style="text-align:center;">لا يوجد كباتن</td></tr>'}
        </table>
    `;
    document.getElementById('btn-add-waiter').addEventListener('click', openWaiterModal);
    document.querySelectorAll('[data-delete-waiter]').forEach(b => b.addEventListener('click', () => deleteWaiter(parseInt(b.dataset.deleteWaiter))));
}

function openWaiterModal() {
    const modalContent = document.getElementById('modal-content');
    modalContent.innerHTML = `
        <h3>إضافة كابتن</h3>
        <div class="form-group"><label>اسم الكابتن</label><input type="text" id="waiter-name"></div>
        <button class="btn btn-primary" id="btn-save-waiter">حفظ</button>
        <button class="btn btn-secondary" id="btn-cancel-waiter">إلغاء</button>
    `;
    document.getElementById('modal').classList.add('active');
    document.getElementById('btn-save-waiter').addEventListener('click', saveWaiter);
    document.getElementById('btn-cancel-waiter').addEventListener('click', closeModal);
}

async function saveWaiter() {
    const name = document.getElementById('waiter-name').value.trim();
    if (!name) { alert('أدخل اسم الكابتن'); return; }
    const result = await api.invoke('save-waiter', { company_id: currentCompany.id, name });
    if (!result.success) { alert(result.error || 'فشل الحفظ'); return; }
    closeModal();
    switchTab('waiters');
}

async function deleteWaiter(id) {
    const confirmed = await showCustomConfirm('حذف الكابتن؟');
    if (!confirmed) return;
    await api.invoke('delete-waiter', { id });
    switchTab('waiters');
}

// ========== التقارير ==========
async function renderReports() {
    document.getElementById('main-content').innerHTML = `
        <div class="page-header"><h1>التقارير</h1></div>
        <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:20px;">
            <div class="form-group" style="flex:1; min-width:150px;"><label>من تاريخ</label><input type="date" id="report-start"></div>
            <div class="form-group" style="flex:1; min-width:150px;"><label>إلى تاريخ</label><input type="date" id="report-end"></div>
            <button class="btn btn-primary" id="btn-generate-report" style="align-self:flex-end;">عرض التقارير</button>
        </div>
        <div id="report-results"></div>
    `;
    const today = new Date().toISOString().slice(0,10);
    const weekAgo = new Date(Date.now() - 7*24*60*60*1000).toISOString().slice(0,10);
    document.getElementById('report-start').value = weekAgo;
    document.getElementById('report-end').value = today;
    document.getElementById('btn-generate-report').addEventListener('click', generateReports);
}

async function generateReports() {
    const start = document.getElementById('report-start').value;
    const end = document.getElementById('report-end').value;
    if (!start || !end) { alert('اختر التواريخ'); return; }
    if (start > end) { alert('تاريخ البداية يجب أن يكون قبل تاريخ النهاية'); return; }

    try {
        const sales = await api.invoke('get-sales-report', { startDate: start, endDate: end, companyId: currentCompany.id });
        const profit = await api.invoke('get-profit-report', { startDate: start, endDate: end, companyId: currentCompany.id });
        const expenses = await api.invoke('get-expense-report', { startDate: start, endDate: end, companyId: currentCompany.id });

        const totalSales = sales.reduce((s, r) => s + r.total, 0);
        const totalTax = sales.reduce((s, r) => s + (r.tax || 0), 0);
        const totalExpenses = expenses.reduce((s, e) => s + e.total, 0);
        const netProfit = (profit.profit || 0) - totalExpenses;

        document.getElementById('report-results').innerHTML = `
            <div class="stats-grid">
                <div class="stat-card"><div class="stat-icon"><i class="fas fa-chart-simple"></i></div><div class="stat-info"><h3>إجمالي المبيعات</h3><p>${totalSales.toFixed(2)} ر.س</p></div></div>
                <div class="stat-card"><div class="stat-icon"><i class="fas fa-percent"></i></div><div class="stat-info"><h3>الضريبة</h3><p>${totalTax.toFixed(2)} ر.س</p></div></div>
                <div class="stat-card"><div class="stat-icon"><i class="fas fa-coins"></i></div><div class="stat-info"><h3>الأرباح الخام</h3><p>${(profit.profit || 0).toFixed(2)} ر.س</p></div></div>
                <div class="stat-card"><div class="stat-icon"><i class="fas fa-money-bill-wave"></i></div><div class="stat-info"><h3>المصروفات</h3><p>${totalExpenses.toFixed(2)} ر.س</p></div></div>
                <div class="stat-card"><div class="stat-icon"><i class="fas fa-trophy"></i></div><div class="stat-info"><h3>صافي الربح</h3><p>${netProfit.toFixed(2)} ر.س</p></div></div>
            </div>
            <h4>تفاصيل المبيعات</h4>
            <table>
                <tr><th>التاريخ</th><th>نوع الطلب</th><th>العدد</th><th>الإجمالي</th><th>الضريبة</th><th>طريقة الدفع</th></tr>
                ${sales.map(s => `<tr>
                    <td>${s.date}</td>
                    <td>${s.order_type === 'dine_in' ? '🍽️ محلي' : '🛍️ سفري'}</td>
                    <td>${s.count}</td>
                    <td>${s.total.toFixed(2)}</td>
                    <td>${(s.tax || 0).toFixed(2)}</td>
                    <td>${escapeHtml(s.payment_method)}</td>
                </tr>`).join('') || '<tr><td colspan="6" style="text-align:center;">لا توجد بيانات</td></tr>'}
            </table>
            <h4>المصروفات</h4>
            <table><tr><th>الفئة</th><th>الإجمالي</th></tr>
            ${expenses.map(e => `<tr><td>${escapeHtml(e.category)}</td><td>${e.total.toFixed(2)}</td></tr>`).join('') || '<tr><td colspan="2" style="text-align:center;">لا توجد مصروفات</td></tr>'}</table>
        `;
    } catch (err) {
        alert('خطأ في توليد التقارير: ' + err.message);
    }
}

// ========== المصروفات ==========
async function renderExpenses() {
    const month = new Date().toISOString().slice(0,7);
    const expenses = await api.invoke('db-query', "SELECT * FROM expenses WHERE company_id=? AND month=?", [currentCompany.id, month]);
    document.getElementById('main-content').innerHTML = `
        <div class="page-header"><h1>المصروفات - ${month}</h1>
            <button class="btn btn-primary" id="btn-add-expense">إضافة مصروف</button>
        </div>
        <table><tr><th>الفئة</th><th>الوصف</th><th>المبلغ (ر.س)</th><th>النوع</th><th></th></tr>
        ${expenses.map(e => `<tr><td>${escapeHtml(e.category)}</td><td>${escapeHtml(e.description || '')}</td><td>${e.amount.toFixed(2)}</td><td>${e.type === 'fixed' ? 'ثابتة' : 'متغيرة'}</td>
            <td><button class="btn btn-sm btn-danger" data-delete-expense="${e.id}">حذف</button></td></tr>`).join('') || '<tr><td colspan="5" style="text-align:center;">لا توجد مصروفات</td></tr>'}
        </table>
    `;
    document.getElementById('btn-add-expense').addEventListener('click', openExpenseModal);
    document.querySelectorAll('[data-delete-expense]').forEach(b => b.addEventListener('click', () => deleteExpense(parseInt(b.dataset.deleteExpense))));
}

function openExpenseModal() {
    const modalContent = document.getElementById('modal-content');
    modalContent.innerHTML = `
        <h3>إضافة مصروف</h3>
        <div class="form-group"><label>الفئة</label><input type="text" id="exp-category" placeholder="مثال: رواتب"></div>
        <div class="form-group"><label>الوصف</label><input type="text" id="exp-description" placeholder="وصف المصروف"></div>
        <div class="form-group"><label>المبلغ (ر.س)</label><input type="number" id="exp-amount" step="0.01"></div>
        <div class="form-group"><label>النوع</label>
            <select id="exp-type"><option value="fixed">ثابتة</option><option value="variable">متغيرة</option></select>
        </div>
        <button class="btn btn-primary" id="btn-save-expense">حفظ</button>
        <button class="btn btn-secondary" id="btn-cancel-expense">إلغاء</button>
    `;
    document.getElementById('modal').classList.add('active');
    document.getElementById('btn-save-expense').addEventListener('click', saveExpense);
    document.getElementById('btn-cancel-expense').addEventListener('click', closeModal);
}

async function saveExpense() {
    const category = document.getElementById('exp-category').value.trim();
    const description = document.getElementById('exp-description').value.trim();
    const amount = parseFloat(document.getElementById('exp-amount').value);
    const type = document.getElementById('exp-type').value;
    if (!category || isNaN(amount) || amount <= 0) { alert('أكمل البيانات بشكل صحيح'); return; }
    const month = new Date().toISOString().slice(0,7);
    try {
        const result = await api.invoke('add-expense', {
            company_id: currentCompany.id, month, category, description, amount, type, user_id: currentUser.id
        });
        if (!result.success) { alert('فشل: ' + (result.error || '')); return; }
        closeModal();
        switchTab('expenses');
    } catch (err) {
        alert('فشل إضافة المصروف: ' + err.message);
    }
}

async function deleteExpense(id) {
    const confirmed = await showCustomConfirm('حذف المصروف؟');
    if (!confirmed) return;
    await api.invoke('delete-expense', { id, userId: currentUser.id });
    switchTab('expenses');
}

// ========== سجل التدقيق ==========
async function renderAudit() {
    const logs = await api.invoke('get-audit-log', { limit: 200 });
    document.getElementById('main-content').innerHTML = `
        <div class="page-header"><h1>سجل التدقيق</h1></div>
        <table><tr><th>التاريخ</th><th>المستخدم</th><th>الإجراء</th><th>التفاصيل</th></tr>
        ${logs.map(l => `<tr><td>${l.date}</td><td>${l.user_id}</td><td>${escapeHtml(l.action)}</td><td>${escapeHtml(l.details || '')}</td></tr>`).join('') || '<tr><td colspan="4" style="text-align:center;">لا توجد سجلات</td></tr>'}
        </table>
    `;
}

// ========== المستخدمين ==========
async function renderUsers() {
    const perms = currentUser.permissions || {};
    if (!perms.can_edit_users) {
        document.getElementById('main-content').innerHTML = '<div class="alert-warning">ليس لديك صلاحية لعرض هذه الصفحة</div>';
        return;
    }
    const users = await api.invoke('db-query', "SELECT * FROM users WHERE company_id=?", [currentCompany.id]);
    document.getElementById('main-content').innerHTML = `
        <div class="page-header"><h1>المستخدمين</h1>
            <button class="btn btn-primary" id="btn-add-user">إضافة مستخدم</button>
        </div>
        <table><tr><th>الاسم</th><th>اسم المستخدم</th><th>الدور</th><th>محظور</th><th></th></tr>
        ${users.map(u => `<tr>
            <td>${escapeHtml(u.full_name)}</td><td>${escapeHtml(u.username)}</td>
            <td>${u.role === 'admin' ? 'مدير' : u.role === 'accountant' ? 'محاسب' : 'كاشير'}</td>
            <td>${u.is_blocked ? 'نعم' : 'لا'}</td>
            <td><button class="btn btn-sm btn-primary" data-edit-user="${u.id}">تعديل</button>
            <button class="btn btn-sm btn-danger" data-toggle-block="${u.id}">${u.is_blocked ? 'فك الحظر' : 'حظر'}</button></td>
        </tr>`).join('')}</table>
    `;
    document.getElementById('btn-add-user').addEventListener('click', () => openUserModal());
    document.querySelectorAll('[data-edit-user]').forEach(b => b.addEventListener('click', () => editUser(parseInt(b.dataset.editUser))));
    document.querySelectorAll('[data-toggle-block]').forEach(b => b.addEventListener('click', () => toggleBlockUser(parseInt(b.dataset.toggleBlock))));
}

async function openUserModal(id = null) {
    let user = { id: null, full_name: '', username: '', role: 'cashier' };
    if (id) {
        const found = await api.invoke('db-get', "SELECT * FROM users WHERE id=? AND company_id=?", [id, currentCompany.id]);
        if (found) user = found;
    }
    const modalContent = document.getElementById('modal-content');
    modalContent.innerHTML = `
        <h3>${id ? 'تعديل' : 'إضافة'} مستخدم</h3>
        <div class="form-group"><label>الاسم الكامل</label><input type="text" id="user-fullname" value="${escapeHtml(user.full_name || '')}"></div>
        <div class="form-group"><label>اسم المستخدم</label><input type="text" id="user-username" value="${escapeHtml(user.username || '')}"></div>
        <div class="form-group"><label>كلمة المرور ${id ? '(اترك فارغاً لعدم التغيير)' : ''}</label>
            <input type="password" id="user-password" placeholder="${id ? 'أدخل كلمة جديدة لتغييرها' : 'كلمة المرور (6 أحرف على الأقل)'}">
        </div>
        <div class="form-group"><label>الدور</label>
            <select id="user-role">
                <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>مدير عام</option>
                <option value="accountant" ${user.role === 'accountant' ? 'selected' : ''}>محاسب</option>
                <option value="cashier" ${user.role === 'cashier' ? 'selected' : ''}>كاشير</option>
            </select>
        </div>
        <button class="btn btn-primary" id="btn-save-user">حفظ</button>
        <button class="btn btn-secondary" id="btn-cancel-user">إلغاء</button>
    `;
    document.getElementById('modal').classList.add('active');
    document.getElementById('btn-save-user').addEventListener('click', () => saveUser(id));
    document.getElementById('btn-cancel-user').addEventListener('click', closeModal);
}

async function saveUser(id) {
    const full_name = document.getElementById('user-fullname').value.trim();
    const username = document.getElementById('user-username').value.trim();
    const password = document.getElementById('user-password').value;
    const role = document.getElementById('user-role').value;
    if (!full_name || !username) { alert('الاسم واسم المستخدم مطلوبان'); return; }

    try {
        if (id) {
            const result = await api.invoke('update-user', {
                id, full_name, username, password: password || null, role, currentUserId: currentUser.id
            });
            if (!result.success) { alert('فشل التحديث: ' + (result.error || '')); return; }
        } else {
            if (!password) { alert('كلمة المرور مطلوبة'); return; }
            const result = await api.invoke('create-user', {
                company_id: currentCompany.id, full_name, username, password, role, currentUserId: currentUser.id
            });
            if (!result.success) { alert('فشل الإضافة: ' + (result.error || '')); return; }
        }
        closeModal();
        switchTab('users');
    } catch (err) {
        alert('خطأ: ' + err.message);
    }
}

function editUser(id) { openUserModal(id); }

async function toggleBlockUser(userId) {
    if (userId === currentUser.id) { alert('لا يمكنك حظر نفسك'); return; }
    const result = await api.invoke('toggle-block', { userId, currentUserId: currentUser.id });
    if (!result.success) { alert(result.error || 'فشلت العملية'); return; }
    switchTab('users');
}

// ========== الإعدادات ==========
async function renderSettings() {
    const roleLabel = currentUser.role === 'admin' ? 'مدير' : currentUser.role === 'accountant' ? 'محاسب' : 'كاشير';
    document.getElementById('main-content').innerHTML = `
        <div class="page-header"><h1>الإعدادات</h1></div>
        <div style="background:white; padding:20px; border-radius:10px; box-shadow:0 2px 8px rgba(0,0,0,0.08);">
            <h3>الحساب الشخصي</h3>
            <p><strong>اسم المستخدم:</strong> ${escapeHtml(currentUser.username)}</p>
            <p><strong>الدور:</strong> ${roleLabel}</p>
            <button class="btn btn-primary" id="btn-change-password">تغيير كلمة المرور</button>
            <hr style="margin:20px 0;">
            <h3>بيانات المطعم</h3>
            <p><strong>الاسم:</strong> ${escapeHtml(currentCompany.name)}</p>
            <p><strong>الهاتف:</strong> ${escapeHtml(currentCompany.phone || 'غير محدد')}</p>
            <p><strong>العنوان:</strong> ${escapeHtml(currentCompany.address || 'غير محدد')}</p>
            <p><strong>الرقم الضريبي:</strong> ${escapeHtml(currentCompany.tax_number || 'غير محدد')}</p>
            <p><strong>نسبة الضريبة:</strong> ${taxRate || 0}%</p>
            <button class="btn btn-primary" id="btn-edit-company">تعديل بيانات المطعم</button>
            <hr style="margin:20px 0;">
            <h3>النسخ الاحتياطي</h3>
            <button class="btn btn-secondary" id="btn-manual-backup">نسخ احتياطي يدوي</button>
        </div>
    `;
    document.getElementById('btn-change-password').addEventListener('click', openPasswordModal);
    document.getElementById('btn-edit-company').addEventListener('click', openCompanyModal);
    document.getElementById('btn-manual-backup').addEventListener('click', manualBackup);
}

function openPasswordModal() {
    document.getElementById('password-modal').style.display = 'flex';
    document.getElementById('old-password').value = '';
    document.getElementById('new-password').value = '';
    document.getElementById('confirm-password').value = '';
}

async function changePassword() {
    const oldPassword = document.getElementById('old-password').value;
    const newPassword = document.getElementById('new-password').value;
    const confirmPassword = document.getElementById('confirm-password').value;
    if (!oldPassword || !newPassword) { alert('أدخل كلمة المرور الحالية والجديدة'); return; }
    if (newPassword !== confirmPassword) { alert('كلمة المرور الجديدة غير متطابقة'); return; }
    if (newPassword.length < 6) { alert('كلمة المرور يجب أن تكون 6 أحرف على الأقل'); return; }

    try {
        const result = await api.invoke('login', { username: currentUser.username, password: oldPassword });
        if (!result.success) { alert('كلمة المرور الحالية خاطئة'); return; }

        const updateResult = await api.invoke('update-user', {
            id: currentUser.id,
            full_name: currentUser.full_name,
            username: currentUser.username,
            password: newPassword,
            role: currentUser.role,
            currentUserId: currentUser.id
        });
        if (updateResult.success) {
            localStorage.setItem(`pwd_changed_${currentUser.id}`, 'true');
            alert('تم تغيير كلمة المرور بنجاح');
            document.getElementById('password-modal').style.display = 'none';
        } else {
            alert('فشل تغيير كلمة المرور: ' + (updateResult.error || ''));
        }
    } catch (err) {
        alert('خطأ: ' + err.message);
    }
}

async function manualBackup() {
    const result = await api.invoke('manual-backup');
    if (result.success) alert(`تم النسخ الاحتياطي في: ${result.path}`);
    else alert('فشل النسخ الاحتياطي: ' + (result.error || ''));
}

function closeModal() {
    document.getElementById('modal').classList.remove('active');
    document.getElementById('password-modal').style.display = 'none';
}

// ========== لوحة المفاتيح اللمسية ==========
document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('toggle-keyboard-btn');
    const keyboard = document.getElementById('touch-keyboard');
    const closeBtn = document.getElementById('kb-close');

    if (toggleBtn && keyboard) {
        toggleBtn.addEventListener('click', () => {
            keyboard.style.display = keyboard.style.display === 'none' || !keyboard.style.display ? 'block' : 'none';
        });
    }
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            keyboard.style.display = 'none';
        });
    }

    document.querySelectorAll('.kb-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const char = btn.dataset.char;
            const activeElement = document.activeElement;
            if (!activeElement || !['INPUT', 'TEXTAREA'].includes(activeElement.tagName)) {
                const inputs = document.querySelectorAll('input[type="text"], input[type="number"], input[type="password"], textarea');
                if (inputs.length > 0) inputs[0].focus();
                return;
            }
            if (char === 'backspace') {
                const start = activeElement.selectionStart;
                const end = activeElement.selectionEnd;
                const value = activeElement.value;
                activeElement.value = value.substring(0, Math.max(0, start - (start === end ? 1 : 0))) + value.substring(end);
                const newPos = Math.max(0, start - (start === end ? 1 : 0));
                activeElement.selectionStart = activeElement.selectionEnd = newPos;
            } else if (char === 'space') {
                activeElement.value += ' ';
            } else if (char === 'clear') {
                activeElement.value = '';
            } else {
                activeElement.value += char;
            }
            activeElement.focus();
            activeElement.dispatchEvent(new Event('input', { bubbles: true }));
        });
    });
});

// ========== ربط أحداث القائمة الجانبية وأزرار النوافذ الثابتة ==========
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    const loginBtn = document.querySelector('#login-screen .btn-primary');
    if (loginBtn) loginBtn.addEventListener('click', submitLogin);

    document.getElementById('login-password')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submitLogin();
    });

    document.querySelector('#company-modal .btn-primary')?.addEventListener('click', saveCompanyFromModal);

    document.querySelector('#refund-modal .btn-danger')?.addEventListener('click', processRefund);
    document.querySelector('#refund-modal .btn-secondary')?.addEventListener('click', () => {
        document.getElementById('refund-modal').style.display = 'none';
    });

    document.querySelector('#password-modal .btn-primary')?.addEventListener('click', changePassword);
    document.querySelector('#password-modal .btn-secondary')?.addEventListener('click', () => {
        document.getElementById('password-modal').style.display = 'none';
    });

    document.querySelector('#cash-modal .btn-success')?.addEventListener('click', confirmCashPayment);
    document.querySelector('#cash-modal .btn-secondary')?.addEventListener('click', cancelCashPayment);
});

console.log('✅ نظام تقنيات سوفت المطور جاهز (مع خاصية سفري/محلي)');
