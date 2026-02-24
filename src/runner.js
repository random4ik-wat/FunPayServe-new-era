// MODULES
const log = global.log;
const { getConst } = global.storage;
const { getRandomTag } = global.activity;
const fetch = global.fetch;
const parseDOM = global.DOMParser;

// CONSTANTS
const config = global.settings;

class Runner {
    constructor() {
        this.newOrderCallback = () => { };
        this.newMessageCallback = () => { };
        this.newIncomingMessageCallback = () => { };

        this.lastMessages = [];
        this.lastMessagesCount = 0;
        this.lastOrdersCount = 0;

        this.ordersTag = getRandomTag();
        this.messagesTag = getRandomTag();

        this.startup = true;
        this.consecutiveErrors = 0;
        this.loopInterval = 6000;

        // Глобальный счётчик ошибок за сессию
        if (!global.errorStats) global.errorStats = { count: 0 };
    }

    async start() {
        await this.loop();
        this.startup = false;
        this.scheduleNextLoop();
        //log('Обработка событий запущена.', 'g');
    }

    scheduleNextLoop() {
        setTimeout(async () => {
            try {
                await this.loop();
                // Успешный цикл — сброс счётчика ошибок
                if (this.consecutiveErrors > 0) {
                    log(`Соединение восстановлено после ${this.consecutiveErrors} ошибок.`, 'g');
                    this.consecutiveErrors = 0;
                    this.loopInterval = 6000;
                }
            } catch (err) {
                this.consecutiveErrors++;
                global.errorStats.count++;
                log(`Ошибка в цикле событий (${this.consecutiveErrors} подряд): ${err}`, 'r');

                if (this.consecutiveErrors >= 5 && this.loopInterval < 30000) {
                    this.loopInterval = 30000;
                    log(`⚠️ Слишком много ошибок, интервал увеличен до 30с.`, 'y');
                    if (global.telegramBot) {
                        global.telegramBot.sendErrorAlert(this.consecutiveErrors);
                    }
                }
            }
            this.scheduleNextLoop();
        }, this.loopInterval);
    }

    async loop() {
        try {
            const appData = global.appData;

            const url = `${getConst('api')}/runner/`;
            const headers = {
                "accept": "*/*",
                "cookie": `golden_key=${config.golden_key}; PHPSESSID=${appData.sessid}`,
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                "x-requested-with": "XMLHttpRequest"
            };

            const orders_counters = {
                "type": "orders_counters",
                "id": `${appData.id}`,
                "tag": `${this.ordersTag}`,
                "data": false
            };

            const chat_bookmarks = {
                "type": "chat_bookmarks",
                "id": `${appData.id}`,
                "tag": `${this.messagesTag}`,
                "data": false
            };

            const objects = [orders_counters, chat_bookmarks];
            const params = new URLSearchParams();
            params.append('objects', JSON.stringify(objects));
            params.append('request', false);
            params.append('csrf_token', appData.csrfToken);

            const options = {
                method: 'POST',
                body: params,
                headers: headers
            };

            const resp = await fetch(url, options);
            if (!resp || !resp.ok) {
                log('Ошибка при запросе в цикле событий.', 'c');
                return;
            }

            const json = await resp.json();
            const resObjects = json.objects;

            for (let i = 0; i < resObjects.length; i++) {
                if (resObjects[i].type == "orders_counters") {
                    this.ordersTag = resObjects[i].tag;
                    if (!this.startup)
                        this.newOrderCallback();
                }

                if (resObjects[i].type == "chat_bookmarks") {
                    this.messagesTag = resObjects[i].tag;
                    this.checkForNewMessages(resObjects[i].data);
                    if (!this.startup)
                        this.newMessageCallback();
                }
            }
        } catch (err) {
            log(`Ошибка при обработке событий: ${err}`, 'e');
        }
    }

    checkForNewMessages(object) {
        if (!object) return;

        const html = object.html;
        const doc = parseDOM(html);
        const chats = doc.querySelectorAll(".contact-item");

        let messages = [];

        for (let i = 0; i < chats.length; i++) {
            const chat = chats[i];

            let content = chat.querySelector('.contact-item-message')?.innerHTML;
            let unread = chat.getAttribute('class')?.includes('unread') || false;
            let user = chat.querySelector('.media-user-name')?.innerHTML;
            let time = chat.querySelector('.contact-item-time')?.innerHTML;
            let node = chat.getAttribute('data-id');

            if (!content || !user) continue;

            let message = {
                user: user,
                content: content,
                time: time,
                node: node,
                unread: unread
            };

            messages.push(message);
        }

        for (let i = 0; i < messages.length; i++) {
            if (messages[i] != this.lastMessages[i] && messages[i].unread) {
                this.lastMessages = messages.slice();

                if (!this.startup)
                    this.newIncomingMessageCallback(messages[i]);

                return;
            }
        }
    }

    registerNewOrderCallback(callback) {
        this.newOrderCallback = callback;
    }

    registerNewMessageCallback(callback) {
        this.newMessageCallback = callback;
    }

    registerNewIncomingMessageCallback(callback) {
        this.newIncomingMessageCallback = callback;
    }
}

export default Runner;