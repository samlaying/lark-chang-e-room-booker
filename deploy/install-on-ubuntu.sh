#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/samlaying/lark-chang-e-room-booker.git}"
INSTALL_DIR="${INSTALL_DIR:-/opt/lark-chang-e-room-booker}"
ENV_FILE="${ENV_FILE:-/etc/lark-chang-e-room-booker.env}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Please run as root: sudo bash deploy/install-on-ubuntu.sh"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl git gnupg

if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! command -v lark-cli >/dev/null 2>&1; then
  npm install -g @larksuite/cli@1.0.35
fi

if [[ -d "${INSTALL_DIR}/.git" ]]; then
  git -C "${INSTALL_DIR}" pull --ff-only
else
  rm -rf "${INSTALL_DIR}"
  git clone "${REPO_URL}" "${INSTALL_DIR}"
fi

if [[ ! -f "${ENV_FILE}" ]]; then
  cp "${INSTALL_DIR}/deploy/server.env.example" "${ENV_FILE}"
  chmod 600 "${ENV_FILE}"
  echo "Created ${ENV_FILE}. Edit it before enabling production run."
fi

install -m 644 "${INSTALL_DIR}/deploy/systemd/lark-room-booker.service" /etc/systemd/system/lark-room-booker.service
install -m 644 "${INSTALL_DIR}/deploy/systemd/lark-room-booker.timer" /etc/systemd/system/lark-room-booker.timer

systemctl daemon-reload
systemctl enable --now lark-room-booker.timer

echo
echo "Install complete."
echo "Next:"
echo "1) lark-cli config init --name '猎聘' (if profile not exists)"
echo "2) lark-cli --profile '猎聘' auth login --scope 'calendar:calendar.event:create calendar:calendar.event:update calendar:calendar.event:read calendar:calendar.free_busy:read'"
echo "3) lark-cli --profile '猎聘' auth status --verify"
echo "4) systemctl start lark-room-booker.service"
echo "5) journalctl -u lark-room-booker.service -n 100 --no-pager"
