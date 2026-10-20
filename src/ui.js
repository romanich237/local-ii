'use strict';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function layout(title, body) {
  return `<!doctype html>
<html lang="ru" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark light">
  <title>${escapeHtml(title)} · Local AI Server</title>
  <script>
    (() => {
      const saved = localStorage.getItem('local-ai-theme');
      const preferred = matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      document.documentElement.dataset.theme = saved || preferred;
    })();
  </script>
  <style>
    :root {
      --bg:#080b11;--surface:#111620;--surface-2:#171e2b;--line:#273044;
      --text:#f4f6fa;--muted:#929db0;--accent:#ff7a45;--accent-2:#ff9a70;
      --good:#55d68b;--danger:#ff6b77;--shadow:0 22px 60px rgba(0,0,0,.3);
    }
    :root[data-theme="light"] {
      --bg:#f3f5f8;--surface:#fff;--surface-2:#f7f8fb;--line:#dde2ea;
      --text:#171b24;--muted:#687386;--accent:#e85f2b;--accent-2:#f47d4f;
      --good:#18864b;--danger:#d83a48;--shadow:0 18px 55px rgba(37,44,59,.1);
    }
    *{box-sizing:border-box}html{min-height:100%}body{margin:0;min-height:100vh;background:
    radial-gradient(circle at 85% -10%,color-mix(in srgb,var(--accent) 18%,transparent),transparent 34%),
    radial-gradient(circle at -10% 45%,color-mix(in srgb,#7c5cff 10%,transparent),transparent 30%),var(--bg);
    color:var(--text);font:15px/1.5 Inter,ui-sans-serif,system-ui,-apple-system,sans-serif;transition:.2s}
    button,input{font:inherit}.shell{max-width:1180px;margin:auto;padding:28px 22px 48px}
    .topbar{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:30px}
    .brand{display:flex;align-items:center;gap:12px;font-size:18px;font-weight:800;letter-spacing:-.02em}
    .brand-mark{display:grid;place-items:center;width:38px;height:38px;border-radius:12px;background:
    linear-gradient(135deg,var(--accent),var(--accent-2));color:#1a0d08;box-shadow:0 10px 25px color-mix(in srgb,var(--accent) 28%,transparent)}
    .nav-actions,.inline-actions,.form-row{display:flex;align-items:center;gap:9px;flex-wrap:wrap}
    .theme-button,.button{display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--line);
    border-radius:11px;padding:10px 14px;background:var(--surface-2);color:var(--text);font-weight:700;cursor:pointer;text-decoration:none}
    .button.primary{border-color:transparent;background:linear-gradient(135deg,var(--accent),var(--accent-2));color:#1b0e08}
    .button.danger{color:var(--danger);background:color-mix(in srgb,var(--danger) 8%,var(--surface))}
    .hero{display:flex;justify-content:space-between;align-items:end;gap:20px;margin-bottom:22px}
    h1{font-size:clamp(28px,4vw,42px);line-height:1.1;letter-spacing:-.04em;margin:0 0 8px}h2{font-size:18px;margin:0}
    .muted{color:var(--muted)}.status{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--line);
    border-radius:999px;background:var(--surface)}.dot{width:8px;height:8px;border-radius:50%;background:var(--good);box-shadow:0 0 0 5px color-mix(in srgb,var(--good) 14%,transparent)}
    .base-url{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:18px;padding:16px 18px;
    border:1px solid color-mix(in srgb,var(--accent) 35%,var(--line));border-radius:15px;background:color-mix(in srgb,var(--accent) 7%,var(--surface))}
    .base-url code{font-size:15px;word-break:break-all}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px}
    .card{border:1px solid var(--line);border-radius:18px;background:color-mix(in srgb,var(--surface) 96%,transparent);box-shadow:var(--shadow)}
    .card-body{padding:20px}.stat span{display:block;color:var(--muted);margin-bottom:7px}.stat strong{font-size:30px;letter-spacing:-.04em}
    .section{margin-top:18px}.section-head{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;border-bottom:1px solid var(--line)}
    .form-row{padding:18px 20px}input{min-width:180px;flex:1;border:1px solid var(--line);border-radius:11px;padding:11px 13px;background:var(--surface-2);color:var(--text);outline:none}
    input:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 16%,transparent)}
    .table-wrap{overflow:auto}table{width:100%;border-collapse:collapse;white-space:nowrap}th,td{padding:14px 18px;border-bottom:1px solid var(--line);text-align:left}
    th{font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}tbody tr:last-child td{border-bottom:0}
    code,.key{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.badge{display:inline-flex;border-radius:999px;padding:5px 9px;font-size:12px;font-weight:750}
    .badge.on{color:var(--good);background:color-mix(in srgb,var(--good) 12%,transparent)}.badge.off{color:var(--muted);background:var(--surface-2)}
    .notice{margin-bottom:18px;padding:16px 18px;border-radius:14px;border:1px solid color-mix(in srgb,var(--good) 40%,var(--line));background:color-mix(in srgb,var(--good) 9%,var(--surface))}
    .notice code{display:block;margin-top:8px;word-break:break-all}.login-wrap{display:grid;place-items:center;min-height:calc(100vh - 76px)}
    pre{margin:0;padding:17px;border:1px solid var(--line);border-radius:13px;background:var(--surface-2);overflow:auto;white-space:pre-wrap;word-break:break-word}
    .login-card{width:min(430px,100%);padding:30px}.login-card h1{font-size:32px;margin-top:26px}.login-card form{display:grid;gap:12px;margin-top:22px}
    .login-card input,.login-card .button{width:100%}.login-top{display:flex;justify-content:space-between;align-items:center}.error{color:var(--danger);margin:10px 0 0}
    @media(max-width:760px){.shell{padding:18px 12px 32px}.hero{align-items:start;flex-direction:column}.grid{grid-template-columns:1fr}.base-url{align-items:start;flex-direction:column}.nav-actions .model{display:none}.card{border-radius:15px}.login-card{padding:22px}}
  </style>
</head>
<body><main class="shell">${body}</main>
<script>
  function toggleTheme(){
    const next=document.documentElement.dataset.theme==='dark'?'light':'dark';
    document.documentElement.dataset.theme=next;localStorage.setItem('local-ai-theme',next);
    document.querySelectorAll('[data-theme-label]').forEach(el=>el.textContent=next==='dark'?'Светлая тема':'Тёмная тема');
  }
  document.querySelectorAll('[data-theme-label]').forEach(el=>el.textContent=document.documentElement.dataset.theme==='dark'?'Светлая тема':'Тёмная тема');
  async function copyBaseUrl(button){
    await navigator.clipboard.writeText(button.dataset.value);const old=button.textContent;button.textContent='Скопировано';setTimeout(()=>button.textContent=old,1400);
  }
</script></body></html>`;
}

