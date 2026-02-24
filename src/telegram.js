const c = global.chalk;
const Telegraf = global.telegraf;
const Keyboard = global.telegram_keyboard;
const { setConst, load, updateFile, getConst, loadConfig } = global.storage;
const { getLatestLogPath } = await import('./log.js');
import AdmZip from 'adm-zip';
const { sendMessage } = global.chat;
const log = global.log;

class TelegramBot {
    constructor(token) {
        this.bot = new Telegraf(token);

        process.once('SIGINT', () => this.bot.stop('SIGINT'));
        process.once('SIGTERM', () => this.bot.stop('SIGTERM'));
        this.bot.catch((err) => {
            log(`Ошибка бота telegram: ${err}`, 'r');
        })
    }

    async run() {
        this.setupListeners();
        this.setupAdditionalListeners();
        await this.setupBot();

        this.bot.launch();
        log(`Управление через telegram бота ${c.yellowBright(this.botInfo.username)} запущено.`, 'g');

        // Запуск ежедневных отчётов
        if (global.settings.dailyReport) {
            this.startDailyReportScheduler();
        }
    }

    async setupBot() {
        this.botInfo = await this.bot.telegram.getMe();
        this.bot.options.username = this.botInfo.username;

        this.mainKeyboard = this.getMainKeyboard();
        this.editGoodsKeyboard = this.getEditGoodsKeyboard();
        this.selectIssueTypeKeyboard = this.getSelectIssueTypeKeyboard();
        this.backKeyboard = this.getBackKeyboard();

        this.waitingForLotDelete = false;
        this.waitingForLotName = false;
        this.waitingForLotContent = false;
        this.waitingForDeliveryFile = false;
        this.waitingForReply = false;
        this.replyToNode = null;

        this.lotType = '';
        this.lotName = '';
        this.lotContent = '';
        this.products = [];
    }

    setupListeners() {
        this.bot.on('text', (ctx) => this.onMessage(ctx));
        this.bot.on('document', (ctx) => this.onMessage(ctx));
        this.bot.on('inline_query', (ctx) => this.onInlineQuery(ctx));
        this.bot.on('callback_query', (ctx) => this.onCallbackQuery(ctx));
    }

    async onMessage(ctx) {
        try {
            const msg = ctx.update.message.text;

            if (!this.isUserAuthed(ctx)) {
                ctx.reply('Привет! 😄\nДля авторизации введи свой ник в настройках FunPay Server, после чего перезапусти бота.');
                return;
            }

            if (msg == '🔥 Статус 🔥') {
                this.replyStatus(ctx);
                return;
            }

            if (msg == '🚀 Редактировать автовыдачу 🚀') {
                this.editAutoIssue(ctx);
                return;
            }

            if (msg == '❓ Инфо ❓') {
                this.getInfo(ctx);
                return;
            }

            if (msg == '📦 Остатки 📦') {
                await this.replyStock(ctx);
                return;
            }

            if (msg == '🔄 Настройки 🔄') {
                await this.reloadSettings(ctx);
                return;
            }

            if (msg == '🤖 AI 🤖') {
                await this.replyAIStatus(ctx);
                return;
            }

            if (msg == '📋 Логи 📋') {
                await this.sendLogFile(ctx);
                return;
            }

            if (msg == '📊 Экспорт CSV 📊') {
                await this.exportCSV(ctx);
                return;
            }

            if (msg == '🔄 Настройки 🔄') {
                this.sendSettingsMenu(ctx);
                return;
            }

            if (msg == '☑️ Добавить товар ☑️') {
                this.addProduct(ctx);
                return;
            }

            if (msg == '💾 Бэкап 💾') {
                await this.exportBackup(ctx);
                return;
            }

            if (msg.startsWith('/test ')) {
                await this.testAutoResponse(ctx, msg.replace('/test ', ''));
                return;
            }

            if (msg == '📛 Удалить товар 📛') {
                this.removeProduct(ctx);
                return;
            }

            if (msg == 'Инструкция (выдача одного и того же текста)') {
                this.lotType = 'instruction';
                this.addProductName(ctx);
                return;
            }

            if (msg == 'Аккаунты (выдача разных текстов по очереди)') {
                this.lotType = 'accounts';
                this.addProductName(ctx);
                return;
            }

            if (msg == '⬇️ Получить файл автовыдачи ⬇️') {
                await this.getAutoIssueFile(ctx);
                return;
            }

            if (msg == '⬆️ Загрузить файл автовыдачи ⬆️') {
                this.uploadAutoIssueFile(ctx);
                return;
            }

            if (msg == '🔙 Назад 🔙') {
                await this.back(ctx);
                return;
            }

            if (this.waitingForLotName) {
                await this.saveLotName(ctx);
                return;
            }

            if (this.waitingForLotContent) {
                await this.saveLotContent(ctx);
                return;
            }

            if (this.waitingForLotDelete) {
                await this.deleteLot(ctx);
                return;
            }

            if (this.waitingForDeliveryFile) {
                await this.onUploadDeliveryFile(ctx);
                return;
            }

            if (this.waitingForReply) {
                await this.onReplyMessage(ctx);
                return;
            }

            this.waitingForLotName = false;
            this.waitingForLotContent = false;
            this.waitingForLotDelete = false;
            this.waitingForDeliveryFile = false;

            ctx.reply('🏠 Меню', this.mainKeyboard.reply());
        } catch (err) {
            log(`Ошибка при обработке telegram сообщения: ${err}`, 'r');
            ctx.reply(`Воу! Я словил ошибку... Хз как так получилось, но вот всё, что мне известно: ${err}`, this.mainKeyboard.reply());
        }
    }

