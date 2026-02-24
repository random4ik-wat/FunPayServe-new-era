// MODULES
const fetch = global.fetch;
const c = global.chalk;
const log = global.log;
const parseDOM = global.DOMParser;
const { load, getConst, updateFile } = global.storage;
const { getRandomTag } = global.activity;

// CONSTANTS
const settings = global.settings;
const autoRespData = await load('data/configs/autoResponse.json');

let isAutoRespBusy = false;

// Cooldown: не отвечать одному юзеру чаще 1 раза в 60 сек
const autoRespCooldown = new Map();
const COOLDOWN_MS = 60000;

// Ограничение сообщений (антифлуд)
const userMsgHistory = new Map();

// Ключевые слова для детекции споров
const DISPUTE_KEYWORDS = ['открыт спор', 'dispute', 'арбитраж', 'претензия', 'спор открыт'];

// Расстояние Левенштейна для fuzzy search
function levenshtein(a, b) {
    const dp = Array.from({ length: a.length + 1 }, (_, i) =>
        Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,
                dp[i][j - 1] + 1,
                dp[i - 1][j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0)
            );
        }
    }
    return dp[a.length][b.length];
}

function enableAutoResponse() {
    log(`Автоответ запущен.`, 'g');
}

async function processMessages() {
    if (isAutoRespBusy) return;
    isAutoRespBusy = true;
    let result = false;

    try {
        const chats = await getChatBookmarks();
        for (let j = 0; j < chats.length; j++) {
            const chat = chats[j];

            // Чёрный список — пропускаем
            if (settings.blacklist?.length && settings.blacklist.includes(chat.userName)) {
                continue;
            }

            // Cooldown — не отвечать слишком часто
            const lastReply = autoRespCooldown.get(chat.userName);
            if (lastReply && (Date.now() - lastReply) < COOLDOWN_MS) {
                continue;
            }

            // Command logic here

            // Commands in file
            let matched = false;
            for (let i = 0; i < autoRespData.length; i++) {
                const useWatermark = settings.watermarkInAutoResponse;

                // Точное совпадение команды
                if (autoRespData[i].command && chat.message.trim().toLowerCase() == autoRespData[i].command.toLowerCase()) {
                    log(`Команда: ${c.yellowBright(autoRespData[i].command)} для пользователя ${c.yellowBright(chat.userName)}.`);
                    let smRes = await sendMessage(chat.node, autoRespData[i].response, false, useWatermark);
                    if (smRes)
                        log(`Ответ на команду отправлен.`, `g`);
                    matched = true;
                    autoRespCooldown.set(chat.userName, Date.now());
                    break;
                }

                // Поиск по ключевому слову (частичное совпадение)
                if (autoRespData[i].word && chat.message.trim().toLowerCase().includes(autoRespData[i].word.toLowerCase())) {
                    log(`Ключевое слово: ${c.yellowBright(autoRespData[i].word)} для пользователя ${c.yellowBright(chat.userName)}.`);
                    let smRes = await sendMessage(chat.node, autoRespData[i].response, false, useWatermark);
                    if (smRes)
                        log(`Ответ на ключевое слово отправлен.`, `g`);
                    matched = true;
                    autoRespCooldown.set(chat.userName, Date.now());
                    break;
                }

                // Fuzzy search — нечёткое совпадение (расстояние ≤ 2)
                if (!matched && autoRespData[i].command) {
                    const dist = levenshtein(chat.message.trim().toLowerCase(), autoRespData[i].command.toLowerCase());
                    if (dist > 0 && dist <= 2) {
                        log(`Fuzzy: ${c.yellowBright(chat.message.trim())} ≈ ${c.yellowBright(autoRespData[i].command)} (d=${dist}) для ${c.yellowBright(chat.userName)}.`);
                        let smRes = await sendMessage(chat.node, autoRespData[i].response, false, useWatermark);
                        if (smRes)
                            log(`Ответ на fuzzy-совпадение отправлен.`, `g`);
                        matched = true;
                        autoRespCooldown.set(chat.userName, Date.now());
                        break;
                    }
                }
            }

            // AI Fallback — если автоответ не сработал
            if (!matched && settings.ai?.enabled && settings.ai?.chatAI && global.ai) {
                try {
                    const aiReply = await global.ai.chatReply(chat.userName, chat.message);
                    if (aiReply) {
                        let smRes = await sendMessage(chat.node, aiReply, false, false);
                        if (smRes) {
                            log(`🤖 AI ответ отправлен пользователю ${c.yellowBright(chat.userName)}.`, 'c');
                            if (global.telegramBot) {
                                global.telegramBot.sendAIChatNotification(chat.userName, chat.message, aiReply);
                            }
                        }
                    }
                } catch (aiErr) {
                    log(`Ошибка AI автоответа: ${aiErr}`, 'r');
                }
            }

            // Custom commands

            if (settings.autoIssueTestCommand == true && chat.message.includes("!автовыдача")) {
                const goodName = chat.message.split(`&quot;`)[1];

                if (!goodName) {
                    log(`Команда: ${c.yellowBright('!автовыдача')} для пользователя ${c.yellowBright(chat.userName)}: товар не указан.`, `c`);
                    let smRes = await sendMessage(chat.node, `Товар не указан. Укажите название предложения в кавычках (").`);
                    if (smRes)
                        log(`Ответ на команду отправлен.`, `g`);
                    break;
                }

                log(`Команда: ${c.yellowBright('!автовыдача')} для пользователя ${c.yellowBright(chat.userName)}:`);
                const { issueGood } = global.sales;
                let issueResult = await issueGood(chat.node, chat.userName, goodName, 'node');

                if (!issueResult) {
                    let smRes = await sendMessage(chat.node, `Товара "${goodName}" нет в списке автовыдачи`);
                    if (smRes)
                        log(`Ответ на команду отправлен.`, `g`);
                    break;
                }

                if (issueResult == 'notInStock') {
                    let smRes = await sendMessage(chat.node, `Товар закончился`);
                    if (smRes)
                        log(`Ответ на команду отправлен.`, `g`);
                    break;
                }
            }
        }
    } catch (err) {
        log(`Ошибка при автоответе: ${err}`, 'r');
        isAutoRespBusy = false;
    }

    isAutoRespBusy = false;
    return result;
}

