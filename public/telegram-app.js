'use strict';

(() => {
  const status = document.querySelector('[data-miniapp-status]');
  const message = document.querySelector('[data-miniapp-message]');
  const retry = document.querySelector('[data-miniapp-retry]');
  const profile = document.querySelector('[data-miniapp-profile]');
  const links = document.querySelector('[data-miniapp-links]');
  const tg = window.Telegram?.WebApp;
  let connecting = false;

  function showError(text, details = '') {
    if (message) message.textContent = text;
    const diagnostic = document.querySelector('[data-miniapp-diagnostic]');
    if (diagnostic) {
      diagnostic.textContent = details;
      diagnostic.hidden = !details;
    }
    if (status) status.classList.add('miniapp-auth-error');
    if (retry) retry.hidden = false;
    tg?.HapticFeedback?.notificationOccurred?.('error');
  }

  function wait(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  async function getInitData() {
    // Telegram иногда заполняет launch-параметры после первичной загрузки WebView.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const value = window.Telegram?.WebApp?.initData;
      if (typeof value === 'string' && value.length > 0) return value;
      await wait(100);
    }
    return '';
  }

  async function connect() {
    if (connecting) return;
    connecting = true;
    if (retry) retry.hidden = true;
    if (message) message.textContent = 'Подключаем Telegram и проверяем данные запуска…';
    if (status) status.classList.remove('miniapp-auth-error');

    if (!tg) {
      showError(
        'Не удалось подключить Telegram WebApp API.',
        'Откройте бота @CyxapukAI и запустите Mini App кнопкой «Открыть панель управления». Не используйте обычную ссылку из браузера.'
      );
      connecting = false;
      return;
    }

    try {
      tg.ready();
      tg.expand();
      tg.setHeaderColor?.('#171717');
      tg.setBackgroundColor?.('#171717');

      const initData = await getInitData();
      if (!initData) {
        const platform = tg.platform || 'не определена';
        const version = tg.version || 'не определена';
        const unsafeUser = tg.initDataUnsafe?.user;
        const hasUntrustedUser = Boolean(unsafeUser?.id);
        showError(
          'Telegram не передал подписанные данные запуска.',
          'Платформа: ' + platform + ' · WebApp API: ' + version + '. ' +
          (hasUntrustedUser ? 'Telegram показал профиль, но не передал подпись. Вход по неподписанному ID запрещён. ' : '') +
          'Закройте окно, откройте личный чат с @CyxapukAI и нажмите кнопку Mini App в сообщении /start. Если ошибка повторяется, проверьте домен Web App в BotFather и обновите Telegram.'
        );
        connecting = false;
        return;
      }

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
      showError(error.message || 'Ошибка подключения к серверу.');
      connecting = false;
      return;
    }
    connecting = false;
  }

  retry?.addEventListener('click', connect);
  connect();
})();
