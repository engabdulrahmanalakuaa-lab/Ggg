const { contextBridge, ipcRenderer } = require('electron');

// ========== جسر أمان: نكشف فقط الدوال التي يحتاجها الواجهة ==========
// هذا يحل محل nodeIntegration:true + contextIsolation:false غير الآمن
contextBridge.exposeInMainWorld('api', {
    invoke: (channel, ...args) => {
        const allowedChannels = [
            'login', 'create-user', 'update-user', 'toggle-block',
            'get-company', 'update-company', 'get-tax-rate',
            'get-settings', 'save-settings',
            'db-query', 'db-run', 'db-get',
            'save-product', 'delete-product',
            'save-category', 'delete-category',
            'save-material', 'delete-material', 'add-stock',
            'create-order', 'refund-order',
            'open-shift', 'close-shift',
            'add-expense', 'delete-expense',
            'get-sales-report', 'get-profit-report', 'get-expense-report',
            'print-thermal', 'save-product-image', 'get-product-image',
            'manual-backup',
            'save-table', 'delete-table',
            'save-waiter', 'delete-waiter',
            'get-audit-log',
            'get-user-data-path', 'quit-app',
            'resolve-image-url'
        ];
        if (!allowedChannels.includes(channel)) {
            return Promise.reject(new Error('قناة غير مسموحة: ' + channel));
        }
        return ipcRenderer.invoke(channel, ...args);
    }
});