async function processIncomingMessages(message) {
    // Антифлуд: >5 сообщений за 30 секунд -> игнорируем
    const now = Date.now();
    let history = userMsgHistory.get(message.user) || [];
    history = history.filter(t => now - t < 30000);
    history.push(now);
    userMsgHistory.set(message.user, history);

    if (history.length > 5) {
        if (history.length === 6) { // Логируем только при первом превышении лимита
            log(`Антифлуд: игнорирование сообщений от ${c.yellowBright(message.user)} (>5 сообщений за 30с)`, 'y');
        }
        return;
    }

    // Notification
    if (global.telegramBot && settings.newMessageNotification) {
        if (settings.watermark) {
            if (!message.content.includes(settings.watermark)) {
                global.telegramBot.sendNewMessageNotification(message);
            }
        } else {
            global.telegramBot.sendNewMessageNotification(message);
        }
    }

    // Детекция споров
    const contentLower = (message.content || '').toLowerCase();
    const isDispute = DISPUTE_KEYWORDS.some(kw => contentLower.includes(kw));
    if (isDispute && global.telegramBot) {
        log(`⚠️ СПОР обнаружен от ${message.user}: ${message.content}`, 'r');
        global.telegramBot.sendDisputeAlert(message.user, message.content);
    }

    // If new chat
    if (settings.greetingMessage && settings.greetingMessageText) {
        const newChatUsers = await load('data/other/newChatUsers.json');

        // Проверяем, есть ли юзер в истории (поддерживаем старый формат строк и новый формат объектов)
        const isUserKnown = newChatUsers.some(entry =>
            (typeof entry === 'string' && entry === message.user) ||
            (typeof entry === 'object' && entry.id === message.user)
        );

        if (!isUserKnown) {
            newChatUsers.push({ id: message.user, timestamp: Date.now() });

            let msg = settings.greetingMessageText;

            // Кастомные приветствия под товар
            if (settings.customGreetings) {
                try {
                    const greetings = await load('data/configs/greetings.json');
                    if (greetings && greetings.length) {
                        const lotMatch = greetings.find(g => g.lotName !== 'default' && message.content?.includes(g.lotName));
                        const defaultMatch = greetings.find(g => g.lotName === 'default');
                        if (lotMatch) {
                            msg = lotMatch.message;
                        } else if (defaultMatch) {
                            msg = defaultMatch.message;
                        }
                    }
                } catch (_) { }
            }

            msg = msg.replace('{name}', message.user);

            await updateFile(newChatUsers, 'data/other/newChatUsers.json');

            if (!isSystemMessage(message.content)) {
                let smRes = await sendMessage(message.node, msg);
                if (smRes)
                    log(`Приветственное сообщение отправлено пользователю ${c.yellowBright(message.user)}.`, `g`);
            }
        }
    }
}

