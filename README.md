# Local AI Server

Self-hosted OpenAI-compatible API на базе Ollama. В проект входят Node.js API, веб-панель, управление API-ключами, статистика токенов, каталог моделей, Nginx, SSL и автообновление из GitHub.

## Адреса после установки

- Панель: `https://ВАШ-ДОМЕН/auth/`
- Документация: `https://ВАШ-ДОМЕН/docs`
- Base URL: `https://ВАШ-ДОМЕН/v1`
- Проверка состояния: `https://ВАШ-ДОМЕН/health`

## Требования

- Linux с systemd, root/sudo.
- Архитектура x86_64 или ARM64.
- От 4 ГБ RAM (для компактных моделей); для моделей 7B и выше желательно 8–16 ГБ или больше.
- Не менее 10 ГБ свободного места плюс место под веса моделей.
- Домен с A-записью на IP сервера.
- Открытые входящие TCP-порты 80 и 443.
- Доступ к GitHub для получения исходников.

Поддерживаются Debian/Ubuntu и производные (APT), Fedora/RHEL/Rocky/AlmaLinux/CentOS Stream (DNF/YUM), Arch/Manjaro (Pacman), openSUSE (Zypper). Нужны systemd и один из перечисленных пакетных менеджеров. Alpine, NixOS, Gentoo и системы без systemd требуют ручной адаптации.

GPU необязателен: Ollama может работать на CPU, но генерация будет медленнее. Для NVIDIA GPU установите совместимый драйвер.

## Получение исходников

Репозиторий `romanich237/local-ii` приватный. Для первого клонирования нужен доступ к нему. Можно использовать HTTPS с Fine-grained PAT с правом Contents: Read-only либо предварительно настроенный SSH-доступ.

```bash
sudo -i
mkdir -p /opt
cd /opt
git clone https://github.com/romanich237/local-ii.git
cd local-ii
```

Если GitHub запросит пароль при HTTPS-клонировании, используйте Fine-grained PAT только для этого репозитория с разрешением Contents: Read-only. GitHub не принимает пароль аккаунта вместо токена. Не вставляйте токен в файлы проекта или публичные команды.

## Установка с нуля

Из каталога репозитория:

```bash
sudo bash install.sh
```

Установщик проверит ОС, архитектуру, CPU, RAM, свободное место и NVIDIA VRAM. Затем запросит:

1. Домен, например `ai.example.com`. DNS A-запись должна указывать на сервер.
2. Email для Let's Encrypt.
3. Логин администратора (10–15 символов, латиница/цифры/`_`/`-`).
4. Основную модель Ollama из списка или точный тег вручную.

Установщик установит Node.js 24 LTS, PM2, Ollama, Nginx и Certbot; загрузит выбранную модель; создаст локальный `config.json`; настроит Nginx и SSL; запустит API и updater. Пароль администратора генерируется автоматически и показывается в конце установки — сохраните его.

### DuckDNS

Если вводите DuckDNS-домен, установщик может запросить поддомен и токен, обновить IP и создать systemd timer на каждые пять минут. Секрет хранится в `/etc/local-ii/duckdns.env` с правами 600.

## Автообновление без личного GitHub PAT

Постоянное обновление выполняется из `romanich237/local-ii`, ветка `main`. Для приватного репозитория используется отдельный SSH deploy key, привязанный к репозиторию, а не к личному GitHub-профилю.

Во время установки скрипт `setup-github-access.sh` создаёт ключ на сервере и показывает его публичную часть. Добавьте её в GitHub: **Repository → Settings → Deploy keys → Add deploy key**. Не включайте **Allow write access**. Приватный ключ остаётся в `/etc/local-ii/deploy_key` с правами 600.

Для уже установленного сервера:

```bash
cd /opt/local-ii
sudo bash setup-github-access.sh
```

После добавления deploy key updater получает обновления напрямую из origin без персонального PAT. Первый clone — отдельный шаг: для него всё ещё нужен доступ к приватному репозиторию (HTTPS PAT или SSH).

Updater проверяет ветку с интервалом из `config.json` (по умолчанию 60 секунд). При новом commit выполняется fast-forward, `npm ci --omit=dev`, затем перезапускается API через PM2. Ручное управление:

