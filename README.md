# Local AI Server

Локальный OpenAI-совместимый API на базе Ollama. Проект устанавливает модель, запускает Node.js через PM2, настраивает отдельный конфиг Nginx, получает SSL-сертификат и создаёт веб-панель для API-ключей и статистики токенов.

## Возможности

- Локальные модели Ollama без передачи запросов сторонним сервисам
- OpenAI-совместимые маршруты `/v1/models` и `/v1/chat/completions`
- Выбор из 39 моделей, отсортированных по размеру
- Установка любой другой модели по точному тегу Ollama
- Панель управления API-ключами и месячными лимитами
- Статистика входных и выходных токенов
- Тёмная и светлая темы без клиентского JavaScript
- SQLite3-база `data.db`
- Автоматический свободный порт в диапазоне `10000–15000`
- Отдельный конфиг Nginx, не изменяющий другие проекты
- SSL через Let's Encrypt
- Поддержка DuckDNS
- Автообновление из GitHub раз в минуту

## Адреса

| Назначение | Адрес |
|---|---|
| Панель | `https://ваш-домен/auth/` |
| Документация | `https://ваш-домен/docs` |
| Base URL | `https://ваш-домен/v1` |
| Проверка состояния | `https://ваш-домен/health` |

## Требования

- Linux с systemd
- root или sudo
- Архитектура x86_64 или ARM64
- Не менее 2 ГБ RAM для самых компактных моделей
- Не менее 10 ГБ свободного места
- Открытые порты 80 и 443
- Домен, направленный на IPv4 сервера
- GitHub Token с доступом на чтение приватного репозитория

Поддерживаются Ubuntu, Debian, Linux Mint, Raspberry Pi OS, Fedora, RHEL, AlmaLinux, Rocky Linux, CentOS Stream, Oracle Linux, Amazon Linux, Arch Linux, Manjaro и openSUSE.

GPU необязателен. Без видеокарты генерация будет выполняться на CPU и займёт больше времени.

## Установка

Создайте Fine-grained Personal Access Token на GitHub:

1. Разрешите доступ к репозиторию `romanich237/local-ii`.
2. Для `Contents` выберите `Read-only`.
3. Сохраните токен: GitHub покажет его только один раз.

На сервере выполните:

```bash
cd /root
git clone https://github.com/romanich237/local-ii.git
cd /root/local-ii
sudo bash install.sh
```

При клонировании используйте:

```text
Username: ваш логин GitHub
Password: ваш GitHub Token
```

Установщик попросит указать домен, email, логин панели и модель. Домен можно вставить с `https://`, путём и завершающим слешем: лишние части будут удалены автоматически. Пароль панели создаётся автоматически.

После установки в терминале отображаются:

```text
Панель: https://ваш-домен/auth/
Логин панели: созданный логин
Пароль панели: созданный пароль
Внутренний порт: случайный порт от 10000 до 15000
API: https://ваш-домен/v1
```

Сохраните логин и пароль сразу. Пароль повторно не показывается.

## DuckDNS

Укажите домен вида:

```text
my-local-ai.duckdns.org
```

Установщик запросит токен DuckDNS и настроит обновление IP каждые пять минут.

Проверка:

```bash
systemctl status local-ii-duckdns.timer
sudo /usr/local/bin/local-ii-duckdns
```

## Использование API

Сначала создайте API-ключ в панели `/auth/`.

Получение списка моделей:

```bash
curl https://ваш-домен/v1/models \
  -H "Authorization: Bearer lai_ВАШ_КЛЮЧ"
```

Запрос к модели:

```bash
curl https://ваш-домен/v1/chat/completions \
  -H "Authorization: Bearer lai_ВАШ_КЛЮЧ" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "qwen3.5:0.8b",
    "messages": [
      {"role": "user", "content": "Привет!"}
    ]
  }'
```

Если поле `model` не указано, используется основная модель из `config.json`.

## База данных

Данные API-ключей и статистика хранятся в SQLite3-файле:

```text
/root/local-ii/data.db
```

Файл создаётся автоматически с правами `600` и не добавляется в Git. При первом запуске старая база `data/local-ai.db` автоматически переносится в `data.db`.

Резервная копия:

```bash
cd /root/local-ii
sqlite3 data.db ".backup 'data-backup.db'"
```

## Управление

| Действие | Команда |
|---|---|
| Статус | `pm2 status` |
| Логи API | `pm2 logs local-ai-api` |
| Логи обновления | `pm2 logs local-ai-updater` |
| Перезапуск API | `pm2 restart local-ai-api` |
| Установленные модели | `ollama list` |
| Загрузить модель | `ollama pull имя-модели` |
| Проверить Nginx | `sudo nginx -t` |

## Обновление

Доступ к GitHub сохраняется один раз в защищённом файле `/etc/local-ii/github-credentials`.

Если доступ ещё не настроен:

```bash
cd /root/local-ii
sudo bash setup-github-access.sh
```

Ручное обновление:

```bash
cd /root/local-ii
git pull --ff-only
npm ci --omit=dev
pm2 restart local-ai-api
```

## Структура

| Путь | Назначение |
|---|---|
| `src/` | API, база, безопасность и автообновление |
| `views/` | HTML-страницы панели и документации |
| `assets/` | Стили и изображения интерфейса |
| `data.db` | Локальная SQLite3-база |
| `config.json` | Локальная конфигурация |
| `install.sh` | Автоматическая установка |
| `ecosystem.config.cjs` | Процессы PM2 |

## Диагностика

```bash
cd /root/local-ii
pm2 status
sudo nginx -t
PORT=$(node -p "require('./config.json').port")
curl "http://127.0.0.1:${PORT}/health"
```

Если SSL не выпустился, проверьте DNS и повторите:

```bash
sudo certbot --nginx -d ваш-домен
```