async function getMessages(senderId) {
    let result = false;
    try {
        const url = `${getConst('api')}/chat/history?node=users-${global.appData.id}-${senderId}&last_message=1000000000`;
        const headers = {
            "cookie": `golden_key=${settings.golden_key}`,
            "x-requested-with": "XMLHttpRequest"
        };

        const options = {
            method: 'GET',
            headers: headers
        }

        const resp = await fetch(url, options);
        result = await resp.json();
    } catch (err) {
        log(`Ошибка при получении сообщений: ${err}`, 'r');
    }
    return result;
}

async function getLastMessageId(senderId) {
    let lastMessageId = -1;
    try {
        let chat = await getMessages(senderId);
        if (!chat) return lastMessageId;
        chat = chat['chat'];
        if (!chat) return lastMessageId;

        const messages = chat.messages;
        lastMessageId = messages[messages.length - 1].id;
    } catch (err) {
        log(`Ошибка при получении id сообщения: ${err}`, 'r');
    }

    return lastMessageId;
}

async function sendMessage(node, message, customNode = false, useWatermark = true) {
    if (!message || message == undefined || !node || node == undefined) return;

    let result = false;

    try {
        if (global.settings.typingDelay) {
            // Эмуляция набора текста (случайная задержка 1.5 - 3 сек)
            const delay = Math.floor(Math.random() * (3000 - 1500 + 1)) + 1500;
            await new Promise(resolve => setTimeout(resolve, delay));
        }

        let newNode = node;
        const url = `${getConst('api')}/runner/`;
        const headers = {
            "accept": "*/*",
            "cookie": `golden_key=${settings.golden_key}; PHPSESSID=${global.appData.sessid}`,
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            "x-requested-with": "XMLHttpRequest"
        };

        if (customNode) {
            if (newNode > global.appData.id) {
                newNode = `users-${global.appData.id}-${node}`;
            } else {
                newNode = `users-${node}-${global.appData.id}`;
            }
        }

        let reqMessage = message;
        if (useWatermark && settings.watermark && settings.watermark != '') {
            reqMessage = `${settings.watermark}\n${message}`;
        }

        const request = {
            "action": "chat_message",
            "data": {
                "node": newNode,
                "last_message": -1,
                "content": reqMessage
            }
        };

        const params = new URLSearchParams();
        params.append('objects', '');
        params.append('request', JSON.stringify(request));
        params.append('csrf_token', global.appData.csrfToken);

        const options = {
            method: 'POST',
            body: params,
            headers: headers
        };

        const resp = await fetch(url, options);
        const json = await resp.json();

        if (json.response && json.response.error == null) {
            log(`Сообщение отправлено, чат node ${c.yellowBright(newNode)}.`, 'g');
            result = json;
        } else {
            log(`Не удалось отправить сообщение, node: "${newNode}", сообщение: "${reqMessage}"`, 'r');
            log(`Запрос:`);
            log(options);
            log(`Ответ:`);
            log(json);
            result = false;
        }
    } catch (err) {
        log(`Ошибка при отправке сообщения: ${err}`, 'r');
    }
    return result;
}

