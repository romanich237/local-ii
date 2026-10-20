# Local AI Server

Сервер для запуска локальной нейросети на Ubuntu 22.04. Проект устанавливает Ollama, предоставляет совместимый с OpenAI API и добавляет веб-панель для управления ключами и расходом токенов.

После установки будут доступны:

| Раздел | Адрес |
|---|---|
| Веб-панель | `https://ваш-домен/auth/` |
| Документация | `https://ваш-домен/docs` |
| Base URL | `https://ваш-домен/v1` |
| Проверка состояния | `https://ваш-домен/health` |

## Возможности

- запуск локальной модели через Ollama;
- OpenAI-совместимые методы `/v1/chat/completions` и `/v1/models`;
- обычные и потоковые ответы;
- создание и отключение API-ключей;
- месячные лимиты токенов для каждого ключа;
- статистика запросов, токенов и задержки;
- тёмная и светлая темы панели;
- автоматический выбор подходящей модели по характеристикам сервера;
- отдельная конфигурация Nginx без изменения других сайтов;
- автоматический выпуск SSL-сертификата Let's Encrypt;
- встроенная поддержка обычных доменов и DuckDNS;
- запуск и восстановление процессов через PM2;
- автоматическое обновление из GitHub каждую минуту;
- SQLite без отдельной установки сервера базы данных.

## Требования

- Ubuntu 22.04;
- доступ `root` или `sudo`;
- домен или поддомен;
- открытые порты `80` и `443`;
- минимум 4 ГБ RAM;
- минимум 10 ГБ свободного места;
- GitHub Personal Access Token с доступом на чтение репозитория.

Видеокарта не обязательна. Без GPU модель будет работать на процессоре, но медленнее.

## 1. Подготовьте домен

Создайте у DNS-провайдера A-запись:

| Поле | Значение |
|---|---|
| Тип | `A` |
| Имя | например `ai` |
| Значение | IPv4-адрес сервера |
| Proxy | выключен на время первого выпуска SSL |

Например, для домена `ai.example.com` запись должна указывать на IP вашего сервера.

Проверить запись можно командой:

```bash
nslookup ai.example.com
```

### Использование DuckDNS

Если собственного домена нет, можно использовать бесплатный поддомен DuckDNS:

