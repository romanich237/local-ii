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
read -rp "Email для Let's Encrypt: " SSL_EMAIL
if [[ ! "$SSL_EMAIL" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo "Некорректный email"; exit 1
fi
read -rsp "Пароль веб-панели (минимум 12 символов): " ADMIN_PASSWORD; echo
if (( ${#ADMIN_PASSWORD} < 12 )); then echo "Пароль слишком короткий"; exit 1; fi

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

if ! command -v node >/dev/null 2>&1 || [[ $(node -p 'Number(process.versions.node.split(".")[0])') -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
if ! command -v pm2 >/dev/null 2>&1; then npm install -g pm2; fi
if ! command -v ollama >/dev/null 2>&1; then curl -fsSL https://ollama.com/install.sh | sh; fi
systemctl enable --now ollama

cd "$APP_DIR"
npm ci --omit=dev

ADMIN_PASSWORD="$ADMIN_PASSWORD" node - "$DOMAIN" "$MODEL" <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const { hashPassword } = require('./src/security');
const config = {
  port: 1488,
  domain: process.argv[2],
  ollamaUrl: 'http://127.0.0.1:11434',
  defaultModel: process.argv[3],
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

cat > "/etc/nginx/sites-available/local-ai-server" <<NGINX
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
ln -sfn /etc/nginx/sites-available/local-ai-server /etc/nginx/sites-enabled/local-ai-server
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
echo "Статус: pm2 status"
