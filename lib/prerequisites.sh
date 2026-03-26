#!/usr/bin/env bash
# Check and report on required prerequisites

check_prerequisites() {
    local missing=()
    local pkg_mgr
    pkg_mgr=$(detect_package_manager)

    # git
    if ! command -v git &>/dev/null; then
        missing+=("git")
    else
        log_ok "git $(git --version | cut -d' ' -f3)"
    fi

    # curl
    if ! command -v curl &>/dev/null; then
        missing+=("curl")
    else
        log_ok "curl found"
    fi

    # Node.js 20+
    local node_ok=false
    if command -v node &>/dev/null; then
        local node_version
        node_version=$(node -v | sed 's/^v//' | cut -d. -f1)
        if [[ "$node_version" -ge 20 ]]; then
            log_ok "node $(node -v)"
            node_ok=true
        else
            log_warn "node $(node -v) found, but v20+ required"
            missing+=("node")
        fi
    else
        missing+=("node")
    fi

    # Detect bun (optional, auto-prefer)
    local runtime="node"
    if command -v bun &>/dev/null; then
        log_ok "bun $(bun --version) detected — will use for faster builds"
        runtime="bun"
    fi
    config_write "LLKA_RUNTIME" "$runtime"

    # Report missing
    if [[ ${#missing[@]} -gt 0 ]]; then
        echo ""
        log_err "Missing required tools: ${missing[*]}"
        echo ""
        echo "  Install them for your system:"
        echo ""
        for tool in "${missing[@]}"; do
            print_install_hint "$tool" "$pkg_mgr"
        done
        echo ""

        if gum_confirm "Retry after installing?"; then
            check_prerequisites
            return $?
        else
            log_err "Cannot continue without: ${missing[*]}"
            exit 1
        fi
    fi

    log_ok "All prerequisites met"
}

print_install_hint() {
    local tool="$1" pkg_mgr="$2"

    case "$tool" in
        git)
            case "$pkg_mgr" in
                apt)    echo "    sudo apt install git" ;;
                dnf)    echo "    sudo dnf install git" ;;
                brew)   echo "    brew install git" ;;
                pacman) echo "    sudo pacman -S git" ;;
                *)      echo "    Install git from https://git-scm.com" ;;
            esac
            ;;
        curl)
            case "$pkg_mgr" in
                apt)    echo "    sudo apt install curl" ;;
                dnf)    echo "    sudo dnf install curl" ;;
                brew)   echo "    brew install curl" ;;
                pacman) echo "    sudo pacman -S curl" ;;
                *)      echo "    Install curl from https://curl.se" ;;
            esac
            ;;
        node)
            echo "    Recommended: install via nvm (Node Version Manager)"
            echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash"
            echo "    nvm install 20"
            echo ""
            echo "    Or via package manager:"
            case "$pkg_mgr" in
                apt)    echo "    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs" ;;
                dnf)    echo "    sudo dnf module install nodejs:20" ;;
                brew)   echo "    brew install node@20" ;;
                pacman) echo "    sudo pacman -S nodejs npm" ;;
                *)      echo "    https://nodejs.org/en/download" ;;
            esac
            ;;
    esac
}