    setupAdditionalListeners() {
        this.bot.on('callback_query', async (ctx, next) => {
            if (!this.isUserAuthed(ctx)) return;
            const data = ctx.callbackQuery.data;

            if (data && data.startsWith('toggle_')) {
                const setting = data.replace('toggle_', '');
                await this.toggleSetting(ctx, setting);
            }
            return next();
        });

        // Слушатель для ответов на сообщения (Push-ответы на FunPay)
        this.bot.on('text', async (ctx, next) => {
            if (!this.isUserAuthed(ctx)) return next();
            const replyTo = ctx.message.reply_to_message;
            if (replyTo && replyTo.text && replyTo.text.includes('Новое сообщение от')) {
                // Извлекаем никнейм из сообщения бота (формат: ✉️ Новое сообщение от Nickname:)
                const match = replyTo.text.match(/Новое сообщение от (.*?):/);
                if (match && match[1]) {
                    const buyerName = match[1].trim();
                    // Ищем чат с этим пользователем
                    const chats = global.appData?.chats || [];
                    const chat = chats.find(c => c.name === buyerName);

                    if (chat) {
                        const success = await sendMessage(chat.node, ctx.message.text, false, global.settings.watermarkInAutoResponse);
                        if (success) {
                            ctx.reply(`✅ Сообщение отправлено пользователю ${buyerName}`);
                        } else {
                            ctx.reply(`❌ Ошибка отправки пользователю ${buyerName}`);
                        }
                    } else {
                        ctx.reply(`❌ Чат с пользователем ${buyerName} не найден в памяти. Попробуйте обновить страницу диалогов FunPay.`);
                    }
                    return;
                }
            }
            return next();
        });
    }

    isUserAuthed(ctx) {
        const from = ctx.update.message?.from || ctx.update.callback_query?.from;
        if (!from) return false;

        // Приоритет: авторизация по массиву User ID
        const userIds = global.settings.userId;
        if (Array.isArray(userIds) && userIds.length > 0) {
            if (userIds.includes(from.id)) {
                if (!getConst('chatId')) setConst('chatId', ctx.update.message?.chat?.id || ctx.update.callback_query?.message?.chat?.id);
                return true;
            }
            return false;
        }

        // Fallback: авторизация по username
        if (global.settings.userName === from.username) {
            if (!getConst('chatId')) setConst('chatId', ctx.update.message?.chat?.id);
            log(`⚠️ Рекомендуем перейти на авторизацию по userId. Ваш ID: ${from.id}. Укажите его в settings.txt.`, 'y');
            return true;
        }
        return false;
    }

    getMainKeyboard() {
        const keyboard = Keyboard.make([
            ['🔥 Статус 🔥'],
            ['🚀 Редактировать автовыдачу 🚀'],
            ['📦 Остатки 📦', '❓ Инфо ❓'],
            ['🤖 AI 🤖', '📋 Логи 📋'],
            ['📊 Экспорт CSV 📊', '💾 Бэкап 💾'],
            ['🔄 Настройки 🔄']
        ]);

        return keyboard;
    }

    getSettingsKeyboard() {
        const s = global.settings;
        const keyboard = Keyboard.make([
            [Keyboard.callbackButton(`Автовыдача: ${s.autoIssue ? '✅ Вкл' : '❌ Выкл'}`, 'toggle_autoIssue')],
            [Keyboard.callbackButton(`Автоподнятие: ${s.lotsRaise ? '✅ Вкл' : '❌ Выкл'}`, 'toggle_lotsRaise')],
            [Keyboard.callbackButton(`Автоответ: ${s.autoResponse ? '✅ Вкл' : '❌ Выкл'}`, 'toggle_autoResponse')],
            [Keyboard.callbackButton(`Телеграм уведомления ⬇️`, 'dummy')],
            [Keyboard.callbackButton(`Сообщения: ${s.newMessageNotification ? '✅' : '❌'}`, 'toggle_newMessageNotification'), Keyboard.callbackButton(`Заказы: ${s.newOrderNotification ? '✅' : '❌'}`, 'toggle_newOrderNotification')],
        ]);
        return keyboard;
    }

    getEditGoodsKeyboard() {
        const keyboard = Keyboard.make([
            ['☑️ Добавить товар ☑️', '📛 Удалить товар 📛'],
            ['⬇️ Получить файл автовыдачи ⬇️', '⬆️ Загрузить файл автовыдачи ⬆️'],
            ['🔙 Назад 🔙']
        ]);

        return keyboard;
    }