function themeButton() {
  return '<button class="theme-button" type="button" onclick="toggleTheme()" data-theme-label>Сменить тему</button>';
}

function loginPage(error = '') {
  return layout('Вход', `<section class="login-wrap"><div class="card login-card">
    <div class="login-top"><div class="brand"><span class="brand-mark">AI</span>Local AI</div>${themeButton()}</div>
    <h1>Панель управления</h1><p class="muted">Управляйте ключами и расходом локальной модели.</p>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
    <form method="post" action="/auth/login">
      <input name="username" autocomplete="username" minlength="10" maxlength="15" placeholder="Логин" required autofocus>
      <input name="password" type="password" autocomplete="current-password" minlength="10" maxlength="15" placeholder="Пароль" required>
      <button class="button primary" type="submit">Войти в панель</button>
    </form>
  </div></section>`);
}

function docsPage({ baseUrl, model }) {
  const curlExample = `curl ${baseUrl}/chat/completions \\\n  -H "Authorization: Bearer lai_ВАШ_КЛЮЧ" \\\n  -H "Content-Type: application/json" \\\n  -d '{"model":"${model}","messages":[{"role":"user","content":"Привет!"}],"stream":false}'`;
  const jsExample = `const response = await fetch('${baseUrl}/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer lai_ВАШ_КЛЮЧ',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: '${model}',
    messages: [{ role: 'user', content: 'Привет!' }]
  })
});
const data = await response.json();`;
  return layout('Документация', `<header class="topbar">
    <div class="brand"><span class="brand-mark">AI</span>Документация API</div>
    <div class="nav-actions">${themeButton()}<a class="button" href="/auth/">Админ-панель</a></div>
  </header>
  <section class="hero"><div><h1>Local AI API</h1><p class="muted">OpenAI-совместимый интерфейс для локальной модели.</p></div>
    <span class="status"><span class="dot"></span>${escapeHtml(model)}</span></section>
  <section class="base-url"><div><div class="muted">Base URL</div><code>${escapeHtml(baseUrl)}</code></div>
    <button class="button primary" type="button" data-value="${escapeHtml(baseUrl)}" onclick="copyBaseUrl(this)">Копировать</button></section>
  <section class="card section"><div class="section-head"><h2>Авторизация</h2></div><div class="card-body">
    <p>Передавайте ключ в каждом запросе через заголовок:</p><pre><code>Authorization: Bearer lai_ВАШ_КЛЮЧ</code></pre>
    <p class="muted">Создать ключ можно в админ-панели. Полный ключ показывается только один раз.</p>
  </div></section>
  <section class="card section"><div class="section-head"><h2>Методы</h2></div><div class="table-wrap"><table>
    <thead><tr><th>Метод</th><th>Путь</th><th>Описание</th></tr></thead><tbody>
    <tr><td><span class="badge on">POST</span></td><td><code>/chat/completions</code></td><td>Ответ модели, включая stream=true</td></tr>
    <tr><td><span class="badge off">GET</span></td><td><code>/models</code></td><td>Список установленных моделей</td></tr>
    </tbody></table></div></section>
  <section class="card section"><div class="section-head"><h2>Пример cURL</h2></div><div class="card-body"><pre><code>${escapeHtml(curlExample)}</code></pre></div></section>
  <section class="card section"><div class="section-head"><h2>Пример JavaScript</h2></div><div class="card-body"><pre><code>${escapeHtml(jsExample)}</code></pre></div></section>
  <section class="card section"><div class="section-head"><h2>Коды ответа</h2></div><div class="table-wrap"><table>
    <tbody><tr><td><code>200</code></td><td>Запрос выполнен</td></tr><tr><td><code>401</code></td><td>Неверный или отключённый ключ</td></tr>
    <tr><td><code>429</code></td><td>Исчерпан месячный лимит</td></tr><tr><td><code>502</code></td><td>Локальная модель недоступна</td></tr></tbody>
  </table></div></section>`);
}