### Ручное обновление на сервере

Если нужно установить последнюю версию немедленно, подключитесь к серверу и выполните команды от того же пользователя, под которым запущен PM2. В стандартной установке Local AI Server это root:

Сначала переключитесь на root:

```bash
sudo -i
```

Затем выполните обновление:

```bash
cd /opt/local-ii
git fetch --prune origin main
git merge --ff-only origin/main
if [ -f package-lock.json ]; then
  npm ci --omit=dev
else
  npm install --omit=dev --no-package-lock
fi

pm2 reload local-ai-api --update-env
pm2 restart local-ai-updater --update-env
pm2 save
```

Команды получают изменения только из ветки `main`, устанавливают production-зависимости и перезапускают процессы приложения. База SQLite и локальный `config.json` не заменяются этой последовательностью.

Для приватного репозитория перед ручным обновлением должен быть настроен Deploy Key:

```bash
cd /opt/local-ii
sudo bash setup-github-access.sh
```

Добавьте показанный публичный ключ в **Repository → Settings → Deploy keys** без разрешения записи. После успешной настройки `origin` и SSH-команда Git сохраняются в локальной конфигурации репозитория, поэтому последующие `git fetch` выполняются без персонального PAT.

Если `git merge --ff-only` сообщает о конфликте или локальных изменениях, не используйте `git reset --hard` и не удаляйте файлы. Сначала сохраните локальные изменения и выясните, почему рабочая копия разошлась с GitHub.

Проверить результат:

```bash
git log -1 --oneline
pm2 status
PORT=$(node -p "require('./config.json').port")
curl -fsS "http://127.0.0.1:$PORT/health"
```



```bash
pm2 status
pm2 logs local-ai-updater
pm2 logs local-ai-api
```

Параметры автообновления в локальном `config.json`:

```json
{
  "autoUpdate": true,
  "updateIntervalSeconds": 60,
  "repositoryBranch": "main"
}
```

## Модели

В каталоге установщика представлены компактные, универсальные, reasoning-, coding- и vision-модели семейств Qwen, Qwen Coder, Llama, Gemma, DeepSeek, Phi, Granite, SmolLM, Mistral, Devstral, LLaVA, MiniCPM-V, GPT-OSS и Command R. Оценки RAM и размера ориентировочные: зависят от квантизации, контекста, числа параллельных запросов и backend. Большие модели рассчитаны на серверы с достаточным объёмом памяти и не подходят обычному VPS.

Полный каталог и точные теги: https://ollama.com/library

```bash
ollama pull qwen3:8b
ollama list
```

В панели можно скачивать и удалять модели. Базовую модель, выбранную при установке, панель не даст удалить.

## API

Base URL: `https://ВАШ-ДОМЕН/v1`.

Создайте API-ключ в панели. Запросы авторизуются заголовком `Authorization: Bearer КЛЮЧ`.

### Список установленных моделей

```bash
curl https://ВАШ-ДОМЕН/v1/models \
  -H "Authorization: Bearer lai_ВАШ_API_КЛЮЧ"
```

### Chat Completions

```bash
curl https://ВАШ-ДОМЕН/v1/chat/completions \
  -H "Authorization: Bearer lai_ВАШ_API_КЛЮЧ" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3:8b",
    "messages": [{"role": "user", "content": "Привет!"}]
  }'
```

Если поле `model` отсутствует, используется `defaultModel` из `config.json`. Endpoint принимает OpenAI-совместимый параметр `stream`; поток проксируется от Ollama без буферизации Nginx. Для stream-ответа расход выходных токенов оценивается по размеру потока, поэтому это приблизительная статистика.

### Маршруты

| Метод | Путь | Авторизация | Назначение |
|---|---|---|---|
| GET | `/` | Нет | Информация о сервисе |
| GET | `/v1` | Нет | Описание API |
| GET | `/health` | Нет | Проверка Ollama |
| GET | `/v1/models` | Bearer | Список моделей |
| POST | `/v1/chat/completions` | Bearer | Генерация |
| GET | `/docs` | Нет | Документация |
| GET | `/auth/` | Сессия | Панель администратора |