    getSelectIssueTypeKeyboard() {
        const keyboard = Keyboard.make([
            ['Инструкция (выдача одного и того же текста)'],
            ['Аккаунты (выдача разных текстов по очереди)'],
            ['🔙 Назад 🔙']
        ]);

        return keyboard;
    }

    getBackKeyboard() {
        const keyboard = Keyboard.make([
            ['🔙 Назад 🔙']
        ]);

        return keyboard;
    }

    async replyStatus(ctx) {
        const time = Date.now();
        const workTimeDiff = time - global.startTime;
        const lastUpdateTimeDiff = time - global.appData.lastUpdate;

        function declensionNum(num, words) {
            return words[(num % 100 > 4 && num % 100 < 20) ? 2 : [2, 0, 1, 1, 1, 2][(num % 10 < 5) ? num % 10 : 5]];
        }

        function msToTime(ms) {
            let days = ms > 0 ? Math.floor(ms / 1000 / 60 / 60 / 24) : 0;
            let hours = ms > 0 ? Math.floor(ms / 1000 / 60 / 60) % 24 : 0;
            let minutes = ms > 0 ? Math.floor(ms / 1000 / 60) % 60 : 0;
            let seconds = ms > 0 ? Math.floor(ms / 1000) % 60 : 0;
            days = ms < 10 ? '0' + days : days;
            hours = hours < 10 ? '0' + hours : hours;
            minutes = minutes < 10 ? '0' + minutes : minutes;
            seconds = seconds < 10 ? '0' + seconds : seconds;
            const daysTitle = declensionNum(days, ['день', 'дня', 'дней']);
            const hoursTitle = declensionNum(hours, ['час', 'часа', 'часов']);
            const minutesTitle = declensionNum(minutes, ['минута', 'минуты', 'минут']);
            const secondsTitle = declensionNum(seconds, ['секунда', 'секунды', 'секунд']);
            return { days: days, hours: hours, minutes: minutes, seconds: seconds, daysTitle: daysTitle, hoursTitle: hoursTitle, minutesTitle: minutesTitle, secondsTitle: secondsTitle };
        }

        const workTimeArr = msToTime(workTimeDiff);
        const workTime = `${workTimeArr.days} ${workTimeArr.daysTitle} ${workTimeArr.hours} ${workTimeArr.hoursTitle} ${workTimeArr.minutes} ${workTimeArr.minutesTitle} ${workTimeArr.seconds} ${workTimeArr.secondsTitle}`;

        const lastUpdateTimeArr = msToTime(lastUpdateTimeDiff);
        const lastUpdateTime = `${lastUpdateTimeArr.minutes} ${lastUpdateTimeArr.minutesTitle} ${lastUpdateTimeArr.seconds} ${lastUpdateTimeArr.secondsTitle}`;

        const autoIssue = (global.settings.autoIssue) ? 'Вкл' : 'Выкл';
        const alwaysOnline = (global.settings.alwaysOnline) ? 'Вкл' : 'Выкл';
        const lotsRaise = (global.settings.lotsRaise) ? 'Вкл' : 'Выкл';
        const goodsStateCheck = (global.settings.goodsStateCheck) ? 'Вкл' : 'Выкл';
        const autoResponse = (global.settings.autoResponse) ? 'Вкл' : 'Выкл';

        const deliveredCount = global.deliveryStats ? global.deliveryStats.count : 0;
        const deliveredValue = global.deliveryStats ? global.deliveryStats.totalValue : 0;
        const errorCount = global.errorStats ? global.errorStats.count : 0;

        // RAM usage
        const ramMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

        // Комиссия FP (~5%) и чистая прибыль
        const commission = (deliveredValue * 0.05).toFixed(2);
        const netProfit = (deliveredValue - commission).toFixed(2);

        const msg = `🔥 <b>Статус</b> 🔥\n\n🔑 Аккаунт: <code>${global.appData.userName}</code>\n💰 Баланс: <code>${global.appData.balance}</code>\n🛍️ Продажи: <code>${global.appData.sales}</code>\n♻️ Последнее обновление: <code>${lastUpdateTime} назад</code>\n\n🕒 Время работы: <code>${workTime}</code>\n⏲ Всегда онлайн: <code>${alwaysOnline}</code>\n👾 Автоответ: <code>${autoResponse}</code>\n🚀 Автовыдача: <code>${autoIssue}</code>\n🏆 Автоподнятие предложений: <code>${lotsRaise}</code>\n🔨 Автовосстановление предложений: <code>${goodsStateCheck}</code>\n\n📦 Выдано за сессию: <code>${deliveredCount} шт.</code> на <code>${deliveredValue} ₽</code>\n💰 Комиссия FP (~5%): <code>${commission} ₽</code>\n💵 Чистая прибыль: <code>${netProfit} ₽</code>\n⚠️ Ошибок за сессию: <code>${errorCount}</code>\n🖥️ RAM: <code>${ramMB} MB</code>\n\n<i><a href="https://t.me/fplite">FunPayServer</a></i>`;
        const params = this.mainKeyboard.reply();
        params.disable_web_page_preview = true;
        ctx.replyWithHTML(msg, params);
    }

