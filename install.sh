#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Запустите установщик от root: sudo bash install.sh"
  exit 1
fi

if [[ ! -f /etc/os-release ]]; then echo "Не удалось определить Linux-дистрибутив"; exit 1; fi
source /etc/os-release
OS_NAME=${PRETTY_NAME:-${ID:-Linux}}

if ! command -v systemctl >/dev/null 2>&1; then
  echo "Нужен дистрибутив с systemd. Текущая система инициализации не поддерживается."
  exit 1
fi

if command -v apt-get >/dev/null 2>&1; then
  PACKAGE_MANAGER=apt
elif command -v dnf >/dev/null 2>&1; then
  PACKAGE_MANAGER=dnf
elif command -v yum >/dev/null 2>&1; then
  PACKAGE_MANAGER=yum
elif command -v pacman >/dev/null 2>&1; then
  PACKAGE_MANAGER=pacman
elif command -v zypper >/dev/null 2>&1; then
  PACKAGE_MANAGER=zypper
else
  echo "Не найден поддерживаемый пакетный менеджер: apt, dnf, yum, pacman или zypper."
  exit 1
fi

install_system_packages() {
  case "$PACKAGE_MANAGER" in
    apt)
      apt-get update
      DEBIAN_FRONTEND=noninteractive apt-get install -y curl git nginx ca-certificates xz-utils build-essential python3 python3-venv python3-pip
      ;;
    dnf)
      dnf install -y curl git nginx ca-certificates xz gcc gcc-c++ make python3 python3-pip
      ;;
    yum)
      yum install -y epel-release || true
      yum install -y curl git nginx ca-certificates xz gcc gcc-c++ make python3 python3-pip
      ;;
    pacman)
      pacman -Syu --noconfirm --needed curl git nginx ca-certificates xz base-devel python python-pip
      ;;
    zypper)
      zypper --non-interactive refresh
      zypper --non-interactive install curl git nginx ca-certificates xz gcc gcc-c++ make python3 python3-pip
      ;;
  esac
}

install_certbot() {
  if command -v certbot >/dev/null 2>&1; then return; fi

  case "$PACKAGE_MANAGER" in
    apt) DEBIAN_FRONTEND=noninteractive apt-get install -y certbot python3-certbot-nginx && return ;;
    dnf) dnf install -y certbot python3-certbot-nginx && return ;;
    yum) yum install -y certbot python3-certbot-nginx && return ;;
    pacman) pacman -S --noconfirm --needed certbot certbot-nginx && return ;;
    zypper) zypper --non-interactive install certbot python3-certbot-nginx && return ;;
  esac

  echo "Пакет Certbot не найден. Устанавливаю его в отдельное Python-окружение…"
  python3 -m venv /opt/local-ii-certbot
  /opt/local-ii-certbot/bin/pip install --upgrade pip certbot certbot-nginx
  ln -sfn /opt/local-ii-certbot/bin/certbot /usr/local/bin/certbot
}