Не передавайте API-ключи в URL или query-параметрах.

## Cursor

1. Откройте Cursor Settings → Models.
2. Добавьте API-ключ и включите Use API Key.
3. Включите Base URL Override.
4. Укажите `https://ВАШ-ДОМЕН/v1`.
5. Добавьте точное имя модели из `GET /v1/models`.

Для Agent/tool calling выбирайте модель, которая поддерживает вызов инструментов. Это зависит от модели и шаблона Ollama.

## OpenCode

Выполните `/connect`, выберите Other, укажите provider ID `local-ii` и API-ключ. Затем добавьте `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "local-ii": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Local AI Server",
      "options": {"baseURL": "https://ВАШ-ДОМЕН/v1"},
      "models": {
        "qwen3:8b": {"name": "Qwen 3 8B"}
      }
    }
  },
  "model": "local-ii/qwen3:8b"
}
```

ID модели должен совпадать с ответом `GET /v1/models`.

## Управление

| Действие | Команда |
|---|---|
| PM2 | `pm2 status` |
| Логи API | `pm2 logs local-ai-api` |
| Логи updater | `pm2 logs local-ai-updater` |
| Перезапуск API | `pm2 restart local-ai-api` |
| Модели | `ollama list` |
| Скачать модель | `ollama pull qwen3:8b` |
| Удалить модель | `ollama rm имя-модели` |
| Проверить Nginx | `sudo nginx -t` |
| SSL-сертификаты | `sudo certbot certificates` |

## API-ключи и безопасность

Новые ключи хранятся в SQLite в двух формах: SHA-256-хэш используется для проверки запросов, а AES-256-GCM-зашифрованное значение позволяет администратору просматривать ключ повторно. Ключ шифрования выводится из `sessionSecret` в `config.json`. Не меняйте и не теряйте этот секрет без понимания последствий.

Старые ключи, созданные до добавления шифрования, представлены только хэшами — исходное значение восстановить невозможно. Создайте новые ключи и замените их в клиентах.

Не открывайте порт Ollama 11434 напрямую в интернет. Не коммитьте `config.json`, SQLite-базу, deploy key, пароли или API-ключи. Используйте лимиты, отключайте неиспользуемые ключи и храните резервные копии в защищённом месте.

## Структура

| Путь | Назначение |
|---|---|
| `src/server.js` | API и маршруты панели |
| `src/config.js` | Загрузка конфигурации |
| `src/db.js` | SQLite и миграции |
| `src/security.js` | Хэширование, шифрование, сессии |
| `src/ui.js` | Рендер HTML-шаблонов |
| `src/updater.js` | Автообновление |
| `views/` | HTML |
| `public/styles.css` | Стили |
| `install.sh` | Установка |
| `setup-github-access.sh` | Создание deploy key |
| `ecosystem.config.cjs` | Процессы PM2 |
| `config.json` | Настройки конкретного сервера |
| `data/local-ai.db` | База ключей и статистики |

## Резервное копирование

Сохраняйте `config.json`, `data/local-ai.db` и, если используете автообновление приватного репозитория, `/etc/local-ii/deploy_key`. Это секретные данные; не размещайте резервные копии публично.

## Диагностика

**Проверить процессы и журналы:**

```bash
pm2 status
pm2 logs local-ai-api --lines 100
pm2 logs local-ai-updater --lines 100
```

**Проверить Ollama:**

```bash
sudo systemctl status ollama
curl http://127.0.0.1:11434/api/tags
```

**Проверить локальный API:**

```bash
PORT=$(node -p "require('./config.json').port")
curl -i "http://127.0.0.1:$PORT/health"
```

**Если не выпускается SSL:** проверьте A-запись и входящие порты 80/443, затем запустите `sudo certbot --nginx -d ВАШ-ДОМЕН`.

**Если не работает автообновление:** проверьте `pm2 logs local-ai-updater`, наличие `/etc/local-ii/deploy_key` и то, что публичный ключ добавлен в Deploy keys именно репозитория `romanich237/local-ii`. Разрешение write access включать не нужно.
