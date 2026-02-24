// AI Module — OpenRouter API Integration
// Два режима: Chat AI (ответы покупателям) и System AI (диагностика ошибок)

const fetch = global.node_fetch;
const log = global.log;
const settings = global.settings;

// Счётчик запросов за сессию
let aiStats = { chatRequests: 0, systemRequests: 0, errors: 0 };
let lastRequestTime = 0;
const MIN_REQUEST_INTERVAL = 3000; // 3 секунды между запросами

const CHAT_SYSTEM_PROMPT = `Ты — вежливый продавец на маркетплейсе FunPay. Отвечай кратко (1-3 предложения), по-русски, дружелюбно.
Не выдумывай информацию о товарах. Если не знаешь ответа — предложи подождать ответа живого продавца.
Не используй markdown. Не упоминай что ты AI/бот/нейросеть.`;

const SYSTEM_DIAG_PROMPT = `Ты — опытный Node.js разработчик. Анализируй ошибки FunPayServer (бот для автоматизации FunPay).
Отвечай кратко (2-4 предложения): причина ошибки и рекомендация по исправлению. По-русски.
Типичные причины: сбой сети, истёкший golden_key, изменение вёрстки FunPay, битый JSON, race condition.`;

async function callOpenRouter(systemPrompt, userMessage, maxTokens = 150) {
    const ai = settings.ai;
    if (!ai || !ai.enabled || !ai.apiKey) return null;

    // Rate limiting
    const now = Date.now();
    const elapsed = now - lastRequestTime;
    if (elapsed < MIN_REQUEST_INTERVAL) {
        await new Promise(r => setTimeout(r, MIN_REQUEST_INTERVAL - elapsed));
    }
    lastRequestTime = Date.now();

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${ai.apiKey}`,
                'Content-Type': 'application/json',
                'HTTP-Referer': 'https://funpayserver.app',
                'X-Title': 'FunPayServer'
            },
            body: JSON.stringify({
                model: ai.model || 'deepseek/deepseek-chat',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage }
                ],
                max_tokens: maxTokens || 150,
                temperature: 0.7
            })
        });

        if (!response || !response.ok) {
            const errText = response ? await response.text() : 'no response';
            log(`AI API ошибка (${response?.status}): ${errText}`, 'r');
            aiStats.errors++;
            return null;
        }

        const data = await response.json();
        const reply = data?.choices?.[0]?.message?.content?.trim();
        return reply || null;
    } catch (err) {
        log(`AI запрос ошибка: ${err.message}`, 'r');
        aiStats.errors++;
        return null;
    }
}

/**
 * Chat AI — генерация ответа покупателю
 * @param {string} buyerName - имя покупателя
 * @param {string} message - сообщение покупателя
 * @returns {string|null} - ответ AI или null
 */
async function chatReply(buyerName, message) {
    if (!settings.ai?.chatAI) return null;

    const userMsg = `Покупатель "${buyerName}" написал: "${message}"`;
    const reply = await callOpenRouter(CHAT_SYSTEM_PROMPT, userMsg, settings.ai?.maxTokens || 150);

    if (reply) {
        aiStats.chatRequests++;
        log(`🤖 AI ответ для ${buyerName}: ${reply}`, 'c');
    }

    return reply;
}

/**
 * System AI — диагностика ошибки бота
 * @param {string} errorInfo - стек ошибки или описание проблемы
 * @param {string} context - дополнительный контекст (файл, функция)
 * @returns {string|null} - диагноз AI или null
 */
async function diagnoseError(errorInfo, context = '') {
    if (!settings.ai?.systemAI) return null;

    let userMsg = `Ошибка в FunPayServer:\n${errorInfo}`;
    if (context) userMsg += `\n\nКонтекст: ${context}`;

    const reply = await callOpenRouter(SYSTEM_DIAG_PROMPT, userMsg, 200);

    if (reply) {
        aiStats.systemRequests++;
        log(`🤖 AI диагноз: ${reply}`, 'c');
    }

    return reply;
}

/**
 * Получить статистику AI за сессию
 */
function getStats() {
    return { ...aiStats };
}

export { chatReply, diagnoseError, getStats };