    async editAutoIssue(ctx) {
        try {
            const goods = await load('data/configs/delivery.json');
            let goodsStr = '';

            let msg = `📄 <b>Список товаров</b> 📄`;
            await ctx.replyWithHTML(msg, this.editGoodsKeyboard.reply());

            for (let i = 0; i < goods.length; i++) {
                goodsStr += `[${i + 1}] ${goods[i].name}\n`;

                if (goodsStr.length > 3000) {
                    await ctx.replyWithHTML(goodsStr, this.editGoodsKeyboard.reply());
                    goodsStr = '';
                }

                if (i == (goods.length - 1)) {
                    await ctx.replyWithHTML(goodsStr, this.editGoodsKeyboard.reply());
                }
            }
        } catch (err) {
            log(`Ошибка при выдаче списка товаров: ${err}`, 'r');
        }
    }

    getInfo(ctx) {
        const msg = `❔ <b>FunPayServer</b> ❔\n\n<b>FunPayServer</b> - это бот для площадки funpay.com с открытым исходным кодом, разработанный <b>NightStranger</b>.\n\nБольшое спасибо всем, кто поддерживает данный проект ❤️. Он живёт благодаря вам.\n\n<a href="https://github.com/NightStrang6r/FunPayServer">GitHub</a> | <a href="https://github.com/NightStrang6r/FunPayServer">Поддержать проект</a>`;
        ctx.replyWithHTML(msg);
    }

    async replyStock(ctx) {
        try {
            const goods = await load('data/configs/delivery.json');
            if (!goods || goods.length === 0) {
                ctx.reply('📦 Список автовыдачи пуст.', this.mainKeyboard.reply());
                return;
            }

            let msg = `📦 <b>Остатки товаров</b>\n\n`;
            for (let i = 0; i < goods.length; i++) {
                const item = goods[i];
                let stock = '∞';
                if (item.nodes && Array.isArray(item.nodes)) {
                    stock = `${item.nodes.length} шт.`;
                } else if (item.message) {
                    stock = '∞ (текст)';
                }
                msg += `[${i + 1}] <code>${item.name}</code> — ${stock}\n`;
            }

            ctx.replyWithHTML(msg, this.mainKeyboard.reply());
        } catch (err) {
            log(`Ошибка при получении остатков: ${err}`, 'r');
            ctx.reply('❌ Ошибка при получении остатков.', this.mainKeyboard.reply());
        }
    }

    async reloadSettings(ctx) {
        try {
            const newSettings = loadConfig();
            Object.assign(global.settings, newSettings);
            ctx.reply('✅ Настройки перезагружены из settings.txt!', this.mainKeyboard.reply());
            log('Настройки перезагружены из Telegram.', 'g');
        } catch (err) {
            log(`Ошибка при перезагрузке настроек: ${err}`, 'r');
            ctx.reply(`❌ Ошибка: ${err}`, this.mainKeyboard.reply());
        }
    }

    async exportCSV(ctx) {
        try {
            const fs = global.fs_extra;
            const stats = global.deliveryStats;

            if (!stats || !stats.orders || stats.orders.length === 0) {
                ctx.reply('📊 Нет данных о продажах за эту сессию.', this.mainKeyboard.reply());
                return;
            }

            let csv = 'Покупатель,Товар,Сумма,Дата\n';
            for (const order of stats.orders) {
                const buyer = (order.buyer || '').replace(/,/g, ';');
                const product = (order.product || '').replace(/,/g, ';');
                csv += `${buyer},${product},${order.value || 0},${order.date || ''}\n`;
            }

            const csvPath = `${process.cwd()}/data/export_sales.csv`;
            await fs.writeFile(csvPath, '\uFEFF' + csv); // BOM для Excel

            await ctx.replyWithDocument(
                { source: csvPath, filename: `sales_${new Date().toISOString().slice(0, 10)}.csv` },
                { caption: `📊 Экспорт продаж (${stats.orders.length} записей)` }
            );
        } catch (err) {
            log(`Ошибка экспорта CSV: ${err}`, 'r');
            ctx.reply(`❌ Ошибка: ${err}`, this.mainKeyboard.reply());
        }
    }

    async exportBackup(ctx) {
        try {
            const zip = new AdmZip();
            const fs = global.fs_extra;
            const cwd = process.cwd();

            if (await fs.exists(`${cwd}/settings.txt`)) zip.addLocalFile(`${cwd}/settings.txt`);
            if (await fs.exists(`${cwd}/s.example`)) zip.addLocalFile(`${cwd}/s.example`);
            if (await fs.exists(`${cwd}/data/configs`)) zip.addLocalFolder(`${cwd}/data/configs`, 'data/configs');

            const backupPath = `${cwd}/data/backup_${Date.now()}.zip`;
            zip.writeZip(backupPath);

            await ctx.replyWithDocument(
                { source: backupPath, filename: backupPath.split('/').pop() },
                { caption: `💾 Резервная копия настроек и конфигов` }
            );

            // Clean up
            await fs.unlink(backupPath);
        } catch (err) {
            log(`Ошибка создания бэкапа: ${err}`, 'r');
            ctx.reply(`❌ Ошибка создания бэкапа: ${err}`, this.mainKeyboard.reply());
        }
    }

