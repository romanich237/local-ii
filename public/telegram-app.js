'use strict';

(() => {
  const status = document.querySelector('[data-miniapp-status]');
  const message = document.querySelector('[data-miniapp-message]');
  const retry = document.querySelector('[data-miniapp-retry]');
  const fallbackForm = document.querySelector('[data-miniapp-login]');
  const fallbackError = document.querySelector('[data-miniapp-login-error]');
  const fallbackSubmit = document.querySelector('[data-miniapp-login-submit]');
  const profile = document.querySelector('[data-miniapp-profile]');
  const links = document.querySelector('[data-miniapp-links]');
  let connecting = false;

  function showFallback(text, details = '') {
    if (message) message.textContent = text;
    const diagnostic = document.querySelector('[data-miniapp-diagnostic]');
    if (diagnostic) {
      diagnostic.textContent = details;
      diagnostic.hidden = !details;
    }
    if (status) status.classList.add('miniapp-auth-error');
    if (retry) retry.hidden = false;
    if (fallbackForm) fallbackForm.hidden = false;
  }

  function wait(ms) {
    return new Promise(resolve => window.setTimeout(resolve, ms));
  }

  async function getInitData() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const value = window.Telegram?.WebApp?.initData;
      if (typeof value === 'string' && value.length > 0) return value;
      await wait(100);
    }
    return '';
  }

  function showAuthenticated(user, method) {
    const name = user.name || [user.firstName, user.lastName].filter(Boolean).join(' ') || (user.username ? '@' + user.username : 'Администратор');
    document.querySelector('[data-miniapp-name]').textContent = name;
    document.querySelector('[data-miniapp-id-label]').textContent = method === 'telegram' ? 'Telegram ID' : 'Логин';
    document.querySelector('[data-miniapp-id]').textContent = method === 'telegram' ? user.id : (user.username || 'Администратор');
    profile.hidden = false;
    links.hidden = false;
    status.hidden = true;
    window.Telegram?.WebApp?.HapticFeedback?.notificationOccurred?.('success');
  }

  async function connect() {
    if (connecting) return;
    connecting = true;
    if (retry) retry.hidden = true;
    if (message) message.textContent = 'Подключаем Telegram и проверяем данные запуска…';
    if (status) status.classList.remove('miniapp-auth-error');

    const tg = window.Telegram?.WebApp;
    if (!tg) {
      showFallback(
        'Telegram не удалось распознать. Вы можете войти вручную.',
        'Откройте Mini App из бота либо используйте резервный вход по логину и паролю администратора.'
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
        showFallback(
          'Telegram не передал данные аккаунта. Войдите по логину и паролю.',
          'Подписанные данные initData отсутствуют. Для безопасности вход по неподписанному Telegram ID не используется.'
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
      if (!response.ok || !result.ok) {
        showFallback(
          result.error || 'Telegram ID не подтверждён. Используйте резервный вход.',
          'Можно войти с теми же логином и паролем, которые используются для входа в веб-админку.'
        );
        connecting = false;
        return;
      }
      showAuthenticated(result.user, 'telegram');
    } catch (error) {
      showFallback(error.message || 'Не удалось подключиться к Telegram.', 'Попробуйте повторить проверку или войдите по логину и паролю.');
    }
    connecting = false;
  }

  fallbackForm?.addEventListener('submit', async event => {
    event.preventDefault();
    if (fallbackSubmit) {
      fallbackSubmit.disabled = true;
      fallbackSubmit.textContent = 'Проверка…';
    }
    if (fallbackError) {
      fallbackError.hidden = true;
      fallbackError.textContent = '';
    }
    const form = new FormData(fallbackForm);
    try {
      const response = await fetch('/telegram-app/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        cache: 'no-store',
        body: JSON.stringify({
          username: String(form.get('username') || ''),
          password: String(form.get('password') || '')
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error || 'Не удалось войти');
      showAuthenticated(result.user, 'password');
      fallbackForm.hidden = true;
    } catch (error) {
      if (fallbackError) {
        fallbackError.textContent = error.message;
        fallbackError.hidden = false;
      }
    } finally {
      if (fallbackSubmit) {
        fallbackSubmit.disabled = false;
        fallbackSubmit.textContent = 'Войти в панель';
      }
    }
  });

  retry?.addEventListener('click', connect);
  connect();
})();
