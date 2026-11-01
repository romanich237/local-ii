#!/usr/bin/env bash
set -Eeuo pipefail

if [[ ${EUID} -ne 0 ]]; then
  echo "Запустите от root: sudo bash setup-github-access.sh"
  exit 1
fi

APP_DIR=${1:-"$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"}
REPO_SSH=git@github.com:romanich237/local-ii.git
SECURE_DIR=/etc/local-ii
PRIVATE_KEY=${SECURE_DIR}/deploy_key
KNOWN_HOSTS=${SECURE_DIR}/known_hosts

if [[ ! -d "${APP_DIR}/.git" ]]; then
  echo "В каталоге ${APP_DIR} не найден Git-репозиторий."
  exit 1
fi

if git -C "${APP_DIR}" -c credential.helper= ls-remote https://github.com/romanich237/local-ii.git HEAD >/dev/null 2>&1; then
  git -C "${APP_DIR}" remote set-url origin https://github.com/romanich237/local-ii.git
  git -C "${APP_DIR}" config --local --unset core.sshCommand 2>/dev/null || true
  git -C "${APP_DIR}" config --local --unset credential.helper 2>/dev/null || true
  echo "Репозиторий доступен публично. Deploy Key не требуется."
  exit 0
fi

install -d -m 700 "${SECURE_DIR}"
if [[ ! -s "${PRIVATE_KEY}" ]]; then
  ssh-keygen -q -t ed25519 -N "" -C "local-ii-deploy-$(hostname)" -f "${PRIVATE_KEY}"
fi
chmod 600 "${PRIVATE_KEY}"
chmod 644 "${PRIVATE_KEY}.pub"
ssh-keyscan -H github.com >> "${KNOWN_HOSTS}" 2>/dev/null
chmod 600 "${KNOWN_HOSTS}"

echo ""
echo "Публичный ключ для read-only доступа к romanich237/local-ii:"
echo "----------------------------------------------------------------"
cat "${PRIVATE_KEY}.pub"
echo "----------------------------------------------------------------"
echo ""
echo "Добавьте его в GitHub:"
echo "Repository → Settings → Deploy keys → Add deploy key"
echo "Title: local-ii server ($(hostname))"
echo "Allow write access: НЕ включать"
echo ""
read -rp "Нажмите Enter после добавления ключа в Deploy keys..." _
SSH_COMMAND="ssh -i ${PRIVATE_KEY} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=${KNOWN_HOSTS}"
if ! GIT_SSH_COMMAND="${SSH_COMMAND}" git ls-remote "${REPO_SSH}" HEAD >/dev/null; then
  echo "GitHub пока не принимает ключ. Проверьте, что он добавлен именно в romanich237/local-ii."
  exit 1
fi

git -C "${APP_DIR}" remote set-url origin "${REPO_SSH}"
git -C "${APP_DIR}" config --local core.sshCommand "${SSH_COMMAND}"
git -C "${APP_DIR}" config --local --unset credential.helper 2>/dev/null || true
echo "Готово: origin использует отдельный read-only deploy key."
echo "Проверка: git -C ${APP_DIR} ls-remote origin HEAD"