async function getNodeByUserName(userName) {
    let node = null;

    try {
        const bookmarks = await getChatBookmarks();
        if (!bookmarks) return null;

        for (let i = 0; i < bookmarks.length; i++) {
            const chat = bookmarks[i];

            if (chat.userName == userName) {
                node = chat.node;
                break;
            }
        }
    } catch (err) {
        log(`Ошибка при получении node: ${err}`, 'e');
    }

    return node;
}

async function getChatBookmarks() {
    let result = [];
    try {
        const url = `${getConst('api')}/runner/`;
        const headers = {
            "accept": "*/*",
            "cookie": `golden_key=${settings.golden_key}; PHPSESSID=${global.appData.sessid}`,
            "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
            "x-requested-with": "XMLHttpRequest"
        };

        const chat_bookmarks = {
            "type": "chat_bookmarks",
            "id": `${global.appData.id}`,
            "tag": `${getRandomTag()}`,
            "data": false
        };

        const objects = [chat_bookmarks];
        const params = new URLSearchParams();
        params.append('objects', JSON.stringify(objects));
        params.append('request', false);
        params.append('csrf_token', global.appData.csrfToken);

        const options = {
            method: 'POST',
            body: params,
            headers: headers
        };

        const resp = await fetch(url, options);
        const json = await resp.json();

        const html = json.objects[0].data.html;

        const doc = parseDOM(html);
        const chats = doc.querySelectorAll(".contact-item");

        for (let i = 0; i < chats.length; i++) {
            const chat = chats[i];

            let userName = chat.querySelector('.media-user-name')?.innerHTML;
            let message = chat.querySelector('.contact-item-message')?.innerHTML;
            let time = chat.querySelector('.contact-item-time')?.innerHTML;
            let node = chat.getAttribute('data-id');
            let isUnread = chat.getAttribute('class')?.includes('unread') || false;

            if (!userName || !message) continue;

            result.push({
                userName: userName,
                message: message,
                time: time,
                node: node,
                isUnread: isUnread
            });
        }

        return result;
    } catch (err) {
        log(`Ошибка при получении списка сообщений: ${err}`, 'e');
    }
}

async function addUsersToFile() {
    try {
        const bookmarks = await getChatBookmarks();
        if (!bookmarks) return;

        let users = await load('data/other/newChatUsers.json');
        for (let i = 0; i < bookmarks.length; i++) {
            const chat = bookmarks[i];

            const isKnown = users.some(entry =>
                (typeof entry === 'string' && entry === chat.userName) ||
                (typeof entry === 'object' && entry.id === chat.userName)
            );

            if (!isKnown) {
                users.push({ id: chat.userName, timestamp: Date.now() });
            }
        }

        await updateFile(users, 'data/other/newChatUsers.json');
    } catch (err) {
        log(`Ошибка при получении списка пользователей: ${err}`, 'e');
    }
}

function isSystemMessage(message) {
    if (!message) return false;

    if (message.includes('Покупатель') || message.includes('The buyer')) {
        return true;
    }

    return false;
}

export {
    getMessages,
    sendMessage,
    getChatBookmarks,
    processMessages,
    processIncomingMessages,
    addUsersToFile,
    enableAutoResponse,
    getLastMessageId,
    getNodeByUserName
};