install_node() {
  local current_major=0 architecture node_arch checksums filename version temp_dir
  if command -v node >/dev/null 2>&1; then
    current_major=$(node -p 'Number(process.versions.node.split(".")[0])' 2>/dev/null || echo 0)
  fi
  if (( current_major >= 24 )); then return; fi

  architecture=$(uname -m)
  case "$architecture" in
    x86_64|amd64) node_arch=x64 ;;
    aarch64|arm64) node_arch=arm64 ;;
    *) echo "Поддерживаются архитектуры x86_64 и ARM64. Текущая: ${architecture}"; exit 1 ;;
  esac

  echo "Устанавливаю Node.js 24 LTS…"
  checksums=$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt)
  filename=$(printf '%s\n' "$checksums" | awk -v arch="$node_arch" '$2 ~ ("linux-" arch "\\.tar\\.xz$") {print $2; exit}')
  if [[ -z "$filename" ]]; then echo "Не удалось определить архив Node.js"; exit 1; fi
  version=${filename#node-}
  version=${version%-linux-*}
  temp_dir=$(mktemp -d)
  curl -fsSL "https://nodejs.org/dist/${version}/${filename}" -o "${temp_dir}/${filename}"
  printf '%s\n' "$checksums" | grep "  ${filename}$" | (cd "$temp_dir" && sha256sum -c -)
  install -d /usr/local/lib/nodejs
  tar -xJf "${temp_dir}/${filename}" -C /usr/local/lib/nodejs
  for executable in node npm npx corepack; do
    ln -sfn "/usr/local/lib/nodejs/${filename%.tar.xz}/bin/${executable}" "/usr/local/bin/${executable}"
  done
  rm -rf "$temp_dir"
}

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_URL=$(git -C "$APP_DIR" remote get-url origin 2>/dev/null || true)
if [[ "$REMOTE_URL" =~ ^https://[^/]+@github\.com/ ]]; then
  git -C "$APP_DIR" remote set-url origin https://github.com/romanich237/local-ii.git
  REMOTE_URL=https://github.com/romanich237/local-ii.git
fi
if [[ "$REMOTE_URL" == https://github.com/* ]]; then
  bash "$APP_DIR/setup-github-access.sh" "$APP_DIR"
fi
RAM_GB=$(awk '/MemTotal/{printf "%d", ($2/1024/1024)+0.5}' /proc/meminfo)
CPU_CORES=$(nproc)
DISK_GB=$(df -BG "$APP_DIR" | awk 'NR==2{gsub("G","",$4); print $4}')
GPU_NAME="не обнаружена"
VRAM_GB=0
if command -v nvidia-smi >/dev/null 2>&1; then
  GPU_NAME=$(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)
  VRAM_MIB=$(nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits | head -1)
  VRAM_GB=$((VRAM_MIB / 1024))
fi

echo ""
echo "Local AI Server — установка"
echo "Система: ${OS_NAME} | Пакеты: ${PACKAGE_MANAGER}"
echo "CPU: ${CPU_CORES} ядер | RAM: ${RAM_GB} ГБ | Свободно: ${DISK_GB} ГБ"
echo "GPU: ${GPU_NAME} | VRAM: ${VRAM_GB} ГБ"
echo ""

echo ""
echo "1. Домен"
echo "Можно вставить домен или полный URL. Пример: https://ai.example.com/"
while true; do
  read -rp "Домен или URL: " RAW_DOMAIN
  DOMAIN=$(printf '%s' "$RAW_DOMAIN" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')
  DOMAIN=${DOMAIN#http://}
  DOMAIN=${DOMAIN#https://}
  DOMAIN=${DOMAIN%%/*}
  DOMAIN=${DOMAIN%%\?*}
  DOMAIN=${DOMAIN%%\#*}
  DOMAIN=${DOMAIN%.}
  if [[ "$DOMAIN" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$ ]]; then
    echo "Распознан домен: ${DOMAIN}"
    break
  fi
  echo "Ошибка: нужен адрес вида ai.example.com или https://ai.example.com/. Попробуйте ещё раз."
done
DUCKDNS_ENABLED=false
DUCKDNS_SUBDOMAIN=""
DUCKDNS_TOKEN=""
if [[ "$DOMAIN" =~ ^([a-zA-Z0-9-]+)\.duckdns\.org$ ]]; then
  DUCKDNS_ENABLED=true
  DUCKDNS_SUBDOMAIN="${BASH_REMATCH[1]}"
  echo "Обнаружен домен DuckDNS: ${DOMAIN}"
  while true; do
    read -rsp "Токен DuckDNS: " DUCKDNS_TOKEN; echo
    if [[ "$DUCKDNS_TOKEN" =~ ^[a-zA-Z0-9-]{20,80}$ ]]; then break; fi
    echo "Ошибка: скопируйте токен со страницы duckdns.org и повторите ввод."
  done
fi

echo ""
echo "2. Email для SSL-сертификата"
echo "Нажмите Enter, чтобы использовать 1234@gmail.com."
while true; do
  read -rp "Email [1234@gmail.com]: " SSL_EMAIL
  SSL_EMAIL=${SSL_EMAIL:-1234@gmail.com}
  SSL_EMAIL=$(printf '%s' "$SSL_EMAIL" | tr -d '[:space:]')
  if [[ "$SSL_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then break; fi
  echo "Ошибка: введите полный email, например admin@example.com."
done

echo ""
echo "3. Данные для входа в веб-панель"
echo "Логин должен содержать от 10 до 15 символов."
echo "Разрешены латинские буквы, цифры, _ и -. Пример: administrator"
while true; do
  read -rp "Логин панели: " ADMIN_USERNAME
  if [[ "$ADMIN_USERNAME" =~ ^[a-zA-Z0-9_-]{10,15}$ ]]; then break; fi
  echo "Ошибка: введено ${#ADMIN_USERNAME} символов. Нужно от 10 до 15, например administrator."
done

ADMIN_PASSWORD=$(od -An -N7 -tx1 /dev/urandom | tr -d ' \n')
echo "Пароль будет создан автоматически и показан после установки."

MODELS=(
  "smollm2:135m"
  "gemma3:270m"
  "qwen2.5:0.5b"
  "qwen3:0.6b"
  "tinyllama:1.1b"
  "gemma3:1b"
  "qwen2.5:1.5b"
  "deepseek-r1:1.5b"
  "llama3.2:1b"
  "qwen3.5:0.8b"
  "qwen3:1.7b"
  "granite3.3:2b"
  "gemma2:2b"
  "smollm2:1.7b"
  "llama3.2:3b"
  "qwen3:4b"
  "phi4-mini"
  "qwen3.5:2b"
  "gemma3:4b"
  "mistral:7b"
  "deepseek-r1:7b"
  "qwen2.5:7b"
  "qwen2.5-coder:7b"
  "llama3.1:8b"
  "gemma2:9b"
  "mistral-nemo:12b"
  "qwen3.5:9b"
  "qwen2.5:14b"
  "deepseek-r1:14b"
  "phi4"
  "gpt-oss:20b"
  "qwen3.5:27b"
  "qwen2.5:32b"
  "deepseek-r1:32b"
  "llama3.3:70b"
  "deepseek-r1:70b"
  "qwen2.5:72b"
  "gpt-oss:120b"
  "deepseek-r1:671b"
  "qwen2.5-coder:3b"
  "qwen2.5-coder:14b"
  "qwen2.5-coder:32b"
  "qwen3:8b"
  "qwen3:14b"
  "qwen3:30b-a3b"
  "qwen3:32b"
  "qwen3:235b-a22b"
  "gemma3:12b"
  "gemma3:27b"
  "llama3.2-vision:11b"
  "llava:7b"
  "minicpm-v:8b"
  "mistral-small3.1:24b"
  "devstral:24b"
  "deepseek-coder-v2:16b"
  "command-r:35b"
)
MODEL_RAM=(2 2 2 2 2 3 3 4 4 4 4 4 4 4 6 6 6 6 8 10 10 10 12 12 12 16 16 20 20 20 24 28 32 32 64 64 64 96 512 4 10 20 8 12 20 24 160 16 32 16 10 12 32 32 20 40)
MODEL_SIZE=("~0.3 ГБ" "~0.3 ГБ" "~0.4 ГБ" "~0.5 ГБ" "~0.6 ГБ" "~0.8 ГБ" "~1.0 ГБ" "~1.1 ГБ" "~1.3 ГБ" "~1.3 ГБ" "~1.4 ГБ" "~1.5 ГБ" "~1.6 ГБ" "~1.8 ГБ" "~2.0 ГБ" "~2.5 ГБ" "~2.5 ГБ" "~3.1 ГБ" "~3.3 ГБ" "~4.4 ГБ" "~4.7 ГБ" "~4.7 ГБ" "~4.7 ГБ" "~4.9 ГБ" "~5.4 ГБ" "~7.1 ГБ" "~7.6 ГБ" "~9.0 ГБ" "~9.0 ГБ" "~9.1 ГБ" "~13 ГБ" "~20 ГБ" "~20 ГБ" "~20 ГБ" "~43 ГБ" "~43 ГБ" "~47 ГБ" "~65 ГБ" "~404 ГБ" "~2.0 ГБ" "~9.0 ГБ" "~20 ГБ" "~5.0 ГБ" "~9.0 ГБ" "~18 ГБ" "~20 ГБ" "~140 ГБ" "~8.0 ГБ" "~17 ГБ" "~7.0 ГБ" "~5.0 ГБ" "~5.0 ГБ" "~14 ГБ" "~14 ГБ" "~9.0 ГБ" "~20 ГБ")
MODEL_INFO=(
  "Hugging Face, сверхлёгкая"
  "Google, сверхлёгкая"
  "Alibaba, компактная"
  "Alibaba, новая компактная"
  "Meta, сверхлёгкая"
  "Google, компактная"
  "Alibaba, универсальная"
  "DeepSeek, рассуждения"
  "Meta, компактная"
  "Alibaba, мультиязычная"
  "Alibaba, новая универсальная"
  "IBM, универсальная"
  "Google, универсальная"
  "Hugging Face, компактная"
  "Meta, универсальная"
  "Alibaba, новая универсальная"
  "Microsoft, инструкции"
  "Alibaba, мультиязычная"
  "Google, текст и изображения"
  "Mistral AI, универсальная"
  "DeepSeek, рассуждения"
  "Alibaba, универсальная"
  "Alibaba, программирование"
  "Meta, универсальная"
  "Google, универсальная"
  "Mistral AI, большой контекст"
  "Alibaba, мощная"
  "Alibaba, универсальная"
  "DeepSeek, рассуждения"
  "Microsoft, мощная"
  "OpenAI, рассуждения"
  "Alibaba, для мощных серверов"
  "Alibaba, мощная"
  "DeepSeek, рассуждения"
  "Meta, мощная"
  "DeepSeek, мощная"
  "Alibaba, мощная"
  "OpenAI, для GPU-сервера"
  "DeepSeek, полный размер"
  "Alibaba, программирование"
  "Alibaba, программирование"
  "Alibaba, программирование"
  "Alibaba, универсальная"
  "Alibaba, универсальная"
  "Alibaba, MoE"
  "Alibaba, универсальная"
  "Alibaba, MoE"
  "Google, универсальная"
  "Google, мультимодальная"
  "Meta, зрение и текст"
  "LLaVA, зрение и текст"
  "MiniCPM, зрение и текст"
  "Mistral AI, универсальная"
  "Mistral AI, программирование"
  "DeepSeek, программирование"
  "Cohere, RAG и инструменты"
)
RECOMMENDED=1
for i in "${!MODELS[@]}"; do
  if (( RAM_GB >= MODEL_RAM[i] )); then RECOMMENDED=$((i + 1)); fi
done

echo ""
echo "4. Основная нейросеть"
echo "Локальные генеративные модели отсортированы по размеру загрузки."
echo "Установщик уже отметил подходящие для сервера варианты."
for i in "${!MODELS[@]}"; do
  MARK="требуется ≥${MODEL_RAM[i]} ГБ RAM"
  if (( RAM_GB >= MODEL_RAM[i] )); then MARK="подходит"; fi
  if (( i + 1 == RECOMMENDED )); then MARK="${MARK}, рекомендуется"; fi
  printf "  %2d) %-21s %-9s %-31s %s\n" "$((i+1))" "${MODELS[i]}" "${MODEL_SIZE[i]}" "${MODEL_INFO[i]}" "$MARK"
done
echo "   0) Любая модель Ollama ввести точное название или тег вручную"
MODEL_COUNT=${#MODELS[@]}
while true; do
  read -rp "Введите номер модели [${RECOMMENDED}]: " MODEL_CHOICE
  MODEL_CHOICE=${MODEL_CHOICE:-$RECOMMENDED}
  if [[ "$MODEL_CHOICE" == "0" ]]; then
    echo "Каталог: https://ollama.com/library"
    echo "Пример названия: qwen2.5-coder:1.5b"
    read -rp "Название модели Ollama: " CUSTOM_MODEL
    if [[ ! "$CUSTOM_MODEL" =~ ^[a-zA-Z0-9._/-]+(:[a-zA-Z0-9._-]+)?$ ]]; then
      echo "Ошибка: некорректное название модели."
      continue
    fi
    MODEL=$CUSTOM_MODEL
    break
  fi
  if [[ ! "$MODEL_CHOICE" =~ ^[1-9][0-9]*$ ]] || (( MODEL_CHOICE < 1 || MODEL_CHOICE > MODEL_COUNT )); then
    echo "Ошибка: введите число от 0 до ${MODEL_COUNT}."
    continue
  fi
  if (( RAM_GB < MODEL_RAM[MODEL_CHOICE-1] )); then
    read -rp "Для этой модели мало RAM. Всё равно выбрать её? [y/N]: " FORCE_MODEL
    if [[ ${FORCE_MODEL,,} != "y" ]]; then
      echo "Выберите другую модель."
      continue
    fi
  fi
  MODEL=${MODELS[$((MODEL_CHOICE-1))]}
  break
done

if (( DISK_GB < 10 )); then echo "Нужно минимум 10 ГБ свободного места"; exit 1; fi

echo "Устанавливаю системные зависимости…"
install_system_packages
install_certbot

APP_PORT=$(python3 - <<'PY'
import random
import socket

ports = list(range(10000, 15001))
random.SystemRandom().shuffle(ports)
for port in ports:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            continue
        print(port)
        break
else:
    raise SystemExit("Не найден свободный порт в диапазоне 10000–15000")
PY
)
echo "Свободный внутренний порт для Nginx: ${APP_PORT}"

if [[ "$DUCKDNS_ENABLED" == true ]]; then
  echo "Настраиваю автоматическое обновление DuckDNS…"
  install -d -m 700 /etc/local-ii
  {
    printf "DUCKDNS_SUBDOMAIN='%s'\n" "$DUCKDNS_SUBDOMAIN"
    printf "DUCKDNS_TOKEN='%s'\n" "$DUCKDNS_TOKEN"
  } > /etc/local-ii/duckdns.env
  chmod 600 /etc/local-ii/duckdns.env

  cat > /usr/local/bin/local-ii-duckdns <<'DUCKDNS_SCRIPT'
#!/usr/bin/env bash
set -Eeuo pipefail
source /etc/local-ii/duckdns.env
RESULT=$(curl -fsS --max-time 20 "https://www.duckdns.org/update?domains=${DUCKDNS_SUBDOMAIN}&token=${DUCKDNS_TOKEN}&ip=")
if [[ "$RESULT" != "OK" ]]; then
  echo "DuckDNS вернул: $RESULT" >&2
  exit 1
fi
DUCKDNS_SCRIPT
  chmod 700 /usr/local/bin/local-ii-duckdns

  cat > /etc/systemd/system/local-ii-duckdns.service <<'DUCKDNS_SERVICE'
[Unit]
Description=Обновление IP-адреса Local II в DuckDNS
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/bin/local-ii-duckdns
DUCKDNS_SERVICE

  cat > /etc/systemd/system/local-ii-duckdns.timer <<'DUCKDNS_TIMER'
[Unit]
Description=Обновление DuckDNS каждые 5 минут

[Timer]
OnBootSec=30s
OnUnitActiveSec=5min
Persistent=true

[Install]
WantedBy=timers.target
DUCKDNS_TIMER

  if ! /usr/local/bin/local-ii-duckdns; then
    echo "Не удалось обновить DuckDNS. Проверьте поддомен и токен."
    exit 1
  fi
  systemctl daemon-reload
  systemctl enable --now local-ii-duckdns.timer
  unset DUCKDNS_TOKEN
  echo "DuckDNS обновлён, таймер запущен."
fi

install_node
export PATH="/usr/local/bin:${PATH}"
if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2
  hash -r
fi
if ! command -v pm2 >/dev/null 2>&1; then
  PM2_SOURCE="$(npm root -g)/pm2/bin/pm2"
  if [[ -f "$PM2_SOURCE" ]]; then
    ln -sfn "$PM2_SOURCE" /usr/local/bin/pm2
    chmod +x "$PM2_SOURCE"
    hash -r
  fi
fi
if ! command -v pm2 >/dev/null 2>&1; then
  echo "PM2 установлен, но исполняемый файл не найден."
  echo "Глобальная папка npm: $(npm root -g)"
  exit 1
fi
if ! command -v ollama >/dev/null 2>&1; then curl -fsSL https://ollama.com/install.sh | sh; fi
systemctl enable --now ollama

cd "$APP_DIR"
npm ci --omit=dev

ADMIN_PASSWORD="$ADMIN_PASSWORD" node - "$DOMAIN" "$MODEL" "$ADMIN_USERNAME" "$APP_PORT" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const { hashPassword } = require('./src/security');
const config = {
  port: Number(process.argv[5]),
  domain: process.argv[2],
  baseUrl: `https://${process.argv[2]}/v1`,
  ollamaUrl: 'http://127.0.0.1:11434',
  defaultModel: process.argv[3],
  adminUsername: process.argv[4],
  adminPasswordHash: hashPassword(process.env.ADMIN_PASSWORD),
  sessionSecret: crypto.randomBytes(48).toString('base64url'),
  trustProxy: true,
  autoUpdate: true,
  updateIntervalSeconds: 60,
  repositoryBranch: 'main'
};
fs.writeFileSync('config.json', JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
NODE

echo "Загружаю модель ${MODEL}…"
ollama pull "$MODEL"

NGINX_DUMP=$(nginx -T 2>&1)
if [[ -d /etc/nginx/sites-available && -d /etc/nginx/sites-enabled ]]; then
  NGINX_CONFIG="/etc/nginx/sites-available/local-ii.conf"
  NGINX_LINK="/etc/nginx/sites-enabled/local-ii.conf"
elif grep -qE 'include[[:space:]]+/etc/nginx/conf\.d/\*\.conf' <<< "$NGINX_DUMP"; then
  NGINX_CONFIG="/etc/nginx/conf.d/local-ii.conf"
  NGINX_LINK="$NGINX_CONFIG"
elif grep -qE 'include[[:space:]]+/etc/nginx/vhosts\.d/\*\.conf' <<< "$NGINX_DUMP"; then
  NGINX_CONFIG="/etc/nginx/vhosts.d/local-ii.conf"
  NGINX_LINK="$NGINX_CONFIG"
else
  install -d /etc/nginx/conf.d
  cp -n /etc/nginx/nginx.conf /etc/nginx/nginx.conf.before-local-ii
  sed -i '/^[[:space:]]*http[[:space:]]*{/a\    include /etc/nginx/conf.d/*.conf;' /etc/nginx/nginx.conf
  NGINX_CONFIG="/etc/nginx/conf.d/local-ii.conf"
  NGINX_LINK="$NGINX_CONFIG"
fi
rm -f /etc/nginx/sites-enabled/local-ai-server /etc/nginx/sites-available/local-ai-server 2>/dev/null || true
CONFLICT=$(grep -RIlF "server_name ${DOMAIN}" /etc/nginx --include='*.conf' --exclude='local-ii.conf' 2>/dev/null | head -1 || true)
if [[ -n "$CONFLICT" ]]; then
  echo "Домен уже используется другим конфигом Nginx: ${CONFLICT}"
  echo "Установка остановлена, чужой конфиг не изменён."
  exit 1
fi

cat > "$NGINX_CONFIG" <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    client_max_body_size 4m;
    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_read_timeout 1800s;
    }
}
NGINX
if [[ "$NGINX_LINK" != "$NGINX_CONFIG" ]]; then ln -sfn "$NGINX_CONFIG" "$NGINX_LINK"; fi
nginx -t
systemctl enable --now nginx
systemctl reload nginx

pm2 startOrReload ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root >/dev/null || true

if ! certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$SSL_EMAIL" --redirect; then
  echo ""
  echo "SSL пока не выпущен. Проверьте A-запись домена и доступность портов 80/443."
  echo "Исправьте A-запись и выполните: sudo certbot --nginx -d ${DOMAIN}"
fi

echo ""
echo "============================================================"
echo "Установка завершена"
echo "============================================================"
echo "Панель управления: https://${DOMAIN}/auth/"
echo "Логин панели:      ${ADMIN_USERNAME}"
echo "Пароль панели:     ${ADMIN_PASSWORD}"
echo "Документация:      https://${DOMAIN}/docs"
echo ""
echo "Подключение Cursor, OpenCode и других OpenAI-клиентов"
echo "Base URL:          https://${DOMAIN}/v1"
echo "Модель:            ${MODEL}"
echo "Список моделей:    https://${DOMAIN}/v1/models"
echo "Chat Completions:  https://${DOMAIN}/v1/chat/completions"
echo "API-ключ:          создайте в панели управления"
echo ""
echo "Внутренний порт приложения для Nginx: ${APP_PORT}"
echo "Nginx принимает внешние запросы на портах 80 и 443."
echo "Сохраните логин и пароль: пароль повторно не показывается."
if [[ "$DUCKDNS_ENABLED" == true ]]; then echo "DuckDNS: обновление IP каждые 5 минут"; fi
echo "Статус процессов: pm2 status"
echo "============================================================"
unset ADMIN_PASSWORD
