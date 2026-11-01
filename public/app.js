'use strict';

(() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const formatBytes = value => {
    if (!Number.isFinite(Number(value))) return '—';
    const units = ['Б', 'КБ', 'МБ', 'ГБ', 'ТБ'];
    let size = Number(value), index = 0;
    while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
    return size.toLocaleString('ru-RU', { maximumFractionDigits: 1 }) + ' ' + units[index];
  };
  const formatDuration = seconds => {
    const value = Math.max(0, Number(seconds) || 0);
    const days = Math.floor(value / 86400);
    const hours = Math.floor(value % 86400 / 3600);
    const minutes = Math.floor(value % 3600 / 60);
    return (days ? days + ' д ' : '') + hours + ' ч ' + minutes + ' мин';
  };

  const serverStatus = $('[data-server-status]');
  const serverFields = {
    version: $('[data-server-version]'), platform: $('[data-server-platform]'), cpu: $('[data-server-cpu]'),
    uptime: $('[data-server-uptime]'), models: $('[data-server-models]'), telegram: $('[data-server-telegram]'), timezone: $('[data-server-timezone]')
  };
  const gaugeElements = Object.fromEntries(['cpu', 'memory', 'disk'].map(name => [name, $('[data-gauge="' + name + '"]')]));
  const gaugeDetails = Object.fromEntries(['memory', 'disk'].map(name => [name, $('[data-gauge-detail="' + name + '"]')]));
  const setGauge = (name, value) => {
    const gauge = gaugeElements[name];
    if (!gauge) return;
    const percent = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
    gauge.style.setProperty('--gauge-value', percent);
    const label = gauge.querySelector('[data-gauge-text]');
    if (label) label.textContent = percent + '%';
  };
  async function refreshServerStatus() {
    if (!serverStatus) return;
    serverStatus.textContent = 'Проверка…';
    try {
      const response = await fetch('/auth/server-status', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      serverStatus.textContent = data.ollama ? 'Работает' : 'Ollama недоступна';
      serverStatus.dataset.state = data.ollama ? 'ok' : 'error';
      if (serverFields.version) serverFields.version.textContent = 'v' + data.version;
      if (serverFields.platform) serverFields.platform.textContent = data.platform + ' · ' + data.arch;
      if (serverFields.cpu) serverFields.cpu.textContent = data.cpuCores + ' ядер';
      if (serverFields.uptime) serverFields.uptime.textContent = formatDuration(data.uptimeSeconds);
      if (serverFields.models) serverFields.models.textContent = data.installedModels + ' · ' + data.defaultModel;
      if (serverFields.telegram) serverFields.telegram.textContent = data.telegramEnabled ? 'Настроен' : 'Не подключён';
      if (serverFields.timezone) serverFields.timezone.textContent = data.timeZone || 'Europe/Moscow';
      setGauge('cpu', data.cpu?.percent);
      setGauge('memory', data.memory?.percent);
      setGauge('disk', data.disk?.percent);
      if (gaugeDetails.memory) gaugeDetails.memory.textContent = formatBytes(data.memory.used) + ' / ' + formatBytes(data.memory.total);
      if (gaugeDetails.disk) gaugeDetails.disk.textContent = formatBytes(data.disk?.used) + ' / ' + formatBytes(data.disk?.total);
    } catch (error) {
      serverStatus.textContent = 'Не удалось получить состояние';
      serverStatus.dataset.state = 'error';
    }
  }
  $('[data-refresh-status]')?.addEventListener('click', refreshServerStatus);
  refreshServerStatus();
  if (serverStatus) window.setInterval(refreshServerStatus, 15000);

  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-copy]');
    if (!button) return;
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      const previous = button.textContent;
      button.textContent = 'Скопировано';
      window.setTimeout(() => { button.textContent = previous; }, 1400);
    } catch { button.textContent = 'Не удалось скопировать'; }
  });
  document.addEventListener('submit', event => {
    if (event.target.matches('.key-rotate-form') && !window.confirm('Старый ключ будет заменён новым. Продолжить?')) event.preventDefault();
  });

  const chatForm = $('[data-chat-form]');
  const settings = $('[data-chat-settings]');
  const transcript = $('[data-chat-transcript]');
  const status = $('[data-chat-status]');
  const history = [];
  const addMessage = (role, content, metrics) => {
    const empty = $('.chat-empty', transcript);
    if (empty) empty.remove();
    const article = document.createElement('article');
    article.className = 'chat-message chat-message-' + role;
    const label = document.createElement('span');
    label.className = 'chat-message-role';
    label.textContent = role === 'user' ? 'Вы' : 'Модель';
    const body = document.createElement('p');
    body.textContent = content;
    article.append(label, body);
    if (metrics) {
      const footer = document.createElement('small');
      footer.className = 'chat-metrics';
      footer.textContent = 'Токены: ' + metrics.totalTokens + ' (вход ' + metrics.promptTokens + ', выход ' + metrics.completionTokens + ') · ' + metrics.elapsedSeconds.toFixed(2) + ' с';
      article.append(footer);
    }
    transcript.append(article);
    transcript.scrollTop = transcript.scrollHeight;
  };
  $('[data-chat-clear]')?.addEventListener('click', () => {
    history.length = 0;
    transcript.replaceChildren();
    const empty = document.createElement('div');
    empty.className = 'chat-empty';
    empty.textContent = 'История очищена. Можно начать новый диалог.';
    transcript.append(empty);
    status.textContent = 'История очищена';
  });

  chatForm?.addEventListener('submit', async event => {
    event.preventDefault();
    const input = chatForm.elements.message;
    const prompt = input.value.trim();
    if (!prompt) return;
    const model = settings.elements.model.value;
    const systemPrompt = settings.elements.systemPrompt.value;
    const maxTokens = Math.max(1, Math.min(32768, Number(settings.elements.maxTokens.value) || 1024));
    history.push({ role: 'user', content: prompt });
    addMessage('user', prompt);
    input.value = '';
    input.disabled = true;
    const submit = $('button[type="submit"]', chatForm);
    submit.disabled = true;
    status.textContent = 'Модель генерирует ответ…';
    const started = performance.now();
    try {
      const response = await fetch('/auth/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ model, systemPrompt, maxTokens, messages: history.slice(-40) })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Ошибка запроса');
      history.push({ role: 'assistant', content: result.answer });
      const elapsed = Number(result.elapsedSeconds ?? ((performance.now() - started) / 1000));
      addMessage('assistant', result.answer, {
        promptTokens: result.usage.promptTokens,
        completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens,
        elapsedSeconds: elapsed
      });
      status.textContent = 'Готово · ' + result.model + ' · ' + elapsed.toFixed(2) + ' с';
    } catch (error) {
      history.pop();
      status.textContent = 'Ошибка: ' + error.message;
      addMessage('assistant', 'Не удалось выполнить запрос: ' + error.message);
    } finally {
      input.disabled = false;
      submit.disabled = false;
      input.focus();
    }
  });

  const updateButton = $('[data-update-check]');
  const updateMessage = $('[data-update-message]');
  const updateState = $('[data-update-state]');
  const updateChecked = $('[data-update-checked]');
  const updateLatest = $('[data-update-latest]');
  function renderUpdateStatus(data) {
    if (!data) return;
    const labels = {
      idle: 'Ожидает проверки',
      available: 'Доступно обновление',
      checking: 'Проверка…',
      updating: 'Установка обновления…',
      current: 'Установлена последняя версия',
      updated: 'Обновление установлено',
      error: 'Ошибка проверки'
    };
    if (updateMessage) updateMessage.textContent = data.message || '';
    if (updateState) {
      updateState.textContent = labels[data.state] || data.state || 'Неизвестно';
      updateState.dataset.updateState = data.state || 'idle';
    }
    if (updateChecked && data.checkedAt) {
      updateChecked.textContent = new Date(data.checkedAt).toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
    }
    if (updateLatest && data.latestVersion) updateLatest.textContent = data.latestVersion;
    if (updateButton) updateButton.disabled = ['checking', 'updating'].includes(data.state);
  }
  async function readUpdateStatus() {
    const response = await fetch('/auth/update-status', { cache: 'no-store', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
  }
  updateButton?.addEventListener('click', async () => {
    updateButton.disabled = true;
    if (updateMessage) updateMessage.textContent = 'Отправляем запрос на проверку…';
    try {
      const response = await fetch('/auth/update-check', {
        method: 'POST',
        headers: { Accept: 'application/json' }
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Не удалось запустить проверку');
      if (updateMessage) updateMessage.textContent = 'Запрос принят. Ожидаем результат…';
      let attempts = 0;
      while (attempts < 90) {
        await new Promise(resolve => window.setTimeout(resolve, 2000));
        const data = await readUpdateStatus();
        renderUpdateStatus(data);
        if (!['checking', 'updating', 'idle'].includes(data.state)) {
          if (data.state === 'updated') {
            window.setTimeout(() => window.location.reload(), 1800);
          }
          return;
        }
        attempts += 1;
      }
      if (updateMessage) updateMessage.textContent = 'Проверка ещё выполняется. Обновите страницу через некоторое время.';
      updateButton.disabled = false;
    } catch (error) {
      if (updateMessage) updateMessage.textContent = 'Ошибка: ' + error.message;
      updateButton.disabled = false;
    }
  });

  const pythonForm = $('#python-client-form');
  pythonForm?.addEventListener('submit', () => {
    pythonForm.elements.model.value = settings.elements.model.value;
    pythonForm.elements.systemPrompt.value = settings.elements.systemPrompt.value;
    pythonForm.elements.maxTokens.value = settings.elements.maxTokens.value;
  });
})();
