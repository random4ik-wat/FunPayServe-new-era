// MODULES
const fs = global.fs_extra;
const c = global.chalk;
const inq = global.inquirer;
const ConfigParser = global.config_parser;
const log = global.log;
const { exit } = global.helpers;

// CONSTANTS
const _dirname = process.cwd();

// Мьютекс для атомарной записи файлов (защита от гонки процессов)
const fileLocks = new Map();

async function acquireFileLock(filePath) {
    while (fileLocks.has(filePath)) {
        await fileLocks.get(filePath);
    }
    let resolve;
    const promise = new Promise(r => resolve = r);
    fileLocks.set(filePath, promise);
    return resolve;
}

function releaseFileLock(filePath, resolve) {
    fileLocks.delete(filePath);
    resolve();
}

const dataFolder = 'data';
const logsFolder = 'logs';
const configFolder = 'configs';
const otherFolder = 'other';

const dataPath = `${_dirname}/${dataFolder}`;
const logsPath = `${dataPath}/${logsFolder}`;
const configPath = `${dataPath}/${configFolder}`;
const otherPath = `${dataPath}/${otherFolder}`;

const config = new ConfigParser();

// START
await initStorage();
global.settings = await loadSettings();

// FUNCTIONS
async function initStorage() {
    try {
        const configFiles = [
            "delivery.json",
            "autoResponse.json"
        ];

        const otherFiles = [
            "categories.json",
            "categoriesCache.json",
            "goodsState.json",
            "newChatUsers.json",
            "telegram.txt"
        ];

        if (!(await fs.exists(dataPath))) {
            await fs.mkdir(dataPath);
        }

        if (!(await fs.exists(logsPath))) {
            await fs.mkdir(logsPath);
        }

        if (!(await fs.exists(configPath))) {
            await fs.mkdir(configPath);
        }

        if (!(await fs.exists(otherPath))) {
            await fs.mkdir(otherPath);
        }

        for (let i = 0; i < configFiles.length; i++) {
            const file = configFiles[i];

            if (!(await fs.exists(`${configPath}/${file}`))) {
                await fs.writeFile(`${configPath}/${file}`, '[]');
            }
        }

        for (let i = 0; i < otherFiles.length; i++) {
            const file = otherFiles[i];

            if (!(await fs.exists(`${otherPath}/${file}`))) {
                await fs.writeFile(`${otherPath}/${file}`, '[]');
            }
        }
    } catch (err) {
        log(`Не удалось создать файлы хранилища: ${err}`);
    }
}

async function loadSettings() {
    try {
        let uri = `${_dirname}/settings.txt`;
        let settings = {};

        if (!(await fs.exists(uri))) {
            const answers = await askSettings();

            settings = {
                golden_key: answers.golden_key,
                userAgent: answers.userAgent,
                alwaysOnline: answers.alwaysOnline,
                lotsRaise: answers.lotsRaise,
                goodsStateCheck: answers.goodsStateCheck,
                autoIssue: answers.autoIssue,
                autoResponse: answers.autoResponse,
                greetingMessage: answers.greetingMessage,
                greetingMessageText: answers.greetingMessageText,
                autoIssueTestCommand: 0,
                telegramBot: answers.telegramBot,
                telegramToken: answers.telegramToken,
                userName: answers.userName,
                newMessageNotification: answers.newMessageNotification,
                newOrderNotification: answers.newOrderNotification,
                lotsRaiseNotification: answers.lotsRaiseNotification,
                deliveryNotification: answers.deliveryNotification,
                watermark: "[ 🔥NightBot ]",
                proxy: {
                    useProxy: 0,
                    host: "",
                    port: 3128,
                    login: "",
                    pass: "",
                    type: "http"
                }
            };

            await saveConfig(settings);
        } else {
            settings = await loadConfig();
        }

        if (!checkGoldenKey(settings.golden_key)) {
            log('Невалидный токен (golden_key).', 'r');
            await exit();
        }

        return settings;
    } catch (err) {
        log(`Ошибка при загрузке файла настроек: ${err}. Программа будет закрыта.`, 'r');
        await exit();
    }
}

