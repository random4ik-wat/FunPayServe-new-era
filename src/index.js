// CLI Wizard — первый запуск
import { isFirstRun, runWizard } from './wizard.js';
if (await isFirstRun()) {
    await runWizard();
}

await import('./modules.js');

// MODULES
const log = global.log;
const c = global.chalk;
const { loadSettings } = global.storage;
const { exit } = global.helpers;
const { enableLotsRaise } = global.raise;
const { updateGoodsState } = global.goods;
const { updateCategoriesData } = global.categories;
const { getUserData, enableUserDataUpdate, countTradeProfit } = global.account;

const Runner = global.runner;
const TelegramBot = global.telegram;

const { enableAutoResponse, processMessages, processIncomingMessages, autoResponse, addUsersToFile } = global.chat;
const { checkForNewOrders, enableAutoIssue, getLotNames } = global.sales;
const { checkGoodsState, enableGoodsStateCheck } = global.activity;

global.startTime = Date.now();
global.errorStats = { count: 0 };

// UncaughtException Handler
process.on('uncaughtException', async (e) => {
    log('Ошибка: необработанное исключение. Сообщите об этом едитору.', 'r');
    log(e.stack);
    global.errorStats.count++;

    // AI диагностика
    if (settings?.ai?.enabled && settings?.ai?.systemAI && global.ai) {
        try {
            const diagnosis = await global.ai.diagnoseError(e.stack, 'uncaughtException');
            if (diagnosis && global.telegramBot) {
                global.telegramBot.sendAIDiagnosis(diagnosis, e.message);
            }
        } catch (_) { }
    }

    setTimeout(() => process.exit(1), 5000);
});

// UnhandledRejection Handler (для необработанных промисов)
process.on('unhandledRejection', async (reason, promise) => {
    log('Ошибка: необработанный промис. Сообщите об этом едитору.', 'r');
    log(reason?.stack || reason);
    global.errorStats.count++;

    if (settings?.ai?.enabled && settings?.ai?.systemAI && global.ai) {
        try {
            const diagnosis = await global.ai.diagnoseError(reason?.stack || String(reason), 'unhandledRejection');
            if (diagnosis && global.telegramBot) {
                global.telegramBot.sendAIDiagnosis(diagnosis, String(reason?.message || reason));
            }
        } catch (_) { }
    }

    setTimeout(() => process.exit(1), 5000);
});

// Graceful Shutdown (SIGINT / SIGTERM)
async function gracefulShutdown(signal) {
    log(`\n🛑 Получен сигнал ${signal}. Завершение...`, 'y');
    if (global.telegramBot) {
        try {
            const chatId = global.telegramBot.getChatID();
            if (chatId) {
                await global.telegramBot.bot.telegram.sendMessage(chatId, `🛑 Бот остановлен (${signal}).`);
            }
        } catch (_) { }
    }
    setTimeout(() => process.exit(0), 3000);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Loading data
const settings = global.settings;

// Health Endpoint (HTTP)
import { createServer } from 'http';
const HEALTH_PORT = 3001;
createServer((req, res) => {
    if (req.url === '/health' && req.method === 'GET') {
        const data = {
            status: 'ok',
            uptime: Math.floor((Date.now() - global.startTime) / 1000),
            ram: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1) + ' MB',
            errors: global.errorStats?.count || 0,
            account: global.appData?.userName || 'unknown'
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(data));
    } else {
        res.writeHead(404);
        res.end('Not Found');
    }
}).listen(HEALTH_PORT, () => {
    log(`Health endpoint: http://localhost:${HEALTH_PORT}/health`, 'g');
});

// REST API (порт 3002)
import { startAPI } from './api.js';
startAPI();

log(`Получаем данные пользователя...`, 'c');
const userData = await getUserData();
if (!userData) await exit();
log(`Привет, ${userData.userName}!`, 'm');

if (settings.lotsRaise == true)
    await updateCategoriesData();

if (settings.goodsStateCheck == true)
    await updateGoodsState();

const runner = new Runner();

// Starting threads
if (settings.lotsRaise == true)
    enableLotsRaise();

if (settings.goodsStateCheck == true || settings.autoIssue == true) {
    runner.registerNewOrderCallback(onNewOrder);
}

if (settings.goodsStateCheck == true) {
    enableGoodsStateCheck();
}

if (settings.autoIssue == true) {
    enableAutoIssue();
}

if (settings.autoResponse == true) {
    runner.registerNewMessageCallback(onNewMessage);
    enableAutoResponse();
}

if (settings.newMessageNotification == true && settings.greetingMessage == true) {
    runner.registerNewIncomingMessageCallback(onNewIncomingMessage);
}

if (settings.greetingMessage == true && settings.greetingMessageText) {
    await addUsersToFile();
}

enableUserDataUpdate(300 * 1000);

// Start runner loop
if (settings.alwaysOnline == true
    || settings.autoIssue == true
    || settings.autoResponse == true
    || settings.goodsStateCheck == true
    || settings.newMessageNotification == true
    || settings.newOrderNotification == true
    || settings.greetingMessage == true) {
    await runner.start();
}

// Start telegram bot
global.telegramBot = null;
if (settings.telegramBot == true) {
    global.telegramBot = new TelegramBot(settings.telegramToken);
    global.telegramBot.run();
}

if (settings.telegramBot == true && settings.newMessageNotification == true) {
    log(`Уведомления о новых сообщениях ${c.yellowBright('включены')}.`, 'g');
}

if (settings.telegramBot == true && settings.newOrderNotification == true) {
    log(`Уведомления о новых заказах ${c.yellowBright('включены')}.`, 'g');
}

if (settings.telegramBot == true && settings.lotsRaiseNotification == true) {
    log(`Уведомления о поднятии лотов ${c.yellowBright('включены')}.`, 'g');
}

if (settings.telegramBot == true && settings.deliveryNotification == true) {
    log(`Уведомления о выдаче товара ${c.yellowBright('включены')}.`, 'g');
}

// Callbacks
function onNewMessage() {
    processMessages();
}

function onNewIncomingMessage(message) {
    processIncomingMessages(message);
}

function onNewOrder() {
    if (settings.autoIssue == true) {
        checkForNewOrders();
    }

    if (settings.goodsStateCheck == true) {
        checkGoodsState();
    }
}