function dashboard({ keys, totals, recent, model, baseUrl, newKey }) {
  const keyRows = keys.map(key => `<tr>
    <td><strong>${escapeHtml(key.name)}</strong></td><td><code>${escapeHtml(key.key_prefix)}…</code></td>
    <td>${Number(key.month_tokens).toLocaleString('ru-RU')} / ${key.monthly_limit ? Number(key.monthly_limit).toLocaleString('ru-RU') : '∞'}</td>
    <td><span class="badge ${key.enabled ? 'on' : 'off'}">${key.enabled ? 'Активен' : 'Отключён'}</span></td>
    <td><div class="inline-actions"><form method="post" action="/auth/keys/${key.id}/toggle"><button class="button" type="submit">${key.enabled ? 'Отключить' : 'Включить'}</button></form>
    <form method="post" action="/auth/keys/${key.id}/delete" onsubmit="return confirm('Удалить ключ?')"><button class="button danger" type="submit">Удалить</button></form></div></td>
  </tr>`).join('');
  const eventRows = recent.map(event => `<tr><td>${escapeHtml(event.created_at)}</td><td>${escapeHtml(event.name)}</td>
    <td>${escapeHtml(event.model)}</td><td>${event.total_tokens}</td><td>${event.latency_ms} мс</td><td>${event.status_code}</td></tr>`).join('');

  return layout('Управление', `<header class="topbar">
    <div class="brand"><span class="brand-mark">AI</span>Local AI Server</div>
    <div class="nav-actions"><span class="status model"><span class="dot"></span>${escapeHtml(model)}</span><a class="button" href="/docs">Документация</a>${themeButton()}<a class="button" href="/auth/logout">Выйти</a></div>
  </header>
  <section class="hero"><div><h1>Управление API</h1><p class="muted">Ключи доступа, лимиты и статистика запросов.</p></div>
    <span class="status"><span class="dot"></span>Сервис работает</span></section>
  <section class="base-url"><div><div class="muted">Base URL</div><code>${escapeHtml(baseUrl)}</code></div>
    <button class="button primary" type="button" data-value="${escapeHtml(baseUrl)}" onclick="copyBaseUrl(this)">Копировать</button></section>
  ${newKey ? `<div class="notice"><strong>Сохраните новый ключ — повторно он не показывается</strong><code>${escapeHtml(newKey)}</code></div>` : ''}
  <section class="grid">
    <div class="card stat"><div class="card-body"><span>Запросов за месяц</span><strong>${totals.requests}</strong></div></div>
    <div class="card stat"><div class="card-body"><span>Токенов за месяц</span><strong>${Number(totals.tokens).toLocaleString('ru-RU')}</strong></div></div>
    <div class="card stat"><div class="card-body"><span>Средняя задержка</span><strong>${totals.avg_latency} мс</strong></div></div>
  </section>
  <section class="card section"><div class="section-head"><h2>Создать API-ключ</h2></div>
    <form class="form-row" method="post" action="/auth/keys"><input name="name" placeholder="Название ключа" maxlength="60" required>
    <input name="monthlyLimit" type="number" min="0" placeholder="Лимит токенов в месяц, 0 = без лимита"><button class="button primary" type="submit">Создать</button></form></section>
  <section class="card section"><div class="section-head"><h2>API-ключи</h2><span class="muted">${keys.length}</span></div><div class="table-wrap">
    <table><thead><tr><th>Название</th><th>Ключ</th><th>Расход / лимит</th><th>Состояние</th><th>Действия</th></tr></thead>
    <tbody>${keyRows || '<tr><td colspan="5" class="muted">Ключей пока нет</td></tr>'}</tbody></table></div></section>
  <section class="card section"><div class="section-head"><h2>Последние запросы</h2></div><div class="table-wrap">
    <table><thead><tr><th>Время UTC</th><th>Ключ</th><th>Модель</th><th>Токены</th><th>Задержка</th><th>HTTP</th></tr></thead>
    <tbody>${eventRows || '<tr><td colspan="6" class="muted">Запросов пока нет</td></tr>'}</tbody></table></div></section>`);
}

module.exports = { loginPage, dashboard, docsPage };
