'use strict';

(() => {
  const status = document.querySelector('[data-miniapp-status]');
  const message = document.querySelector('[data-miniapp-message]');
  const profile = document.querySelector('[data-miniapp-profile]');
  const links = document.querySelector('[data-miniapp-links]');
  const tg = window.Telegram?.WebApp;

  function showError(text) {
    if (message) message.textContent = text;
    if (status) status.classList.add('miniapp-auth-error');
    tg?.HapticFeedback?.notificationOccurred?.('error');
  }

  async function connect() {
    if (!tg) {
      showError('Telegram WebApp API не обнаружен. Откройте эту страницу через кнопку в Telegram.');
      return;
    }

    tg.ready();
    tg.expand();
    tg.setHeaderColor?.('#171717');
    tg.setBackgroundColor?.('#171717');

    const initData = tg.initData;
    if (!initData) {
      showError('Telegram не передал initData. Закройте Mini App и запустите его из меню бота.');
      return;
    }

    try {
      const response = await fetch('/telegram-app/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({ initData })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || 'Не удалось авторизовать Telegram-аккаунт');

      const user = result.user;
      const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ') || (user.username ? '@' + user.username : 'Администратор');
      document.querySelector('[data-miniapp-name]').textContent = fullName;
      document.querySelector('[data-miniapp-id]').textContent = user.id;
      profile.hidden = false;
      links.hidden = false;
      status.hidden = true;
      tg.HapticFeedback?.notificationOccurred?.('success');
    } catch (error) {
      showError(error.message);
    }
  }

  connect();
})();