    async testAutoResponse(ctx, testMessage) {
        try {
            const autoRespData = await load('data/configs/autoResponse.json');
            if (!autoRespData || !autoRespData.length) {
                return ctx.reply('❌ Нет конфигов автоответа.', this.mainKeyboard.reply());
            }

            function levenshtein(a, b) {
                const dp = Array.from({ length: a.length + 1 }, (_, i) => Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
                for (let i = 1; i <= a.length; i++) {
                    for (let j = 1; j <= b.length; j++) {
                        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0));
                    }
                }
                return dp[a.length][b.length];
            }

            for (let i = 0; i < autoRespData.length; i++) {
                if (autoRespData[i].command && testMessage.trim().toLowerCase() === autoRespData[i].command.toLowerCase()) {
                    return ctx.reply(`✅ <b>Точное совпадение:</b> ${autoRespData[i].command}\n\n<b>Ответ:</b>\n${autoRespData[i].response}`, { parse_mode: 'HTML' });
                }
                if (autoRespData[i].word && testMessage.trim().toLowerCase().includes(autoRespData[i].word.toLowerCase())) {
                    return ctx.reply(`✅ <b>Ключевое слово:</b> ${autoRespData[i].word}\n\n<b>Ответ:</b>\n${autoRespData[i].response}`, { parse_mode: 'HTML' });
                }
            }

            for (let i = 0; i < autoRespData.length; i++) {
                if (autoRespData[i].command) {
                    const dist = levenshtein(testMessage.trim().toLowerCase(), autoRespData[i].command.toLowerCase());
                    if (dist > 0 && dist <= 2) {
                        return ctx.reply(`⚠️ <b>Нечёткое совпадение (Fuzzy):</b> ${autoRespData[i].command} (опечаток: ${dist})\n\n<b>Ответ:</b>\n${autoRespData[i].response}`, { parse_mode: 'HTML' });
                    }
                }
            }

            if (global.settings.ai?.enabled && global.settings.ai?.chatAI) {
                return ctx.reply(`🗣️ <b>Совпадений нет.</b> Сообщение было бы передано нейросети (AI Chat).`, { parse_mode: 'HTML' });
            }

            ctx.reply('❌ <b>Совпадений нет.</b> Бот бы ничего не ответил.', { parse_mode: 'HTML' });
        } catch (err) {
            ctx.reply(`❌ Ошибка проверки: ${err}`, this.mainKeyboard.reply());
        }
    }

    async sendLogFile(ctx) {
        try {
            const fs = global.fs_extra;
            const logPath = getLatestLogPath();
            if (!(await fs.exists(logPath))) {
                ctx.reply('📋 Лог-файл за сегодня ещё не создан.', this.mainKeyboard.reply());
                return;
            }

            const stat = await fs.stat(logPath);
            if (stat.size > 50 * 1024 * 1024) {
                ctx.reply('📋 Лог слишком большой (>50MB). Проверьте сервер.', this.mainKeyboard.reply());
                return;
            }

            await ctx.replyWithDocument(
                { source: logPath, filename: logPath.split('/').pop() },
                { caption: `📋 Лог за сегодня (${(stat.size / 1024).toFixed(1)} KB)` }
            );
        } catch (err) {
            log(`Ошибка отправки логов: ${err}`, 'r');
            ctx.reply(`❌ Ошибка: ${err}`, this.mainKeyboard.reply());
        }
    }

    async replyAIStatus(ctx) {
        const ai = global.settings?.ai;
        const stats = global.ai?.getStats ? global.ai.getStats() : { chatRequests: 0, systemRequests: 0, errors: 0 };

        const enabled = ai?.enabled ? '✅ Вкл' : '❌ Выкл';
        const chatAI = ai?.chatAI ? '✅ Вкл' : '❌ Выкл';
        const systemAI = ai?.systemAI ? '✅ Вкл' : '❌ Выкл';
        const model = ai?.model || 'не указана';
        const hasKey = ai?.apiKey ? '✅ Указан' : '❌ Не указан';

        let msg = `🤖 <b>AI Статус</b>\n\n`;
        msg += `📡 AI: <code>${enabled}</code>\n`;
        msg += `🔑 API Key: <code>${hasKey}</code>\n`;
        msg += `🧠 Модель: <code>${model}</code>\n\n`;
        msg += `💬 Chat AI: <code>${chatAI}</code>\n`;
        msg += `🔧 System AI: <code>${systemAI}</code>\n\n`;
        msg += `📊 <b>Статистика за сессию:</b>\n`;
        msg += `   ├ Ответов покупателям: <code>${stats.chatRequests}</code>\n`;
        msg += `   ├ Диагностик ошибок: <code>${stats.systemRequests}</code>\n`;
        msg += `   └ Ошибок AI: <code>${stats.errors}</code>`;

        ctx.replyWithHTML(msg, this.mainKeyboard.reply());
    }

    async sendAIDiagnosis(diagnosis, errorShort) {
        let msg = `🤖 <b>AI Диагноз ошибки</b>\n\n`;
        msg += `❌ <b>Ошибка:</b> <code>${(errorShort || '').substring(0, 200)}</code>\n\n`;
        msg += `🔍 <b>AI анализ:</b>\n${diagnosis}`;

        let chatId = this.getChatID();
        if (!chatId) return;
        this.bot.telegram.sendMessage(chatId, msg, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
    }

    async sendDisputeAlert(userName, messageText) {
        let msg = `🚨🚨🚨 <b>СПОР ОБНАРУЖЕН!</b> 🚨🚨🚨\n\n`;
        msg += `👤 <b>Пользователь:</b> <code>${userName}</code>\n`;
        msg += `💬 <b>Сообщение:</b> ${(messageText || '').substring(0, 300)}`;

        let chatId = this.getChatID();
        if (!chatId) return;
        this.bot.telegram.sendMessage(chatId, msg, {
            parse_mode: 'HTML',
            disable_notification: false
        });
    }

    async sendBalanceChange(oldBalance, newBalance) {
        const arrow = Number(newBalance) > Number(oldBalance) ? '📈' : '📉';
        let msg = `${arrow} <b>Баланс изменился</b>\n\n`;
        msg += `💰 <code>${oldBalance}</code> → <code>${newBalance}</code>`;

        let chatId = this.getChatID();
        if (!chatId) return;
        this.bot.telegram.sendMessage(chatId, msg, {
            parse_mode: 'HTML'
        });
    }

    async sendAIChatNotification(buyerName, question, answer) {
        let msg = `🤖 <b>AI ответил покупателю</b>\n\n`;
        msg += `👤 <b>Покупатель:</b> <code>${buyerName}</code>\n`;
        msg += `❓ <b>Вопрос:</b> ${question.substring(0, 200)}\n\n`;
        msg += `💬 <b>AI ответ:</b> ${answer.substring(0, 300)}`;

        let chatId = this.getChatID();
        if (!chatId) return;
        this.bot.telegram.sendMessage(chatId, msg, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
    }

    addProduct(ctx) {
        ctx.replyWithHTML(`Выбери тип предложения`, this.selectIssueTypeKeyboard.reply());
    }

    addProductName(ctx) {
        ctx.replyWithHTML(`Окей, отправь мне название предложения. Можешь просто скопирвать его из funpay. Эмодзи в названии поддерживаются.`);
        this.waitingForLotName = true;
    }

    removeProduct(ctx) {
        ctx.replyWithHTML(`Введи номер товара, который нужно удалить из списка автовыдачи.`);
        this.waitingForLotDelete = true;
    }

    async back(ctx) {
        this.waitingForLotName = false;
        this.waitingForLotContent = false;
        this.waitingForLotDelete = false;
        this.waitingForDeliveryFile = false;
        this.waitingForReply = false;
        this.replyToNode = null;

        if (this.products.length > 0) {
            let goods = await load('data/configs/delivery.json');

            const product = {
                "name": this.lotName,
                "nodes": this.products
            }

            goods.push(product);
            await updateFile(goods, 'data/configs/delivery.json');
            this.products = [];
        }

        ctx.reply('🏠 Меню', this.mainKeyboard.reply());
    }

    async saveLotName(ctx) {
        const msg = ctx.update.message.text;

        this.waitingForLotName = false;
        this.lotName = msg;

        let replyMessage = 'Понял-принял. Теперь отправь мне сообщение, которое будет выдано покупателю после оплаты.';
        if (this.lotType == 'accounts') {
            replyMessage = 'Понял-принял. Теперь отправь мне сообщение, которое будет выдано покупателю после оплаты. Ты можешь отправить несколько сообщений. Каждое сообщение будет выдано после каждой покупки. Нажми "🔙 Назад 🔙" когда закончишь заполнять товар.';
        }

        ctx.reply(replyMessage, this.backKeyboard.reply());
        this.waitingForLotContent = true;
    }

    async saveLotContent(ctx) {
        const msg = ctx.update.message.text;

        this.lotContent = msg;
        let keyboard = this.backKeyboard;
        let goods = await load('data/configs/delivery.json');

        if (this.lotType != 'accounts') {
            this.waitingForLotContent = false;
            keyboard = this.mainKeyboard;

            const product = {
                "name": this.lotName,
                "message": this.lotContent
            }

            goods.push(product);
            await updateFile(goods, 'data/configs/delivery.json');

            this.lotName = '';
            this.lotContent = '';
        } else {
            keyboard = this.backKeyboard;

            this.products.push(msg);
        }

        ctx.reply(`Окей, сохранил товар.`, keyboard.reply());
    }

    async deleteLot(ctx) {
        const msg = ctx.update.message.text;
        this.waitingForLotDelete = false;

        let num = Number(msg);
        if (isNaN(num)) {
            ctx.reply(`Что-то это не похоже на число... Верну тебя в меню.`, this.mainKeyboard.reply());
            return;
        }

        let goods = await load('data/configs/delivery.json');
        if (num > goods.length || num < 0) {
            ctx.reply(`Такого id нет в списке автовыдачи. Верну тебя в меню.`, this.mainKeyboard.reply());
            return;
        }

        let name = goods[num - 1].name;
        goods.splice(num - 1, 1);
        await updateFile(goods, 'data/configs/delivery.json');

        ctx.reply(`Ок, удалил товар "${name}" из списка автовыдачи.`, this.mainKeyboard.reply());
    }

    async getAutoIssueFile(ctx) {
        let contents = getConst('autoIssueFilePath');

        ctx.replyWithDocument({
            source: contents,
            filename: 'delivery.json'
        }).catch(function (error) { log(error); })
    }

    uploadAutoIssueFile(ctx) {
        this.waitingForDeliveryFile = true;
        ctx.reply(`Окей, пришли мне файл автовыдачи в формате JSON.`, this.backKeyboard.reply());
    }

    async onUploadDeliveryFile(ctx) {
        let file = ctx.update.message.document;
        let file_id = file.file_id;
        let file_name = file.file_name;
        let contents = null;

        if (file_name != 'delivery.json') {
            ctx.reply(`❌ Неверный формат файла.`, this.mainKeyboard.reply());
            return;
        }

        try {
            ctx.reply(`♻️ Загружаю файл...`);

            let file_path = await this.bot.telegram.getFileLink(file_id);
            let fileContents = await fetch(file_path);
            contents = await fileContents.text();
        } catch (e) {
            ctx.reply(`❌ Не удалось загрузить файл.`, this.mainKeyboard.reply());
            return;
        }

        try {
            ctx.reply(`♻️ Проверяю валидность...`);

            let json = JSON.parse(contents);
            await updateFile(json, 'data/configs/delivery.json');
            ctx.reply(`✔️ Окей, обновил файл автовыдачи.`, this.editGoodsKeyboard.reply());
        } catch (e) {
            ctx.reply(`❌ Неверный формат JSON.`, this.mainKeyboard.reply());
        }
    }

    async onInlineQuery(ctx) {
        console.log(ctx);
    }

    async onCallbackQuery(ctx) {
        try {
            const data = ctx.update.callback_query.data;
            const from = ctx.update.callback_query.from;

            // Проверяем авторизацию
            if (global.settings.userId && global.settings.userId !== 0) {
                if (global.settings.userId !== from.id) return ctx.answerCbQuery('⛔ Нет доступа');
            } else if (global.settings.userName !== from.username) {
                return ctx.answerCbQuery('⛔ Нет доступа');
            }

            // Обработка кнопки "Ответить"
            if (data.startsWith('reply_')) {
                const node = data.replace('reply_', '');
                this.waitingForReply = true;
                this.replyToNode = node;
                await ctx.answerCbQuery('✍️ Введите ответ');
                await ctx.reply(`✍️ Введите сообщение для отправки в чат (node: ${node})\nНажмите "🔙 Назад 🔙" для отмены.`, this.backKeyboard.reply());
                return;
            }

            await ctx.answerCbQuery();
        } catch (err) {
            log(`Ошибка при обработке callback_query: ${err}`, 'r');
        }
    }

    getChatID() {
        let chatId = getConst('chatId');
        if (!chatId) {
            log(`Напишите своему боту в Telegram, чтобы он мог отправлять вам уведомления.`);
            return false;
        }
        return chatId;
    }

    async sendNewMessageNotification(message) {
        let msg = `💬 <b>Новое сообщение</b> от пользователя <b><i>${message.user}</i></b>.\n\n`;
        msg += `${message.content}\n\n`;
        msg += `<i>${message.time}</i> | <a href="https://funpay.com/chat/?node=${message.node}">Перейти в чат</a>`

        let chatId = this.getChatID();
        if (!chatId) return;
        this.bot.telegram.sendMessage(chatId, msg, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '💬 Ответить', callback_data: `reply_${message.node}` },
                        { text: '🔗 Открыть чат', url: `https://funpay.com/chat/?node=${message.node}` }
                    ]
                ]
            }
        });
    }

    async sendNewOrderNotification(order) {
        let msg = `✔️ <b>Новый заказ</b> <a href="https://funpay.com/orders/${order.id.replace('#', '')}/">${order.id}</a> на сумму <b><i>${order.price} ${order.unit}</i></b>.\n\n`;
        msg += `👤 <b>Покупатель:</b> <a href="https://funpay.com/users/${order.buyerId}/">${order.buyerName}</a>\n`;
        msg += `🛍️ <b>Товар:</b> <code>${order.name}</code>`;

        let chatId = this.getChatID();
        if (!chatId) return;
        this.bot.telegram.sendMessage(chatId, msg, {
            parse_mode: 'HTML',
            disable_web_page_preview: true,
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: '🔗 Открыть заказ', url: `https://funpay.com/orders/${order.id.replace('#', '')}/` }
                    ]
                ]
            }
        });
    }

    async sendLotsRaiseNotification(category, nextTimeMsg) {
        let msg = `⬆️ Предложения в категории <a href="https://funpay.com/lots/${category.node_id}/trade">${category.name}</a> подняты.\n`;
        msg += `⌚ Следующее поднятие: <b><i>${nextTimeMsg}</i></b>`;

        let chatId = this.getChatID();
        if (!chatId) return;
        this.bot.telegram.sendMessage(chatId, msg, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
    }

    async sendDeliveryNotification(buyerName, productName, message) {
        let msg = `📦 Товар <code>${productName}</code> выдан покупателю <b><i>${buyerName}</i></b> с сообщением:\n\n`;
        msg += `${message}`;

        let chatId = this.getChatID();
        if (!chatId) return;
        this.bot.telegram.sendMessage(chatId, msg, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
    }

    async sendLowStockAlert(productName, remaining) {
        let msg = `⚠️ <b>Низкий остаток товара!</b>\n\n`;
        msg += `🛍️ <b>Товар:</b> <code>${productName}</code>\n`;
        msg += `📦 <b>Осталось:</b> <code>${remaining} шт.</code>\n\n`;
        msg += `Пополните запас, чтобы не потерять продажи!`;

        let chatId = this.getChatID();
        if (!chatId) return;
        this.bot.telegram.sendMessage(chatId, msg, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
    }

    async sendErrorAlert(consecutiveErrors) {
        let msg = `🚨 <b>Множественные ошибки!</b>\n\n`;
        msg += `Бот получил <code>${consecutiveErrors}</code> ошибок подряд.\n`;
        msg += `Интервал опроса увеличен до <code>30с</code>.\n\n`;
        msg += `Возможные причины:\n`;
        msg += `• FunPay недоступен\n`;
        msg += `• Проблемы с интернетом\n`;
        msg += `• Истёк golden_key\n\n`;
        msg += `Бот продолжает попытки подключения.`;

        let chatId = this.getChatID();
        if (!chatId) return;
        this.bot.telegram.sendMessage(chatId, msg, {
            parse_mode: 'HTML',
            disable_web_page_preview: true
        });
    }

    async onReplyMessage(ctx) {
        try {
            const msg = ctx.update.message.text;
            const node = this.replyToNode;

            this.waitingForReply = false;
            this.replyToNode = null;

            if (!node || !msg) {
                ctx.reply('❌ Не удалось отправить ответ.', this.mainKeyboard.reply());
                return;
            }

            const result = await sendMessage(node, msg, false);

            if (result) {
                ctx.reply(`✅ Сообщение отправлено в чат.`, this.mainKeyboard.reply());
                log(`Сообщение отправлено в чат (node: ${node}) из Telegram: ${msg}`, 'g');
            } else {
                ctx.reply(`❌ Не удалось отправить сообщение.`, this.mainKeyboard.reply());
            }
        } catch (err) {
            log(`Ошибка при отправке ответа из Telegram: ${err}`, 'r');
            ctx.reply(`❌ Ошибка: ${err}`, this.mainKeyboard.reply());
        }
    }

    startDailyReportScheduler() {
        const targetHour = global.settings.dailyReportHour || 20;

        const scheduleNext = () => {
            const now = new Date();
            const next = new Date();
            next.setHours(targetHour, 0, 0, 0);

            if (next <= now) {
                next.setDate(next.getDate() + 1);
            }

            const msUntil = next.getTime() - now.getTime();
            log(`📊 Ежедневный отчёт запланирован на ${targetHour}:00 (через ${Math.round(msUntil / 1000 / 60)} мин).`, 'c');

            setTimeout(() => {
                this.sendDailyReport();
                scheduleNext();
            }, msUntil);
        };

        scheduleNext();
    }

    async sendDailyReport() {
        try {
            const deliveredCount = global.deliveryStats ? global.deliveryStats.count : 0;
            const deliveredValue = global.deliveryStats ? global.deliveryStats.totalValue : 0;

            const uptimeMs = Date.now() - global.startTime;
            const uptimeHours = Math.floor(uptimeMs / 1000 / 60 / 60);
            const uptimeMinutes = Math.floor(uptimeMs / 1000 / 60) % 60;

            const date = new Date();
            const dateStr = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;

            let msg = `📊 <b>Ежедневный отчёт</b> за ${dateStr}\n\n`;
            msg += `🔑 Аккаунт: <code>${global.appData.userName || '—'}</code>\n`;
            msg += `💰 Баланс: <code>${global.appData.balance || '—'}</code>\n`;
            msg += `🛍️ Всего продаж: <code>${global.appData.sales || '—'}</code>\n\n`;
            msg += `📦 <b>Автовыдача за сессию:</b>\n`;
            msg += `   ├ Выдано: <code>${deliveredCount} шт.</code>\n`;
            msg += `   └ На сумму: <code>${deliveredValue} ₽</code>\n\n`;
            msg += `⏱ Аптайм: <code>${uptimeHours}ч ${uptimeMinutes}м</code>\n\n`;
            msg += `<i>FunPayServer — автоматический отчёт</i>`;

            let chatId = this.getChatID();
            if (!chatId) return;
            this.bot.telegram.sendMessage(chatId, msg, {
                parse_mode: 'HTML',
                disable_web_page_preview: true
            });

            log(`📊 Ежедневный отчёт отправлен в Telegram.`, 'g');
        } catch (err) {
            log(`Ошибка при отправке ежедневного отчёта: ${err}`, 'r');
        }
    }
}

export default TelegramBot;