// MODULES
const fetch = global.node_fetch;
const proxy = global.https_proxy_agent;
const { exit, sleep } = global.helpers;
const log = global.log;

// CONSTANTS
const settings = global.settings;
let retriesErrCounter = 0;
const FETCH_TIMEOUT_MS = 15000;
const MIN_FETCH_INTERVAL = 1000; // Минимум 1с между запросами (rate limiter)
let lastFetchTime = 0;

// Кеш GET-запросов (TTL 30 сек)
const requestCache = new Map();
const CACHE_TTL = 30000;

// PROXY
if (settings.proxy.useProxy == true) {
    if (!settings.proxy.type || !settings.proxy.host) {
        log(`Неверные данные прокси!`, 'r');
        await exit();
    }

    log(`Для обработки запросов используется ${settings.proxy.type} прокси: ${settings.proxy.host}`, 'g');
}

// FETCH FUNCTION
export default async function fetch_(url, options, delay = 0, retries = 20) {
    // Mock режим — не делаем реальных запросов
    if (settings.mockMode) {
        log(`🧪 [MOCK] ${options?.method || 'GET'} ${url}`, 'y');
        return { text: async () => '<html><body data-app-data=\'{"userId":0,"csrf-token":"mock"}\'><span class="user-link-name">MockUser</span></body></html>', ok: true, status: 200, headers: { get: () => 'PHPSESSID=mock' } };
    }

    // Кеш GET-запросов
    const method = options?.method?.toUpperCase() || 'GET';
    if (method === 'GET') {
        const cached = requestCache.get(url);
        if (cached && (Date.now() - cached.time) < CACHE_TTL) {
            return { text: async () => cached.body, ok: true, status: 200, headers: cached.headers };
        }
    }

    try {
        let tries = 1;
        if (retriesErrCounter > 5) {
            log(`Превышен максимальный лимит безуспешных попыток запросов!`, 'r');
            await exit();
        }

        // Adding user-agent
        if (!options) options = {};
        if (!options.headers) options.headers = {};
        if (!options.headers['User-Agent']) options.headers['User-Agent'] = settings.userAgent;

        // Adding proxy
        if (settings.proxy.useProxy == true) {
            let proxyString = '';

            if (settings.proxy.login || settings.proxy.pass) {
                proxyString = `${settings.proxy.type}://${settings.proxy.login}:${settings.proxy.pass}@${settings.proxy.host}:${settings.proxy.port}`;
            } else {
                proxyString = `${settings.proxy.type}://${settings.proxy.host}:${settings.proxy.port}`;
            }

            const agent = new proxy(proxyString);
            options.agent = agent;
        }

        // Adding delay
        await sleep(delay);

        // Rate limiter — минимум 1с между запросами
        const elapsed = Date.now() - lastFetchTime;
        if (elapsed < MIN_FETCH_INTERVAL) {
            await sleep(MIN_FETCH_INTERVAL - elapsed);
        }
        lastFetchTime = Date.now();

        // Making request with timeout
        let res = await fetchWithTimeout(url, options);

        // Retrying with exponential backoff
        while (!res || !res.ok) {
            if (tries > retries) {
                retriesErrCounter++;
                log(`Превышено количество попыток запроса.`);
                log(`Request:`);
                log(options);
                log(`Response:`);
                log(res);
                break;
            };
            // Exponential backoff: 2с → 4с → 8с → 16с → 30с (max)
            const backoffMs = Math.min(2000 * Math.pow(2, tries - 1), 30000);
            log(`Попытка ${tries}/${retries}, повтор через ${backoffMs / 1000}с...`, 'y');
            await sleep(backoffMs);
            res = await fetchWithTimeout(url, options);
            tries++;
        }

        retriesErrCounter = 0;

        // Кешируем GET-ответы
        if (method === 'GET' && res && res.ok) {
            const origText = res.text.bind(res);
            let cachedBody = null;
            res.text = async () => {
                if (cachedBody !== null) return cachedBody;
                cachedBody = await origText();
                requestCache.set(url, { body: cachedBody, time: Date.now(), headers: res.headers });
                // Очистка старого кеша
                if (requestCache.size > 100) {
                    const now = Date.now();
                    for (const [k, v] of requestCache) { if (now - v.time > CACHE_TTL) requestCache.delete(k); }
                }
                return cachedBody;
            };
        }

        return res;
    } catch (err) {
        // Таймауты не считаются критическими ошибками
        if (err?.name !== 'AbortError') {
            log(`Ошибка при запросе (нет доступа к интернету / funpay): ${err}`);
        }
    }
}

// Fetch с таймаутом через AbortController
async function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        return response;
    } catch (err) {
        if (err.name === 'AbortError') {
            log(`Таймаут запроса (${FETCH_TIMEOUT_MS / 1000}с): ${url}`, 'y');
            return null;
        }
        throw err;
    } finally {
        clearTimeout(timeoutId);
    }
}