function loadConfig() {
    config.read(`${_dirname}/settings.txt`);

    let settings = {
        golden_key: config.get('FunPay', 'golden_key') || process.env.FPS_GOLDEN_KEY || '',
        userAgent: config.get('FunPay', 'user_agent'),
        alwaysOnline: Number(config.get('FunPay', 'alwaysOnline')),
        lotsRaise: Number(config.get('FunPay', 'lotsRaise')),
        goodsStateCheck: Number(config.get('FunPay', 'goodsStateCheck')),
        autoIssue: Number(config.get('FunPay', 'autoDelivery')),
        autoResponse: Number(config.get('FunPay', 'autoResponse')),
        greetingMessage: Number(config.get('FunPay', 'greetingMessage')),
        greetingMessageText: replaceAll(config.get('FunPay', 'greetingMessageText'), '\\n', '\n'),
        autoIssueTestCommand: Number(config.get('FunPay', 'autoDeliveryTestCommand')),
        watermark: config.get('FunPay', 'waterMark'),
        watermarkInAutoResponse: Number(config.get('FunPay', 'watermarkInAutoResponse')),
        customGreetings: Number(config.get('FunPay', 'customGreetings') || 0),
        randomDelivery: Number(config.get('FunPay', 'randomDelivery') || 0),
        mockMode: Number(config.get('FunPay', 'mockMode') || 0),
        webhookUrl: config.get('FunPay', 'webhookUrl') || '',
        blacklist: (config.get('FunPay', 'blacklist') || '').split(',').map(s => s.trim()).filter(Boolean),
        telegramBot: Number(config.get('Telegram', 'enabled')),
        telegramToken: config.get('Telegram', 'token') || process.env.FPS_TG_TOKEN || '',
        userName: config.get('Telegram', 'userName'),
        userId: (config.get('Telegram', 'userId') || '0').split(',').map(s => Number(s.trim())).filter(n => n > 0),
        newMessageNotification: Number(config.get('Telegram', 'newMessageNotification')),
        newOrderNotification: Number(config.get('Telegram', 'newOrderNotification')),
        lotsRaiseNotification: Number(config.get('Telegram', 'lotsRaiseNotification')),
        deliveryNotification: Number(config.get('Telegram', 'deliveryNotification')),
        lowStockAlert: Number(config.get('Telegram', 'lowStockAlert')),
        thankYouMessage: Number(config.get('Telegram', 'thankYouMessage')),
        thankYouMessageText: replaceAll(config.get('Telegram', 'thankYouMessageText') || '', '\\n', '\n'),
        thankBuyerAfterDelivery: Number(config.get('FunPay', 'thankBuyerAfterDelivery') || 0),
        thankBuyerText: replaceAll(config.get('FunPay', 'thankBuyerText') || 'Спасибо за покупку!', '\\n', '\n'),
        dailyReport: Number(config.get('Telegram', 'dailyReport')),
        dailyReportHour: Number(config.get('Telegram', 'dailyReportHour')) || 20,
        ai: {
            enabled: Number(config.get('AI', 'enabled') || 0),
            apiKey: config.get('AI', 'apiKey') || process.env.FPS_AI_KEY || '',
            model: config.get('AI', 'model') || 'deepseek/deepseek-chat',
            chatAI: Number(config.get('AI', 'chatAI') || 0),
            systemAI: Number(config.get('AI', 'systemAI') || 0),
            maxTokens: Number(config.get('AI', 'maxTokens') || 150)
        },
        proxy: {
            useProxy: Number(config.get('Proxy', 'enabled')),
            host: config.get('Proxy', 'host'),
            port: config.get('Proxy', 'port'),
            login: config.get('Proxy', 'login'),
            pass: config.get('Proxy', 'pass'),
            type: config.get('Proxy', 'type')
        },
        apiEnabled: Number(config.get('API', 'apiEnabled') || 0),
        apiKey: config.get('API', 'apiKey') || process.env.FPS_API_KEY || ''
    };

    return settings;
}

