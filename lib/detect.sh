#!/usr/bin/env bash
# Platform detection and existing install check

detect_os() {
    local os
    os="$(uname -s)"
    case "$os" in
        Linux)  echo "linux" ;;
        Darwin) echo "darwin" ;;
        *)
            log_err "Unsupported operating system: $os"
            log_err "llka-deploy supports Linux and macOS only."
            log_err "For Windows, please use WSL: https://learn.microsoft.com/windows/wsl/install"
            exit 1
            ;;
    esac
}

detect_arch() {
    local arch
    arch="$(uname -m)"
    case "$arch" in
        x86_64|amd64)   echo "amd64" ;;
        aarch64|arm64)  echo "arm64" ;;
        *)
            log_err "Unsupported architecture: $arch"
            exit 1
            ;;
    esac
}

# Map to gum's naming convention: Linux_x86_64, Darwin_arm64, etc.
gum_platform() {
    local os="$1" arch="$2"
    local gum_os gum_arch
    case "$os" in
        linux)  gum_os="Linux" ;;
        darwin) gum_os="Darwin" ;;
    esac
    case "$arch" in
        amd64) gum_arch="x86_64" ;;
        arm64) gum_arch="arm64" ;;
    esac
    echo "${gum_os}_${gum_arch}"
}

# Map to PocketBase naming: linux_amd64, darwin_arm64, etc.
pocketbase_platform() {
    local os="$1" arch="$2"
    echo "${os}_${arch}"
}

# Map to Caddy naming: linux_amd64, darwin_arm64, etc. (same as PB)
caddy_platform() {
    pocketbase_platform "$1" "$2"
}

detect_runtime() {
    if command -v bun &>/dev/null; then
        echo "bun"
    elif command -v node &>/dev/null; then
        echo "node"
    else
        echo "none"
    fi
}

detect_package_manager() {
    if command -v apt-get &>/dev/null; then
        echo "apt"
    elif command -v dnf &>/dev/null; then
        echo "dnf"
    elif command -v brew &>/dev/null; then
        echo "brew"
    elif command -v pacman &>/dev/null; then
        echo "pacman"
    else
        echo "unknown"
    fi
}

has_existing_install() {
    [[ -f "$CONFIG_FILE" ]]
}

is_macos() {
    [[ "$(detect_os)" == "darwin" ]]
}

is_linux() {
    [[ "$(detect_os)" == "linux" ]]
}
