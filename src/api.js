// REST API Module
// Порт 3002, авторизация по X-API-Key
import { createServer } from 'http';

const log = global.log;

function startAPI(port = 3002) {
    const apiKey = global.settings.apiKey || process.env.FPS_API_KEY || '';

    if (!global.settings.apiEnabled) {
        return;
    }

    if (!apiKey) {
        log('⚠️ API включён, но apiKey не задан в settings.txt. API не запущен.', 'y');
        return;
    }

    const server = createServer(async (req, res) => {
        res.setHeader('Content-Type', 'application/json');

        // Проверка API-ключа
        const key = req.headers['x-api-key'];
        if (key !== apiKey) {
            res.writeHead(401);
            return res.end(JSON.stringify({ error: 'Unauthorized. Provide X-API-Key header.' }));
        }

        const url = req.url?.split('?')[0];

        try {
            if (url === '/api/status' && req.method === 'GET') {
                const data = {
                    status: 'ok',
                    uptime: Math.floor((Date.now() - global.startTime) / 1000),
                    ram: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1) + ' MB',
                    errors: global.errorStats?.count || 0,
                    account: global.appData?.userName || 'unknown',
                    version: global.version || '0.7.5'
                };
                res.writeHead(200);
                return res.end(JSON.stringify(data));
            }

            if (url === '/api/balance' && req.method === 'GET') {
                const data = {
                    balance: global.appData?.balance || 0,
                    history: (global.balanceHistory || []).slice(-24) // последние 24 точки
                };
                res.writeHead(200);
                return res.end(JSON.stringify(data));
            }

            if (url === '/api/orders' && req.method === 'GET') {
                const stats = global.deliveryStats || {};
                const data = {
                    delivered: stats.count || 0,
                    totalValue: stats.totalValue || 0,
                    orders: (stats.orders || []).slice(-20)
                };
                res.writeHead(200);
                return res.end(JSON.stringify(data));
            }

            if (url === '/api/stock' && req.method === 'GET') {
                const { load } = global.storage;
                const goods = await load('data/configs/delivery.json');
                const stock = (goods || []).map(g => ({
                    name: g.name,
                    count: g.nodes?.length || (g.message ? '∞' : 0)
                }));
                res.writeHead(200);
                return res.end(JSON.stringify({ stock }));
            }

            res.writeHead(404);
            res.end(JSON.stringify({ error: 'Not Found. Available: /api/status, /api/balance, /api/orders, /api/stock' }));
        } catch (err) {
            res.writeHead(500);
            res.end(JSON.stringify({ error: err.message }));
        }
    });

    server.listen(port, () => {
        log(`🔌 REST API запущен: http://localhost:${port}/api/status`, 'g');
    });

    return server;
}

export { startAPI };