async function saveConfig(settings) {
    let data = await fs.readFile(`${_dirname}/s.example`, 'utf-8');

    data = setValue(data, 'FunPay', 'golden_key', settings.golden_key);
    data = setValue(data, 'FunPay', 'user_agent', settings.userAgent);
    data = setValue(data, 'FunPay', 'alwaysOnline', settings.alwaysOnline);
    data = setValue(data, 'FunPay', 'lotsRaise', settings.lotsRaise);
    data = setValue(data, 'FunPay', 'goodsStateCheck', settings.goodsStateCheck);
    data = setValue(data, 'FunPay', 'autoDelivery', settings.autoIssue);
    data = setValue(data, 'FunPay', 'autoResponse', settings.autoResponse);
    data = setValue(data, 'FunPay', 'greetingMessage', settings.greetingMessage);
    data = setValue(data, 'FunPay', 'greetingMessageText', replaceAll(settings.greetingMessageText, '\n', '\\n'));
    data = setValue(data, 'FunPay', 'autoDeliveryTestCommand', settings.autoIssueTestCommand);
    data = setValue(data, 'FunPay', 'waterMark', settings.watermark);
    data = setValue(data, 'Telegram', 'enabled', settings.telegramBot);
    data = setValue(data, 'Telegram', 'token', settings.telegramToken);
    data = setValue(data, 'Telegram', 'userName', settings.userName);
    data = setValue(data, 'Telegram', 'newMessageNotification', settings.newMessageNotification);
    data = setValue(data, 'Telegram', 'newOrderNotification', settings.newOrderNotification);
    data = setValue(data, 'Telegram', 'lotsRaiseNotification', settings.lotsRaiseNotification);
    data = setValue(data, 'Telegram', 'deliveryNotification', settings.deliveryNotification);
    data = setValue(data, 'Proxy', 'enabled', settings.proxy.useProxy);
    data = setValue(data, 'Proxy', 'host', settings.proxy.host);
    data = setValue(data, 'Proxy', 'port', settings.proxy.port);
    data = setValue(data, 'Proxy', 'login', settings.proxy.login);
    data = setValue(data, 'Proxy', 'pass', settings.proxy.pass);
    data = setValue(data, 'Proxy', 'type', settings.proxy.type);

    await fs.writeFile(`./settings.txt`, data);
}

function setValue(file, section, name, value) {
    let sections = file.split(`[${section}]`);
    let currentSection = sections[1];
    let strings = currentSection.split('\n');

    for (let i = 0; i < strings.length; i++) {
        let str = strings[i];
        if (str.includes(name)) {
            strings[i] = `${name}: ${value}`;
            break;
        }
    }

    currentSection = strings.join('\n');
    sections[1] = currentSection;
    file = sections.join(`[${section}]`);

    return file;
}

async function load(uri) {
    let result = false;
    try {
        uri = `${_dirname}/${uri}`;

        if (!(await fs.exists(uri))) {
            await fs.writeFile(uri, '[]');
            return [];
        }

        const rawdata = await fs.readFile(uri, 'utf-8');

        // Пустой файл — возвращаем пустой массив
        if (!rawdata || rawdata.trim() === '') {
            return [];
        }

        try {
            result = JSON.parse(rawdata);
        } catch (jsonErr) {
            // Подробное сообщение об ошибке JSON с позицией
            const position = jsonErr.message.match(/position\s+(\d+)/i);
            const posInfo = position ? ` (позиция ${position[1]})` : '';
            log(`Ошибка формата JSON в файле "${uri}"${posInfo}: ${jsonErr.message}`, 'r');
            log(`Проверьте файл на сайте: http://json.parser.online.fr`, 'y');

            // Пытаемся использовать бэкап, если есть
            const backupUri = uri.replace('.json', '.backup.json');
            if (await fs.exists(backupUri)) {
                log(`Загружаю данные из бэкапа: ${backupUri}`, 'y');
                const backupData = await fs.readFile(backupUri, 'utf-8');
                result = JSON.parse(backupData);
            } else {
                result = [];
            }
        }
    } catch (err) {
        log(`Ошибка при загрузке файла "${uri}". Возможно файл имеет неверную кодировку (поддерживается UTF-8): ${err}`, 'r');
    }
    return result;
}