1. откройте [duckdns.org](https://www.duckdns.org/);
2. войдите через предложенный сервис;
3. создайте поддомен, например `my-local-ai`;
4. итоговый адрес будет `my-local-ai.duckdns.org`;
5. скопируйте токен со страницы DuckDNS.

Во время установки укажите полный домен:

```text
my-local-ai.duckdns.org
```

Установщик автоматически распознает DuckDNS и отдельно запросит токен. После этого он:

- привяжет поддомен к текущему внешнему IP сервера;
- сохранит токен в `/etc/local-ii/duckdns.env` с правами `600`;
- создаст systemd-таймер `local-ii-duckdns.timer`;
- будет обновлять IP в DuckDNS каждые 5 минут;
- выпустит обычный SSL-сертификат для `my-local-ai.duckdns.org`.

Токен DuckDNS не сохраняется в проекте и не загружается в GitHub.

Проверить таймер:

```bash
systemctl status local-ii-duckdns.timer
systemctl list-timers local-ii-duckdns.timer
```

Обновить IP вручную:

```bash
sudo /usr/local/bin/local-ii-duckdns
```

## 2. Подготовьте GitHub Token

Репозиторий приватный, поэтому для скачивания понадобится Personal Access Token:

1. откройте GitHub;
2. перейдите в `Settings → Developer settings → Personal access tokens`;
3. создайте Fine-grained token;
4. выберите репозиторий `romanich237/local-ii`;
5. выдайте разрешение `Contents: Read-only`;
6. сохраните токен — GitHub покажет его только один раз.

Токен понадобится вместо пароля GitHub при клонировании и ещё один раз в установщике для настройки автообновления.

## 3. Установите Local AI Server

```bash
cd /root
git clone https://github.com/romanich237/local-ii.git
cd local-ii
sudo bash install.sh
```

Во время `git clone` введите:

```text
Username: romanich237
Password: ваш GitHub Token
```

Обычный пароль от GitHub использовать не нужно.

Установщик попросит:

1. GitHub Token для автообновления, если Git не сохранил авторизацию;
2. домен без `https://`;
3. токен DuckDNS, если указан домен `*.duckdns.org`;
4. email для Let's Encrypt;
5. логин веб-панели длиной 10–15 символов;
6. пароль веб-панели длиной 10–15 символов;
7. базовую модель.

Затем установщик автоматически:

- определит CPU, RAM, свободное место и NVIDIA VRAM;
- покажет подходящие модели;
- установит Node.js 20, PM2, Ollama, Nginx и Certbot;
- скачает выбранную модель;
- создаст `config.json`;
- сохранит GitHub Token в `/etc/local-ii/github-credentials` с правами `600`;
- создаст отдельный конфиг `/etc/nginx/sites-available/local-ii.conf`;
- проверит, не занят ли домен другим проектом;
- запустит API и автообновление через PM2;
- получит SSL-сертификат.

Загрузка модели может занять несколько минут.

## 4. Первый вход

Откройте:

```text
https://ваш-домен/auth/
```

Введите логин и пароль, которые указали во время установки.

В панели отображаются:

- Base URL;
- активная модель;
- количество запросов за месяц;
- расход токенов;
- средняя задержка;
- API-ключи и их лимиты;
- последние запросы.

## 5. Создайте API-ключ

В панели заполните:

- название ключа;
- месячный лимит токенов;
- `0`, если лимит не нужен.

После создания полный ключ показывается только один раз. Сохраните его в безопасном месте.

Пример ключа:

```text
lai_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

В базе хранится только SHA-256-хэш ключа.

## Использование API

### Base URL

```text
https://ваш-домен/v1
```

### Получить список моделей

```bash
curl https://ваш-домен/v1/models \
  -H "Authorization: Bearer lai_ВАШ_КЛЮЧ"
```

### Отправить сообщение

```bash
curl https://ваш-домен/v1/chat/completions \
  -H "Authorization: Bearer lai_ВАШ_КЛЮЧ" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3.5:4b",
    "messages": [
      {
        "role": "user",
        "content": "Привет! Расскажи короткую шутку."
      }
    ],
    "stream": false
  }'
```

Поле `model` можно не передавать — тогда будет использована базовая модель из `config.json`.

### JavaScript

```javascript
const response = await fetch('https://ваш-домен/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer lai_ВАШ_КЛЮЧ',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    model: 'qwen3.5:4b',
    messages: [
      { role: 'user', content: 'Привет!' }
    ]
  })
});

