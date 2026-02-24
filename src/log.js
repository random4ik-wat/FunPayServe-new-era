// MODULES
const c = global.chalk;
const fs = global.fs_extra;

// CONSTANTS
const logo = `
█▀▀ █░░█ █▄░█ █▀▄ ▄▀▄ █░█ . ▄▀▀ █▀▀ █▀▄ █░░░█ █▀▀ █▀▄
█▀▀ █░░█ █▀██ █▀░ █▄█ ▀█▀ . ░▀▄ █▀▀ █▀▄ ░█░█░ █▀▀ █▀▄
▀░░ ░▀▀░ ▀░░▀ ▀░░ ▀░▀ ░▀░ . ▀▀░ ▀▀▀ ▀░▀ ░░▀░░ ▀▀▀ ▀░▀
`;

const version = `v${(JSON.parse((await fs.readFile('./package.json')))).version}`;
const by = 'By NightStranger\nEdit by Game0_0 & random4ik\n';
const enableFileLog = true;

// START
if (enableFileLog) logToFile('---------------New Load--------------');
setTerminalTitle('FunPayServer by NightStranger');
printLogo();

// FUNCTIONS
function setTerminalTitle(title) {
    process.stdout.write(
        String.fromCharCode(27) + "]0;" + title + String.fromCharCode(7)
    );
}

function printLogo() {
    console.log(`\x1b[5m${logo}\x1b[0m`);
    console.log(c.cyan(version));
    console.log(c.magenta(by));
    console.log(c.greenBright(` *Creator telegram: https://t.me/fplite\n  └─*Editor telegram: https://t.me/XXX\n`));
    console.log(c.greenBright(` *Creator Discord: https://discord.gg/Y9tZYkgk3p\n  └─*Editor Discord: https://discord.gg/XXX\n`));
    console.log(c.greenBright(` *Creator Github: https://github.com/NightStrang6r/FunPayServer\n  ├─*Editor Github: https://github.com/random4ik-wat/FunPayServe-new-era\n  └─*Editor GitLab: https://gitlab.com/random4ik-wat/FunPayServe-new-era\n`));
}

function log(msg, color = 'w') {
    const date = getDate();
    const dateString = `[${date.day}.${date.month}.${date.year}]`;
    const timeString = `[${date.hour}:${date.minute}:${date.second}]`;

    // Маскируем секреты перед выводом
    if (typeof msg === 'string') {
        msg = maskSecrets(msg);
    }

    const logText = `>${dateString} ${timeString}: ${msg}`;
    let coloredMsg = msg;

    switch (color) {
        case 'c': coloredMsg = c.cyan(msg); break;
        case 'g': coloredMsg = c.green(msg); break;
        case 'm': coloredMsg = c.magenta(msg); break;
        case 'y': coloredMsg = c.yellow(msg); break;
        case 'r': coloredMsg = c.red(msg); break;
        default: coloredMsg = msg; break;
    }

    const logMsg = `${c.yellow('>')} ${c.cyan(dateString)} ${c.cyan(timeString)}: ${coloredMsg}`;

    if (typeof msg != 'object') {
        console.log(logMsg);

        if (enableFileLog)
            logToFile(logText);
    } else {
        const maskedObj = maskSecrets(JSON.stringify(msg, null, 4));
        console.log(maskedObj);

        if (enableFileLog)
            logToFile(maskedObj);
    }
}

function maskSecrets(text) {
    if (typeof text !== 'string') return text;
    // Маскируем golden_key
    return text.replace(/golden_key[=:][\s]?[\w-]+/gi, 'golden_key=***HIDDEN***');
}

function getDate() {
    const date = new Date();

    let day = date.getDate();
    let month = date.getMonth() + 1;
    let year = date.getFullYear();
    let hour = date.getHours();
    let minute = date.getMinutes();
    let second = date.getSeconds();

    if (day.toString().length == 1)
        day = `0${day}`;
    if (month.toString().length == 1)
        month = `0${month}`;
    if (hour.toString().length == 1)
        hour = `0${hour}`;
    if (minute.toString().length == 1)
        minute = `0${minute}`;
    if (second.toString().length == 1)
        second = `0${second}`;

    return {
        day: day,
        month: month,
        year: year,
        hour: hour,
        minute: minute,
        second: second
    }
}

async function logToFile(msg) {
    try {
        const _dirname = process.cwd();
        const dataFolder = 'data';
        const dataPath = `${_dirname}/${dataFolder}`;
        const logPath = `${dataPath}/logs/`;

        if (!(await fs.exists(dataPath))) {
            await fs.mkdir(dataPath);
        }

        if (!(await fs.exists(logPath))) {
            await fs.mkdir(logPath);
        }

        const time = getDate();
        const logFile = `${logPath}log-${time.day}-${time.month}-${time.year}.txt`;
        if (!(await fs.exists(logFile))) {
            await fs.writeFile(logFile, '');
        }

        await fs.appendFile(logFile, `${msg}\n`);
    } catch (err) {
        console.log(`Ошибка записи файла: ${err}`);
    }
}

// Ротация логов: архивация >30 дней, удаление >60 дней
async function rotateLogs() {
    try {
        const logPath = `${process.cwd()}/data/logs/`;
        if (!(await fs.exists(logPath))) return;

        const files = await fs.readdir(logPath);
        const now = Date.now();
        const DAY_MS = 86400000;

        for (const file of files) {
            const filePath = `${logPath}${file}`;
            const stat = await fs.stat(filePath);
            const ageDays = (now - stat.mtimeMs) / DAY_MS;

            if (file.endsWith('.old') && ageDays > 60) {
                await fs.remove(filePath);
                console.log(`🗑️ Удалён старый лог: ${file}`);
            } else if (file.endsWith('.txt') && ageDays > 30) {
                await fs.rename(filePath, `${filePath}.old`);
                console.log(`📦 Архивирован лог: ${file}`);
            }
        }
    } catch (err) {
        console.log(`Ошибка ротации логов: ${err}`);
    }
}

// Путь к последнему лог-файлу
function getLatestLogPath() {
    const time = getDate();
    return `${process.cwd()}/data/logs/log-${time.day}-${time.month}-${time.year}.txt`;
}

// Ротация при старте
rotateLogs();

export default log;
export { rotateLogs, getLatestLogPath };