async function updateFile(content, filePath) {
    let result = false;
    const fullPath = `${_dirname}/${filePath}`;
    const resolve = await acquireFileLock(fullPath);

    try {
        // Бэкап delivery.json перед записью
        if (filePath.includes('delivery.json') && (await fs.exists(fullPath))) {
            const backupPath = fullPath.replace('.json', '.backup.json');
            await fs.copyFile(fullPath, backupPath);
        }

        await fs.writeFile(fullPath, JSON.stringify(content, null, 4));
        result = true;
    } catch (err) {
        log(`Ошибка записи файла: ${err}`, 'r');
        result = false;
    } finally {
        releaseFileLock(fullPath, resolve);
    }

    return result;
}

function checkGoldenKey(golden_key) {
    if (!golden_key || golden_key.length != 32) return false;
    return true;
}

function checkTelegramToken(token) {
    if (!token || token.length != 46) return false;
    return true;
}

function getConst(name) {
    switch (name) {
        case 'api': return 'https://funpay.com';
        case 'autoIssueFilePath': return `${dataPath}/configs/delivery.json`;
        case 'chatId':
            if (isNaN(global.settings.chatId)) {
                global.settings.chatId = fs.readFileSync(`${otherPath}/telegram.txt`, 'utf8');

                if (isNaN(global.settings.chatId)) return false;
                return global.settings.chatId;
            } else {
                return global.settings.chatId;
            }
    }
}

function setConst(name, value) {
    switch (name) {
        case 'chatId':
            global.settings.chatId = value;
            fs.writeFileSync(`${otherPath}/telegram.txt`, value.toString());
            log(`Чат для уведомлений Telegram успешно обновлен.`, `g`);
            break;
    }
}

async function loadAutoIssueFile() {
    return await fs.readFile(`${_dirname}/data/configs/delivery.json`, 'utf8');
}

function replaceAll(string, find, replace) {
    while (string.includes(find)) string = string.replace(find, replace);
    return string;
}