const data = await response.json();
console.log(data.choices[0].message.content);
```

## Выбор модели

Установщик предлагает модели примерно по объёму RAM:

| Модель | Рекомендуемая RAM | Размер загрузки |
|---|---:|---:|
| `qwen3.5:0.8b` | от 4 ГБ | около 1,3 ГБ |
| `qwen3.5:2b` | от 6 ГБ | около 3,1 ГБ |
| `qwen3.5:4b` | от 8 ГБ | около 4 ГБ |
| `qwen3.5:9b` | от 12 ГБ | около 7,6 ГБ |
| `qwen3.5:27b` | от 28 ГБ | около 20 ГБ |
| `qwen3.5:35b` | от 32 ГБ | около 22 ГБ |

Это приблизительные значения. Для большого контекста потребуется дополнительная память.

## Управление сервером

Показать процессы:

```bash
pm2 status
```

Логи API:

```bash
pm2 logs local-ai-api
```

Логи автообновления:

```bash
pm2 logs local-ai-updater
```

Перезапустить API:

```bash
pm2 restart local-ai-api
```

Проверить Ollama:

```bash
systemctl status ollama
ollama list
```

Проверить Nginx:

```bash
sudo nginx -t
systemctl status nginx
```

## Автоматическое обновление

Процесс `local-ai-updater` раз в минуту:

1. проверяет ветку `main`;
2. принимает только безопасное fast-forward обновление;
3. выполняет `npm ci --omit=dev`;
4. перезапускает API через PM2.

Для автообновления используется HTTPS и GitHub Token из защищённого файла `/etc/local-ii/github-credentials`. Токен не добавляется в адрес `origin` и не попадает в репозиторий.

Отключить автообновление можно в `config.json`:

```json
{
  "autoUpdate": false
}
```

После изменения:

```bash
pm2 restart local-ai-updater
```

### Обновление вручную

```bash
cd /root/local-ii
git pull --ff-only
npm ci --omit=dev
pm2 restart local-ai-api local-ai-updater
```

## Конфигурация

Основные параметры находятся в `config.json`:

```json
{
  "port": 1488,
  "domain": "ai.example.com",
  "baseUrl": "https://ai.example.com/v1",
  "ollamaUrl": "http://127.0.0.1:11434",
  "defaultModel": "qwen3.5:4b",
  "adminUsername": "administrator",
  "autoUpdate": true,
  "updateIntervalSeconds": 60,
  "repositoryBranch": "main"
}
```

Не публикуйте настоящий `config.json`: в нём хранятся хэш пароля и секрет сессии. Файл уже добавлен в `.gitignore`.

После изменения конфигурации перезапустите процессы:

```bash
pm2 restart local-ai-api local-ai-updater
```

## Где хранятся данные

| Данные | Путь |
|---|---|
| Конфигурация | `config.json` |
| SQLite | `data/local-ai.db` |
| Nginx | `/etc/nginx/sites-available/local-ii.conf` |
| Настройки DuckDNS | `/etc/local-ii/duckdns.env` |
| Доступ GitHub | `/etc/local-ii/github-credentials` |
| Модели Ollama | каталог Ollama |
| Логи | `pm2 logs` |

Каталог `data/` и `config.json` не загружаются в GitHub.

## Резервная копия

Для сохранения ключей и статистики скопируйте:

```bash
cd /root/local-ii
tar -czf local-ii-backup.tar.gz config.json data/
```

## Частые проблемы

### SSL не выпустился

Проверьте:

- домен указывает на правильный IPv4;
- порты `80` и `443` открыты;
- проксирование Cloudflare временно выключено;
- Nginx запущен.

Повторный выпуск:

```bash
sudo certbot --nginx -d ai.example.com
```

### DuckDNS не обновляет IP

Проверьте сервис и таймер:

```bash
systemctl status local-ii-duckdns.service
systemctl status local-ii-duckdns.timer
journalctl -u local-ii-duckdns.service --lines 50
```

Запустите обновление вручную:

```bash
sudo /usr/local/bin/local-ii-duckdns
```

Если команда завершается ошибкой, проверьте поддомен и токен в:

```text
/etc/local-ii/duckdns.env
```

### Домен уже используется

Установщик покажет путь к конфликтующему конфигу и остановится, не изменяя чужой сайт.

Найдите домен:

```bash
grep -R "server_name" /etc/nginx/sites-enabled/
```

### API возвращает 401

Ключ отсутствует, введён неправильно или отключён в панели. Заголовок должен выглядеть так:

```text
Authorization: Bearer lai_ВАШ_КЛЮЧ
```

### API возвращает 429

Для ключа закончился месячный лимит токенов. Создайте новый ключ или измените подход к лимитам.

### API возвращает 502

Проверьте модель и Ollama:

```bash
systemctl status ollama
ollama list
curl http://127.0.0.1:11434/api/tags
```

Если модель отсутствует:

```bash
ollama pull qwen3.5:4b
```

### Панель не открывается

```bash
pm2 status
pm2 logs local-ai-api --lines 100
sudo nginx -t
systemctl status nginx
```

## Безопасность

- Node.js и Ollama слушают только `127.0.0.1`;
- наружу запросы проходят через HTTPS и Nginx;
- пароль хранится как scrypt-хэш;
- API-ключи хранятся как SHA-256-хэши;
- cookie панели имеет `HttpOnly` и `SameSite=Strict`;
- после пяти неверных входов IP блокируется на 15 минут;
- конфигурация и база исключены из Git.

Дополнительно рекомендуется:

- входить на сервер только по SSH-ключам;
- отключить парольный вход SSH;
- разрешить в UFW только `22`, `80` и `443`;
- регулярно копировать `config.json` и каталог `data/`.

## Структура проекта

```text
local-ii/
├── src/
│   ├── config.js
│   ├── db.js
│   ├── security.js
│   ├── server.js
│   ├── ui.js
│   └── updater.js
├── config.example.json
├── ecosystem.config.cjs
├── install.sh
├── package.json
└── README.md
```

## Лицензия и доступ

Репозиторий приватный. Не передавайте исходный код, конфигурацию и API-ключи третьим лицам без разрешения владельца.
