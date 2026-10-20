#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Запустите установщик от root: sudo bash install.sh"
  exit 1
fi

if [[ ! -f /etc/os-release ]]; then echo "Не удалось определить ОС"; exit 1; fi
source /etc/os-release
if [[ ${ID:-} != "ubuntu" || ${VERSION_ID:-} != "22.04" ]]; then
  echo "Поддерживается Ubuntu 22.04. Текущая ОС: ${PRETTY_NAME:-неизвестна}"
  exit 1
fi

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REMOTE_URL=$(git -C "$APP_DIR" remote get-url origin 2>/dev/null || true)
if [[ "$REMOTE_URL" =~ ^https://[^/]+@github\.com/ ]]; then
  git -C "$APP_DIR" remote set-url origin https://github.com/romanich237/local-ii.git
  REMOTE_URL=https://github.com/romanich237/local-ii.git
fi
if [[ "$REMOTE_URL" == https://github.com/* ]]; then
  if ! GIT_TERMINAL_PROMPT=0 git -C "$APP_DIR" ls-remote origin HEAD >/dev/null 2>&1; then
    echo "Для автообновления приватного репозитория нужен GitHub Personal Access Token."
    read -rsp "GitHub Token: " GITHUB_TOKEN; echo
    if [[ ! "$GITHUB_TOKEN" =~ ^[a-zA-Z0-9_]{20,255}$ ]]; then
      echo "Некорректный GitHub Token"; exit 1
    fi
    install -d -m 700 /etc/local-ii
    printf "https://romanich237:%s@github.com\n" "$GITHUB_TOKEN" > /etc/local-ii/github-credentials
    chmod 600 /etc/local-ii/github-credentials
    git -C "$APP_DIR" config --local credential.helper "store --file=/etc/local-ii/github-credentials"
    unset GITHUB_TOKEN
    if ! GIT_TERMINAL_PROMPT=0 git -C "$APP_DIR" ls-remote origin HEAD >/dev/null 2>&1; then
      echo "GitHub Token не подходит или не имеет доступа к romanich237/local-ii."
      exit 1
    fi
    echo "Доступ к GitHub для автообновления настроен."
  fi
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
echo "CPU: ${CPU_CORES} ядер | RAM: ${RAM_GB} ГБ | Свободно: ${DISK_GB} ГБ"
echo "GPU: ${GPU_NAME} | VRAM: ${VRAM_GB} ГБ"
echo ""

read -rp "Домен без https:// (например ai.example.com): " DOMAIN
if [[ ! "$DOMAIN" =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$ ]]; then
  echo "Некорректный домен"; exit 1
fi
DUCKDNS_ENABLED=false
DUCKDNS_SUBDOMAIN=""
DUCKDNS_TOKEN=""
if [[ "$DOMAIN" =~ ^([a-zA-Z0-9-]+)\.duckdns\.org$ ]]; then
  DUCKDNS_ENABLED=true
  DUCKDNS_SUBDOMAIN="${BASH_REMATCH[1]}"
  echo "Обнаружен домен DuckDNS: ${DOMAIN}"
  read -rsp "Токен DuckDNS: " DUCKDNS_TOKEN; echo
  if [[ ! "$DUCKDNS_TOKEN" =~ ^[a-zA-Z0-9-]{20,80}$ ]]; then
    echo "Некорректный токен DuckDNS"; exit 1
  fi
fi
read -rp "Email для Let's Encrypt: " SSL_EMAIL
if [[ ! "$SSL_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo "Некорректный email"; exit 1
fi
read -rp "Логин веб-панели (10–15 символов, латиница/цифры/_/-): " ADMIN_USERNAME
if [[ ! "$ADMIN_USERNAME" =~ ^[a-zA-Z0-9_-]{10,15}$ ]]; then
  echo "Логин должен содержать 10–15 символов: латинские буквы, цифры, _ или -"; exit 1
fi
read -rsp "Пароль веб-панели (10–15 символов): " ADMIN_PASSWORD; echo
if (( ${#ADMIN_PASSWORD} < 10 || ${#ADMIN_PASSWORD} > 15 )); then
  echo "Пароль должен содержать от 10 до 15 символов"; exit 1
fi

MODELS=("qwen3.5:0.8b" "qwen3.5:2b" "qwen3.5:4b" "qwen3.5:9b" "qwen3.5:27b" "qwen3.5:35b")
MODEL_RAM=(4 6 8 12 28 32)
MODEL_SIZE=("~1.3 ГБ" "~3.1 ГБ" "~4.0 ГБ" "~7.6 ГБ" "~20 ГБ" "~22 ГБ")
RECOMMENDED=1
for i in "${!MODELS[@]}"; do
  if (( RAM_GB >= MODEL_RAM[i] )); then RECOMMENDED=$((i + 1)); fi
done

echo ""
echo "Подходящие базовые модели:"
for i in "${!MODELS[@]}"; do
  MARK="требуется ≥${MODEL_RAM[i]} ГБ RAM"
  if (( RAM_GB >= MODEL_RAM[i] )); then MARK="подходит"; fi
  if (( i + 1 == RECOMMENDED )); then MARK="${MARK}, рекомендуется"; fi
  printf "  %d) %-16s %-10s %s\n" "$((i+1))" "${MODELS[i]}" "${MODEL_SIZE[i]}" "$MARK"
done
read -rp "Выберите модель [${RECOMMENDED}]: " MODEL_CHOICE
MODEL_CHOICE=${MODEL_CHOICE:-$RECOMMENDED}
if [[ ! "$MODEL_CHOICE" =~ ^[1-6]$ ]]; then echo "Некорректный выбор"; exit 1; fi
MODEL=${MODELS[$((MODEL_CHOICE-1))]}
if (( RAM_GB < MODEL_RAM[MODEL_CHOICE-1] )); then
  read -rp "Модель может не поместиться в память. Продолжить? [y/N]: " FORCE_MODEL
  [[ ${FORCE_MODEL,,} == "y" ]] || exit 1
fi

if (( DISK_GB < 10 )); then echo "Нужно минимум 10 ГБ свободного места"; exit 1; fi

echo "Устанавливаю системные зависимости…"
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y curl git nginx certbot python3-certbot-nginx ca-certificates gnupg build-essential

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

if ! command -v node >/dev/null 2>&1 || [[ $(node -p 'Number(process.versions.node.split(".")[0])') -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
if ! command -v pm2 >/dev/null 2>&1; then npm install -g pm2; fi
if ! command -v ollama >/dev/null 2>&1; then curl -fsSL https://ollama.com/install.sh | sh; fi
systemctl enable --now ollama

cd "$APP_DIR"
npm ci --omit=dev

ADMIN_PASSWORD="$ADMIN_PASSWORD" node - "$DOMAIN" "$MODEL" "$ADMIN_USERNAME" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const { hashPassword } = require('./src/security');
const config = {
  port: 1488,
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
unset ADMIN_PASSWORD

echo "Загружаю модель ${MODEL}…"
ollama pull "$MODEL"

NGINX_CONFIG="/etc/nginx/sites-available/local-ii.conf"
NGINX_LINK="/etc/nginx/sites-enabled/local-ii.conf"
rm -f /etc/nginx/sites-enabled/local-ai-server /etc/nginx/sites-available/local-ai-server
CONFLICT=$(grep -RIlF "server_name ${DOMAIN}" /etc/nginx/sites-enabled --exclude='local-ii.conf' 2>/dev/null | head -1 || true)
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
        proxy_pass http://127.0.0.1:1488;
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
ln -sfn "$NGINX_CONFIG" "$NGINX_LINK"
nginx -t
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
echo "Готово."
echo "Панель: https://${DOMAIN}/auth/"
echo "API: https://${DOMAIN}/v1/chat/completions"
echo "Модель: ${MODEL}"
if [[ "$DUCKDNS_ENABLED" == true ]]; then echo "DuckDNS: обновление IP каждые 5 минут"; fi
echo "Статус: pm2 status"
