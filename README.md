# Local AI Server

Local AI Server запускает локальную модель через Ollama и предоставляет OpenAI-совместимый API. В комплект входят PM2, Nginx, SSL, веб-панель для API-ключей, учёт токенов и автообновление из GitHub.

Проект работает на основных Linux-дистрибутивах с systemd. Интерфейс использует отдельные HTML и CSS файлы и работает без клиентского JavaScript.

## Адреса

| Раздел | Адрес |
|---|---|
| Панель | `https://ваш-домен/auth/` |
| Документация | `https://ваш-домен/docs` |
| Base URL | `https://ваш-домен/v1` |
| Состояние | `https://ваш-домен/health` |

## Что устанавливается

| Компонент | Назначение |
|---|---|
| Ollama | Запуск локальной модели |
| Node.js 24 LTS | API и веб-панель |
| PM2 | Запуск и восстановление процессов |
| Nginx | Прокси для домена |
| Certbot | Бесплатный SSL от Let's Encrypt |
| SQLite | Ключи и статистика |

Установщик определяет дистрибутив и пакетный менеджер, проверяет CPU, RAM, свободное место и NVIDIA VRAM. Затем показывает подходящие модели и предлагает выбрать основную. Конфигурация Nginx хранится в отдельном файле `local-ii.conf`, поэтому другие сайты не изменяются.

## Поддерживаемые системы

| Семейство | Дистрибутивы | Пакетный менеджер |
|---|---|---|
| Debian | Debian, Ubuntu, Linux Mint, Raspberry Pi OS и производные | APT |
| Red Hat | Fedora, RHEL, AlmaLinux, Rocky Linux, CentOS Stream, Oracle Linux, Amazon Linux | DNF или YUM |
| Arch | Arch Linux, Manjaro и производные | Pacman |
| SUSE | openSUSE Leap и Tumbleweed | Zypper |

Установщик также подходит для других дистрибутивов, если в них есть systemd и один из поддерживаемых пакетных менеджеров. Поддерживаются архитектуры x86_64 и ARM64. Alpine Linux, NixOS, Gentoo и системы без systemd требуют ручной установки.

## Требования

Linux с systemd, доступ root или sudo, минимум 4 ГБ RAM, 10 ГБ свободного места и открытые порты 80 и 443. Также нужен домен и GitHub Personal Access Token с правом `Contents: Read-only` для приватного репозитория `romanich237/local-ii`.

GPU не обязателен. Без видеокарты модель будет работать на CPU медленнее.

## Домен

Создайте A-запись домена на IPv4 сервера. Перед выпуском SSL домен должен открываться с этого сервера.

```bash
nslookup ai.example.com
```

### DuckDNS

Создайте поддомен на [duckdns.org](https://www.duckdns.org/) и скопируйте токен. Во время установки укажите полный адрес, например:

```text
my-local-ai.duckdns.org
```

Установщик распознает DuckDNS, запросит токен, обновит IP и создаст таймер на каждые 5 минут. Токен хранится только на сервере в `/etc/local-ii/duckdns.env` с правами `600`.

Проверка таймера:

```bash
systemctl status local-ii-duckdns.timer
```

Ручное обновление IP:

```bash
sudo /usr/local/bin/local-ii-duckdns
```

## Установка

Создайте Fine-grained Personal Access Token на GitHub. Выберите репозиторий `romanich237/local-ii` и разрешение `Contents: Read-only`.

На сервере выполните:

```bash
cd /root
git clone https://github.com/romanich237/local-ii.git
cd local-ii
sudo bash install.sh
```

При клонировании GitHub запросит данные:

```text
Username: romanich237
Password: ваш GitHub Token
```

Установщик запросит GitHub Token для автообновления, домен, email для SSL, логин и пароль панели длиной 10–15 символов, а затем основную модель. Для DuckDNS дополнительно потребуется токен DuckDNS.

После завершения откройте `https://ваш-домен/auth/` и войдите с созданными данными.

## API-ключ

В панели укажите название ключа и месячный лимит токенов. Значение `0` отключает лимит. Полный ключ отображается один раз, а в базе хранится только его SHA-256-хэш.

## Использование API

Base URL:

```text
https://ваш-домен/v1
```

Список моделей:

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
    "model": "qwen3.5:4b",
    "messages": [
      {"role": "user", "content": "Привет!"}
    ]
  }'
```

Поле `model` можно не передавать. Тогда сервер использует модель из `config.json`.

## Управление

| Действие | Команда |
|---|---|
| Статус процессов | `pm2 status` |
| Логи API | `pm2 logs local-ai-api` |
| Логи обновления | `pm2 logs local-ai-updater` |
| Перезапуск | `pm2 restart local-ai-api` |
| Список моделей | `ollama list` |
| Загрузка модели | `ollama pull имя-модели` |
| Проверка Nginx | `sudo nginx -t` |

## Автообновление

Процесс `local-ai-updater` проверяет ветку GitHub раз в минуту. При появлении новой версии он выполняет fast-forward обновление, устанавливает зависимости и перезапускает API. GitHub Token хранится в `/etc/local-ii/github-credentials` с правами `600`.

Ручное обновление:

```bash
cd /root/local-ii
git pull --ff-only
npm ci --omit=dev
pm2 restart local-ai-api
```

## Файлы проекта

| Путь | Содержимое |
|---|---|
| `src/server.js` | API и маршруты панели |
| `src/ui.js` | Подстановка данных в HTML |
| `views/` | Отдельные HTML-страницы |
| `public/styles.css` | Тёмная и светлая темы |
| `src/updater.js` | Автообновление |
| `install.sh` | Установка сервера |
| `config.json` | Локальная конфигурация, не попадает в Git |
| `data/` | База SQLite, не попадает в Git |

## Если сервер не открывается

Проверьте процессы, Nginx и состояние API:

```bash
pm2 status
sudo nginx -t
curl http://127.0.0.1:1488/health
```

Если SSL не выпущен, убедитесь, что DNS указывает на сервер и порты 80 и 443 открыты. Затем повторите:

```bash
sudo certbot --nginx -d ваш-домен
```
