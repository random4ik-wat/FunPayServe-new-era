// MODULES
const fetch = global.fetch;
const log = global.log;
const { exit } = global.helpers;
const parseDOM = global.DOMParser;
const { getConst } = global.storage;

// CONSTANTS
const config = global.settings;
const headers = { "cookie": `golden_key=${config.golden_key};` };

if (!global.appData || !global.appData.id) {
    global.appData = await getUserData();
    if (!global.appData) await exit();
}

async function countTradeProfit() {
    let result = 0;
    let ordersCount = 0;
    try {
        let first = true;
        let continueId;
        while (1) {
            let method, data;
            if (!first) {
                method = 'POST';
                data = `${encodeURI('continue')}=${encodeURI(continueId)}`;
                headers["content-type"] = 'application/x-www-form-urlencoded';
                headers["x-requested-with"] = 'XMLHttpRequest';
            } else {
                first = false;
                method = 'GET';
            }

            const options = {
                method: method,
                body: data,
                headers: headers
            };

            const resp = await fetch(`${getConst('api')}/orders/trade`, options);
            const body = await resp.text();

            const doc = parseDOM(body);
            const items = doc.querySelectorAll(".tc-item");
            const order = items[0].querySelector(".tc-order").innerHTML;

            items.forEach(item => {
                const status = item.querySelector(".tc-status").innerHTML;
                if (status == `Закрыт`) {
                    let price = item.querySelector(".tc-price").childNodes[0].data;
                    price = Number(price);
                    if (isNaN(price)) return;
                    result += price;
                    ordersCount++;
                }
            });
            log(`Продажи: ${ordersCount}. Заработок: ${result.toFixed(2)} ₽. Средний чек: ${(result / ordersCount).toFixed(2)} ₽.`);

            const continueEl = doc.querySelector(".dyn-table-form");
            if (continueEl == null) {
                break;
            }

            continueId = continueEl.querySelector('input').getAttribute('value');
        }
    } catch (err) {
        log(`Ошибка при подсчёте профита: ${err}`, 'r');
    }
    return result;
}

function enableUserDataUpdate(timeout) {
    setTimeout(async function updateLoop() {
        await getUserData();
        setTimeout(updateLoop, timeout);
    }, timeout);
    //log(`Автоматический апдейт данных запущен.`);
}

async function getUserData() {
    let result = false;
    try {
        const options = {
            method: 'GET',
            headers: headers
        };

        const resp = await fetch(getConst('api'), options);
        const body = await resp.text();

        const doc = parseDOM(body);
        const bodyEl = doc.querySelector("body");
        const appDataAttr = bodyEl?.getAttribute('data-app-data');

        if (!appDataAttr) {
            log(`Не удалось получить данные приложения (data-app-data). Возможно, golden_key невалидный или аккаунт заблокирован.`, 'r');
            // Детект бана: если нет data-app-data, возможно аккаунт заблокирован
            if (global.telegramBot && body.includes('Пользователь заблокирован') || body.includes('account is blocked') || body.includes('Доступ ограничен')) {
                global.telegramBot.sendDisputeAlert({ user: 'СИСТЕМА', content: '🚨🚨🚨 АККАУНТ ЗАБЛОКИРОВАН! Немедленно проверьте FunPay!' });
                log('🚨 АККАУНТ ЗАБЛОКИРОВАН!', 'r');
            }
            return false;
        }

        const appData = JSON.parse(appDataAttr);

        const userNameEl = doc.querySelector(".user-link-name");
        if (!userNameEl) {
            log(`Неверный golden_key.`, 'r');
            return false;
        }

        const userName = userNameEl.innerHTML;
        const balanceEl = doc.querySelector(".badge-balance");
        const salesEl = doc.querySelector(".badge-trade");
        const timestamp = Date.now();

        let balance = 0;
        let sales = 0;

        if (balanceEl && balanceEl != null) balance = balanceEl.innerHTML;
        if (salesEl && salesEl != null) sales = salesEl.innerHTML;

        let setCookie = "";
        resp.headers.forEach((val, key) => {
            if (key == "set-cookie") {
                setCookie = val;
                return;
            }
        });

        const PHPSESSID = setCookie.split(';')[0].split('=')[1];

        if (appData.userId && appData.userId != 0) {
            result = {
                id: appData.userId,
                csrfToken: appData["csrf-token"],
                sessid: PHPSESSID,
                userName: userName,
                balance: balance,
                sales: sales,
                lastUpdate: timestamp
            };

            global.appData = result;

            // Уведомление о смене баланса
            if (global.appData._prevBalance !== undefined && global.appData._prevBalance !== balance) {
                if (global.telegramBot) {
                    global.telegramBot.sendBalanceChange(global.appData._prevBalance, balance);
                }
            }
            global.appData._prevBalance = balance;

            // История баланса для графика (макс 168 точек = 7 дней по часу)
            if (!global.balanceHistory) global.balanceHistory = [];
            global.balanceHistory.push({ t: timestamp, v: parseFloat(balance) || 0 });
            if (global.balanceHistory.length > 168) global.balanceHistory.shift();
        } else {
            log(`Необходимо авторизоваться.`);
        }
    } catch (err) {
        log(`Ошибка при получении данных аккаунта: ${err}`, 'r');
    }
    return result;
}

export { headers, getUserData, countTradeProfit, enableUserDataUpdate };