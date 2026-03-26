#!/usr/bin/env bash
# llka-deploy bootstrap — the curl | bash target
# Usage: curl -fsSL https://leihlokal.de/install | bash
set -euo pipefail

INSTALL_DIR="$HOME/.leihlokal"
DEPLOY_REPO="https://github.com/leih-lokal/llka-deploy.git"
DEPLOY_DIR="$INSTALL_DIR/llka-deploy"
GUM_VERSION="0.17.0"

echo ""
echo "  ╔══════════════════════════════════════╗"
echo "  ║       leih.lokal — LLKA-D Setup      ║"
echo "  ╚══════════════════════════════════════╝"
echo ""

# --- Detect platform ---
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
    Linux)  GUM_OS="Linux" ;;
    Darwin) GUM_OS="Darwin"
            echo "  ⚠ macOS detected. This works for testing but is not"
            echo "    recommended for production. Systemd service registration"
            echo "    is not available on macOS."
            echo ""
            ;;
    *)      echo "  ✗ Unsupported OS: $OS. Use Linux or macOS (or WSL on Windows)."
            exit 1 ;;
esac

case "$ARCH" in
    x86_64|amd64)  GUM_ARCH="x86_64" ;;
    aarch64|arm64) GUM_ARCH="arm64" ;;
    *)             echo "  ✗ Unsupported architecture: $ARCH"; exit 1 ;;
esac

# --- Check for git + curl ---
for cmd in git curl; do
    if ! command -v "$cmd" &>/dev/null; then
        echo "  ✗ Required tool '$cmd' not found. Please install it first."
        exit 1
    fi
done

# --- Download gum ---
GUM_TMP="$(mktemp -d)"
GUM_TARBALL="gum_${GUM_VERSION}_${GUM_OS}_${GUM_ARCH}.tar.gz"
GUM_URL="https://github.com/charmbracelet/gum/releases/download/v${GUM_VERSION}/${GUM_TARBALL}"

echo "  Downloading gum ${GUM_VERSION}..."
if ! curl -fsSL "$GUM_URL" -o "$GUM_TMP/$GUM_TARBALL"; then
    echo "  ✗ Failed to download gum. Continuing without TUI."
    echo "    (You'll get basic text prompts instead)"
    GUM_BIN=""
else
    tar -xzf "$GUM_TMP/$GUM_TARBALL" -C "$GUM_TMP"
    GUM_BIN="$(find "$GUM_TMP" -name gum -type f | head -1)"
    chmod +x "$GUM_BIN"
fi

# --- Clone or update llka-deploy repo ---
mkdir -p "$INSTALL_DIR"

if [[ -d "$DEPLOY_DIR/.git" ]]; then
    echo "  Updating llka-deploy..."
    git -C "$DEPLOY_DIR" pull --quiet
else
    echo "  Cloning llka-deploy..."
    git clone --quiet "$DEPLOY_REPO" "$DEPLOY_DIR"
fi

# --- Hand off to setup.sh ---
echo ""
export GUM="${GUM_BIN:-gum}"
export LLKA_INSTALL_DIR="$INSTALL_DIR"
export LLKA_OS="$(echo "$OS" | tr '[:upper:]' '[:lower:]')"
export LLKA_ARCH="$ARCH"
exec bash "$DEPLOY_DIR/setup.sh"
