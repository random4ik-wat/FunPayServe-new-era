// CLI Wizard — пошаговая настройка при первом запуске
import inquirer from 'inquirer';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const settingsPath = join(__dirname, '..', 'settings.txt');

async function isFirstRun() {
    try {
        const content = await fs.readFile(settingsPath, 'utf-8');
        // Если golden_key пустой или равен дефолту — первый запуск
        const match = content.match(/golden_key:\s*(.+)/);
        return !match || !match[1] || match[1].trim() === '' || match[1].trim() === 'YOUR_KEY';
    } catch {
        return true;
    }
}

async function runWizard() {
    console.log('\n🧙 \x1b[36m═══════════════════════════════════════\x1b[0m');
    console.log('🧙 \x1b[36m  FunPayServer — Мастер настройки      \x1b[0m');
    console.log('🧙 \x1b[36m═══════════════════════════════════════\x1b[0m\n');

    const answers = await inquirer.prompt([
        {
            type: 'input',
            name: 'golden_key',
            message: '🔑 Введите golden_key (из cookies FunPay):',
            validate: (v) => v.trim().length > 5 ? true : 'Ключ слишком короткий'
        },
        {
            type: 'confirm',
            name: 'telegramEnabled',
            message: '🤖 Включить Telegram бота?',
            default: true
        },
        {
            type: 'input',
            name: 'telegramToken',
            message: '📱 Введите токен Telegram бота (от @BotFather):',
            when: (a) => a.telegramEnabled,
            validate: (v) => v.includes(':') ? true : 'Неверный формат токена'
        },
        {
            type: 'input',
            name: 'userName',
            message: '👤 Ваш Telegram username (без @):',
            when: (a) => a.telegramEnabled
        },
        {
            type: 'confirm',
            name: 'autoResponse',
            message: '💬 Включить автоответ на сообщения?',
            default: true
        },
        {
            type: 'confirm',
            name: 'autoDelivery',
            message: '📦 Включить автовыдачу товаров?',
            default: true
        },
        {
            type: 'confirm',
            name: 'lotsRaise',
            message: '🚀 Включить автоподнятие лотов?',
            default: true
        }
    ]);

    // Записываем настройки в settings.txt
    try {
        let content = await fs.readFile(settingsPath, 'utf-8');

        content = content.replace(/(golden_key:\s*).*/, `$1${answers.golden_key}`);
        content = content.replace(/(autoResponse:\s*).*/, `$1${answers.autoResponse ? 1 : 0}`);
        content = content.replace(/(autoDelivery:\s*).*/, `$1${answers.autoDelivery ? 1 : 0}`);
        content = content.replace(/(lotsRaise:\s*).*/, `$1${answers.lotsRaise ? 1 : 0}`);

        if (answers.telegramEnabled) {
            content = content.replace(/(enabled:\s*).*(\n)/, `$1${1}$2`);
            if (answers.telegramToken)
                content = content.replace(/(token:\s*).*/, `$1${answers.telegramToken}`);
            if (answers.userName)
                content = content.replace(/(userName:\s*).*/, `$1${answers.userName}`);
        }

        await fs.writeFile(settingsPath, content);
        console.log('\n✅ \x1b[32mНастройки сохранены в settings.txt!\x1b[0m');
        console.log('🚀 \x1b[32mЗапустите бота: node src/index.js\x1b[0m\n');
    } catch (err) {
        console.error(`❌ Ошибка сохранения: ${err}`);
    }
}

export { isFirstRun, runWizard };