async function askSettings() {
    const question1 = await inq.prompt([{
        name: 'golden_key',
        type: 'input',
        message: `Введите golden_key. Его можно получить из cookie с сайта FunPay при помощи расширения EditThisCookie:`,
        validate: function (input) {
            const done = this.async();

            if (!checkGoldenKey(input)) {
                done('Невалидный токен (golden_key).');
                return;
            }

            done(null, true);
        }
    },
    {
        name: 'userAgent',
        type: 'input',
        message: `Введите User-Agent браузера, с которого выполнялся вход на сайт FunPay. Его можно получить тут: https://bit.ly/3l48x8b`
    }]);

    const question2 = await inq.prompt({
        name: 'autoSettings',
        type: 'list',
        message: `Запуск бота выполняется впервые. Вы хотите настроить функции бота или оставить все параметры по умолчанию? Эти параметры всегда можно поменять в файле ${c.yellowBright('settings.txt')}:`,
        choices: ['Оставить по умолчанию', 'Настроить']
    });

    let telegramToken = '';

    if (question2.autoSettings == 'Оставить по умолчанию') {
        console.log();
        return {
            golden_key: question1.golden_key,
            userAgent: question1.userAgent,
            telegramBot: 0,
            telegramToken: telegramToken,
            userName: 'MyTelegramLogin',
            alwaysOnline: 1,
            lotsRaise: 1,
            goodsStateCheck: 1,
            autoIssue: 1,
            autoResponse: 1,
            newMessageNotification: 1,
            newOrderNotification: 1,
            lotsRaiseNotification: 1,
            deliveryNotification: 1,
            greetingMessage: 1,
            greetingMessageText: 'Привет! Продавец скоро ответит на твоё сообщение.'
        }
    }

    const question3 = await inq.prompt({
        name: 'telegramBot',
        type: 'list',
        message: `Включить управление программой через телеграм бота (понадобится токен бота)?`,
        choices: ['Да', 'Нет']
    });

    let question5 = {};

    if (question3.telegramBot == 'Да') {
        const question4 = await inq.prompt({
            name: 'telegramToken',
            type: 'input',
            message: `Введите токен Telegram бота, который вы получили от BotFather:`,
            validate: function (input) {
                const done = this.async();

                if (!checkTelegramToken(input)) {
                    done('Невалидный токен.');
                    return;
                }

                done(null, true);
            }
        });

        telegramToken = question4.telegramToken;

        question5 = await inq.prompt([{
            name: 'userName',
            type: 'input',
            message: `Введите логин Telegram аккаунта, который будет использоваться для управления ботом (без @):`
        },
        {
            name: 'newMessageNotification',
            type: 'list',
            message: `Включить мгновенные уведомления о новых сообщениях?`,
            choices: ['Да', 'Нет']
        },
        {
            name: 'newOrderNotification',
            type: 'list',
            message: `Включить уведомления о новых заказах?`,
            choices: ['Да', 'Нет']
        },
        {
            name: 'lotsRaiseNotification',
            type: 'list',
            message: `Включить уведомления о поднятии лотов?`,
            choices: ['Да', 'Нет']
        }, {
            name: 'deliveryNotification',
            type: 'list',
            message: `Включить уведомления о выдаче товара?`,
            choices: ['Да', 'Нет']
        }]);
    }

    const answers = await inq.prompt([{
        name: 'alwaysOnline',
        type: 'list',
        message: `Включить функцию вечного онлайна?`,
        choices: ['Да', 'Нет']
    },
    {
        name: 'lotsRaise',
        type: 'list',
        message: `Включить функцию автоматического поднятия предложений?`,
        choices: ['Да', 'Нет']
    },
    {
        name: 'autoIssue',
        type: 'list',
        message: `Включить функцию автовыдачи товаров (не забудьте потом её настроить в файле delivery.json)?`,
        choices: ['Да', 'Нет']
    },
    {
        name: 'goodsStateCheck',
        type: 'list',
        message: `Включить функцию автоактивации товаров после продажи?`,
        choices: ['Да', 'Нет']
    },
    {
        name: 'autoResponse',
        type: 'list',
        message: `Включить функцию автоответа на команды (настройка в файле autoResponse.json)?`,
        choices: ['Да', 'Нет']
    },
    {
        name: 'greetingMessage',
        type: 'list',
        message: `Включить функцию автоответа на первое сообщение (настройка в файле settings.txt)?`,
        choices: ['Да', 'Нет']
    }]);

    const askSettings = {
        golden_key: question1.golden_key,
        userAgent: question1.userAgent,
        telegramBot: (question3.telegramBot == 'Да') ? 1 : 0,
        telegramToken: telegramToken,
        userName: (question3.telegramBot == 'Да' && question5.userName) ? question5.userName : 'MyTelegramLogin',
        alwaysOnline: (answers.alwaysOnline == 'Да') ? 1 : 0,
        lotsRaise: (answers.lotsRaise == 'Да') ? 1 : 0,
        goodsStateCheck: (answers.goodsStateCheck == 'Да') ? 1 : 0,
        autoIssue: (answers.autoIssue == 'Да') ? 1 : 0,
        autoResponse: (answers.autoResponse == 'Да') ? 1 : 0,
        newMessageNotification: (question5.newMessageNotification == 'Да') ? 1 : 0,
        newOrderNotification: (question5.newOrderNotification == 'Да') ? 1 : 0,
        lotsRaiseNotification: (question5.lotsRaiseNotification == 'Да') ? 1 : 0,
        deliveryNotification: (question5.deliveryNotification == 'Да') ? 1 : 0,
        greetingMessage: (answers.greetingMessage == 'Да') ? 1 : 0,
        greetingMessageText: 'Привет, {name}!\nПродавец скоро ответит на твоё сообщение.'
    }

    console.log();
    return askSettings;
}

export { updateFile, initStorage, load, loadSettings, loadConfig, getConst, setConst, loadAutoIssueFile };