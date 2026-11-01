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

  async function refreshServerStatus() {
    const status = $('[data-server-status]');
    if (!status) return;
    status.textContent = 'Проверка…';
    try {
      const response = await fetch('/auth/server-status', { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      status.textContent = data.ollama ? 'Работает' : 'Ollama недоступна';
      status.dataset.state = data.ollama ? 'ok' : 'error';
      $('[data-server-version]').textContent = 'v' + data.version;
      $('[data-server-platform]').textContent = data.platform + ' · ' + data.arch;
      $('[data-server-cpu]').textContent = data.cpuCores + ' ядер · нагрузка ' + data.loadAverage.join(' / ');
      $('[data-server-memory]').textContent = formatBytes(data.memory.used) + ' / ' + formatBytes(data.memory.total);
      $('[data-server-disk]').textContent = data.disk ? formatBytes(data.disk.free) + ' свободно из ' + formatBytes(data.disk.total) : 'Недоступно';
      $('[data-server-uptime]').textContent = formatDuration(data.uptimeSeconds);
      $('[data-server-models]').textContent = data.installedModels + ' · ' + data.defaultModel;
      $('[data-server-telegram]').textContent = data.telegramEnabled ? 'Настроен' : 'Не подключён';
    } catch (error) {
      status.textContent = 'Не удалось получить состояние';
      status.dataset.state = 'error';
    }
  }

  $('[data-refresh-status]')?.addEventListener('click', refreshServerStatus);
  refreshServerStatus();
  if ($('[data-server-status]')) window.setInterval(refreshServerStatus, 30000);

  $$('[data-model-tab]').forEach(button => button.addEventListener('click', () => {
    const selected = button.dataset.modelTab;
    $$('[data-model-tab]').forEach(item => {
      const active = item === button;
      item.classList.toggle('is-active', active);
      item.setAttribute('aria-selected', String(active));
    });
    $$('[data-model-panel]').forEach(panel => { panel.hidden = panel.dataset.modelPanel !== selected; });
  }));

  $$('[data-copy]').forEach(button => button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.copy);
      const previous = button.textContent;
      button.textContent = 'Скопировано';
      window.setTimeout(() => { button.textContent = previous; }, 1400);
    } catch {
      button.textContent = 'Не удалось скопировать';
    }
  }));

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
        body: JSON.stringify({ model, systemPrompt, maxTokens, messages: history })
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

  const pythonForm = $('#python-client-form');
  pythonForm?.addEventListener('submit', () => {
    pythonForm.elements.model.value = settings.elements.model.value;
    pythonForm.elements.systemPrompt.value = settings.elements.systemPrompt.value;
    pythonForm.elements.maxTokens.value = settings.elements.maxTokens.value;
  });
})();
