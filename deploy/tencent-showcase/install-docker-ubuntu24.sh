#!/usr/bin/env bash
# Mutating host setup, unlike preflight.sh. Run only for an approved install.
# Existing working Docker is checked without upgrading or reinstalling it.
set -Eeuo pipefail
trap 'printf "ECHOCLASS_DOCKER_SETUP_FAILED line=%s\n" "$LINENO"' ERR
keytmp=""
repo=""
cleanup() {
  if test -n "$keytmp"; then rm -f -- "$keytmp"; fi
  if test -n "$repo"; then rm -f -- "$repo"; fi
}
trap cleanup EXIT
test "$(uname -m)" = x86_64
. /etc/os-release
test "$ID" = ubuntu
test "$VERSION_CODENAME" = noble
sudo -n true
if command -v docker >/dev/null 2>&1; then
  sudo -n docker --host unix:///var/run/docker.sock version --format '{{.Server.Version}}'
  sudo -n docker compose version
  printf 'ECHOCLASS_DOCKER_EXISTING_OK\n'
  exit 0
fi
conflicts="$(dpkg-query -W -f='${binary:Package} ${db:Status-Status}\n' docker.io docker-compose docker-compose-v2 docker-doc docker-buildx podman-docker containerd runc 2>/dev/null || true)"
if printf '%s\n' "$conflicts" | awk '$2=="installed" {found=1} END {exit !found}'; then
  printf 'Existing container runtime packages need review; no packages removed.\n'
  exit 1
fi
keytmp="$(mktemp)"
curl --proto '=https' --proto-redir '=https' --fail --silent --show-error --location --connect-timeout 15 --max-time 90 https://download.docker.com/linux/ubuntu/gpg -o "$keytmp"
if test -e /etc/apt/keyrings/docker.asc || test -L /etc/apt/keyrings/docker.asc; then
  cmp -s "$keytmp" /etc/apt/keyrings/docker.asc || { printf 'Existing Docker key requires review; not overwritten.\n'; exit 1; }
fi
repo="$(mktemp)"
cat > "$repo" <<'APT'
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Architectures: amd64
Signed-By: /etc/apt/keyrings/docker.asc
APT
if test -e /etc/apt/sources.list.d/docker.sources; then
  cmp -s "$repo" /etc/apt/sources.list.d/docker.sources || { printf 'Existing Docker repository requires review.\n'; exit 1; }
fi
# Refuse duplicate or custom source definitions instead of editing them.
for existing_source in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
  test "$existing_source" = /etc/apt/sources.list.d/docker.sources && continue
  if test -f "$existing_source" && grep -Eq 'https?://download[.]docker[.]com/linux/ubuntu' "$existing_source"; then
    printf 'Another Docker apt source requires review; no source files changed.\n'
    exit 1
  fi
done
sudo -n install -m 0755 -d /etc/apt/keyrings
if ! test -e /etc/apt/keyrings/docker.asc; then
  sudo -n install -m 0644 "$keytmp" /etc/apt/keyrings/docker.asc
fi
if ! test -e /etc/apt/sources.list.d/docker.sources; then
  sudo -n install -m 0644 "$repo" /etc/apt/sources.list.d/docker.sources
fi
sudo apt-get -o DPkg::Lock::Timeout=120 update
sudo env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get -o DPkg::Lock::Timeout=120 install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker version --format '{{.Server.Version}}'
sudo docker compose version
printf 'ECHOCLASS_DOCKER_SETUP_PASS\n'
