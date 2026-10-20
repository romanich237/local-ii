#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Запустите от root: sudo bash setup-github-access.sh"
  exit 1
fi

APP_DIR=${1:-"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"}
CREDENTIAL_DIR=/etc/local-ii
CREDENTIAL_FILE=${CREDENTIAL_DIR}/github-credentials
REMOTE_URL=https://github.com/romanich237/local-ii.git

if [[ ! -d "$APP_DIR/.git" ]]; then
  echo "В каталоге ${APP_DIR} не найден Git-репозиторий."
  exit 1
fi

git -C "$APP_DIR" remote set-url origin "$REMOTE_URL"
install -d -m 700 "$CREDENTIAL_DIR"

if [[ -s "$CREDENTIAL_FILE" ]]; then
  chmod 600 "$CREDENTIAL_FILE"
  git -C "$APP_DIR" config --local credential.helper "store --file=${CREDENTIAL_FILE}"
  if GIT_TERMINAL_PROMPT=0 git -C "$APP_DIR" ls-remote origin HEAD >/dev/null 2>&1; then
    echo "Доступ к GitHub уже настроен. Повторный ввод не требуется."
    exit 0
  fi
fi

if GIT_TERMINAL_PROMPT=0 git -C "$APP_DIR" ls-remote origin HEAD >/dev/null 2>&1; then
  echo "Доступ к GitHub уже сохранён системным менеджером учётных данных."
  exit 0
fi

git -C "$APP_DIR" config --local credential.helper "store --file=${CREDENTIAL_FILE}"
echo "Введите GitHub Personal Access Token один раз. Он будет использоваться для git pull и автообновления."
read -rsp "GitHub Token: " GITHUB_TOKEN; echo
if [[ ! "$GITHUB_TOKEN" =~ ^[a-zA-Z0-9_]{20,255}$ ]]; then
  echo "Некорректный GitHub Token"
  exit 1
fi

umask 077
printf "https://romanich237:%s@github.com\n" "$GITHUB_TOKEN" > "$CREDENTIAL_FILE"
chmod 600 "$CREDENTIAL_FILE"
unset GITHUB_TOKEN

if ! GIT_TERMINAL_PROMPT=0 git -C "$APP_DIR" ls-remote origin HEAD >/dev/null 2>&1; then
  printf '' > "$CREDENTIAL_FILE"
  echo "Токен не подходит или не имеет доступа к romanich237/local-ii."
  exit 1
fi

echo "Готово. GitHub больше не будет запрашивать логин и токен при обновлении."
