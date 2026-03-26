# llka-deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `curl | bash` installer that deploys the full leih.lokal stack (PocketBase + admin UI + optional reservation frontend) on a Linux server with a nice TUI.

**Architecture:** Two-stage entry — a thin `install.sh` bootstrap downloads gum and clones the repo, then hands off to `setup.sh` which orchestrates modular scripts from `lib/`. Everything installs to `~/.leihlokal/`. Re-running the installer detects existing installations and offers update mode.

**Tech Stack:** Bash, [gum](https://github.com/charmbracelet/gum) (TUI), PocketBase, Node.js/Bun, Caddy (optional), systemd (Linux)

---

## File Map

| File | Responsibility |
|------|---------------|
| `install.sh` | Bootstrap curl target (~60 lines): detect platform, download gum, clone repo, exec setup.sh |
| `setup.sh` | Main orchestrator: welcome, detect existing install, run phases in order |
| `lib/common.sh` | Shared utilities: logging, gum wrappers, retry helper, config read/write |
| `lib/detect.sh` | OS/arch detection, existing install check, runtime detection (node/bun) |
| `lib/prerequisites.sh` | Check git/curl/node, print install instructions per platform |
| `lib/pocketbase.sh` | Download + extract PocketBase binary for platform |
| `lib/apps.sh` | Clone repos, install deps, build Next.js apps |
| `lib/admin.sh` | Start PB, create superuser, create settings collection, seed config |
| `lib/networking.sh` | Caddy download + config / Cloudflare Tunnel / manual instructions |
| `lib/services.sh` | Generate + install systemd user units, enable-linger |
| `templates/Caddyfile.tmpl` | Caddy reverse proxy template |
| `templates/leihbackend.service.tmpl` | systemd unit for PocketBase |
| `templates/llka-verwaltung.service.tmpl` | systemd unit for admin UI |
| `templates/llka-resomaker.service.tmpl` | systemd unit for reservation frontend |
| `templates/cloudflared.service.tmpl` | systemd unit for Cloudflare Tunnel |
| `templates/caddy.service.tmpl` | systemd unit for Caddy |
| `README.md` | Usage docs |

---

### Task 1: Shared Utilities (`lib/common.sh`)

**Files:**
- Create: `~/GitRepos/llka-deploy/lib/common.sh`

Foundation that all other scripts source. Provides logging, gum wrappers, config file management, and a retry helper.

- [ ] **Step 1: Create `lib/common.sh`**

```bash
#!/usr/bin/env bash
# Shared utilities for llka-deploy
# Source this file: source "$(dirname "$0")/lib/common.sh"

set -euo pipefail

# --- Paths ---
INSTALL_DIR="${LLKA_INSTALL_DIR:-$HOME/.leihlokal}"
CONFIG_FILE="$INSTALL_DIR/config.env"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATES_DIR="$SCRIPT_DIR/templates"

# Gum binary — set by install.sh or found in PATH
GUM="${GUM:-gum}"

# --- Logging ---
log_info() { echo "  [info] $*"; }
log_ok()   { echo "  ✓ $*"; }
log_warn() { echo "  ⚠ $*" >&2; }
log_err()  { echo "  ✗ $*" >&2; }

# --- Gum Wrappers ---
# All wrappers fall back to basic bash if gum is not available.

gum_style() {
    if command -v "$GUM" &>/dev/null; then
        "$GUM" style "$@"
    else
        # fallback: just print the text argument (last arg)
        echo "${@: -1}"
    fi
}

gum_confirm() {
    if command -v "$GUM" &>/dev/null; then
        "$GUM" confirm "$@"
    else
        read -rp "$1 [y/N] " yn
        [[ "$yn" =~ ^[Yy] ]]
    fi
}

gum_input() {
    if command -v "$GUM" &>/dev/null; then
        "$GUM" input "$@"
    else
        local prompt="" default=""
        # parse --header and --value from args
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --header) prompt="$2"; shift 2 ;;
                --header=*) prompt="${1#*=}"; shift ;;
                --value) default="$2"; shift 2 ;;
                --value=*) default="${1#*=}"; shift ;;
                --password) shift ;; # can't mask in basic read
                *) shift ;;
            esac
        done
        read -rp "$prompt [$default]: " val
        echo "${val:-$default}"
    fi
}

gum_choose() {
    if command -v "$GUM" &>/dev/null; then
        "$GUM" choose "$@"
    else
        # fallback: numbered menu
        local items=()
        while [[ $# -gt 0 ]]; do
            case "$1" in
                --header) shift 2 ;;
                --header=*) shift ;;
                *) items+=("$1"); shift ;;
            esac
        done
        local i=1
        for item in "${items[@]}"; do
            echo "  $i) $item" >&2
            ((i++))
        done
        read -rp "  Choice: " choice
        echo "${items[$((choice-1))]}"
    fi
}

gum_spin() {
    # Usage: gum_spin "message" command args...
    local msg="$1"; shift
    if command -v "$GUM" &>/dev/null; then
        "$GUM" spin --spinner dot --title "$msg" -- "$@"
    else
        echo "  $msg ..."
        "$@"
    fi
}

# --- Config Management ---
config_write() {
    # Write a key=value to config.env, overwriting if key exists
    local key="$1" value="$2"
    mkdir -p "$(dirname "$CONFIG_FILE")"
    if [[ -f "$CONFIG_FILE" ]] && grep -q "^${key}=" "$CONFIG_FILE"; then
        sed -i.bak "s|^${key}=.*|${key}=${value}|" "$CONFIG_FILE"
        rm -f "${CONFIG_FILE}.bak"
    else
        echo "${key}=${value}" >> "$CONFIG_FILE"
    fi
}

config_read() {
    # Read a value from config.env, return default if not found
    local key="$1" default="${2:-}"
    if [[ -f "$CONFIG_FILE" ]]; then
        local val
        val=$(grep "^${key}=" "$CONFIG_FILE" 2>/dev/null | head -1 | cut -d= -f2-)
        echo "${val:-$default}"
    else
        echo "$default"
    fi
}

# --- Retry Helper ---
retry() {
    # Usage: retry 3 curl -fsSL ...
    local attempts="$1"; shift
    local count=0
    until "$@"; do
        count=$((count + 1))
        if [[ $count -ge $attempts ]]; then
            log_err "Failed after $attempts attempts: $*"
            return 1
        fi
        log_warn "Attempt $count failed, retrying in $((count * 2))s..."
        sleep $((count * 2))
    done
}

# --- Template Rendering ---
render_template() {
    # Simple variable substitution in template files.
    # Usage: render_template templates/foo.tmpl VAR1=val1 VAR2=val2
    local template="$1"; shift
    local content
    content=$(cat "$template")
    for pair in "$@"; do
        local key="${pair%%=*}"
        local val="${pair#*=}"
        content="${content//\{\{$key\}\}/$val}"
    done
    echo "$content"
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/GitRepos/llka-deploy
git add lib/common.sh
git commit -m "feat: add shared utilities (logging, gum wrappers, config, templates)"
```

---

### Task 2: Platform Detection (`lib/detect.sh`)

**Files:**
- Create: `~/GitRepos/llka-deploy/lib/detect.sh`

- [ ] **Step 1: Create `lib/detect.sh`**

```bash
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
```

- [ ] **Step 2: Commit**

```bash
cd ~/GitRepos/llka-deploy
git add lib/detect.sh
git commit -m "feat: add platform detection (OS, arch, runtime, package manager)"
```

---

### Task 3: Bootstrap Script (`install.sh`)

**Files:**
- Create: `~/GitRepos/llka-deploy/install.sh`

The curl target. Downloads gum, clones or updates this repo, execs setup.sh.

- [ ] **Step 1: Create `install.sh`**

```bash
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
    GUM_BIN="$GUM_TMP/gum"
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
export LLKA_OS="${OS,,}"   # lowercase
export LLKA_ARCH="$ARCH"
exec bash "$DEPLOY_DIR/setup.sh"
```

- [ ] **Step 2: Make executable and commit**

```bash
cd ~/GitRepos/llka-deploy
chmod +x install.sh
git add install.sh
git commit -m "feat: add bootstrap install.sh (curl | bash target)

Downloads gum for TUI, clones llka-deploy repo, execs setup.sh.
Falls back to basic prompts if gum download fails."
```

---

### Task 4: Prerequisites Check (`lib/prerequisites.sh`)

**Files:**
- Create: `~/GitRepos/llka-deploy/lib/prerequisites.sh`

- [ ] **Step 1: Create `lib/prerequisites.sh`**

```bash
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
```

- [ ] **Step 2: Commit**

```bash
cd ~/GitRepos/llka-deploy
git add lib/prerequisites.sh
git commit -m "feat: add prerequisites check (git, curl, node 20+, bun detection)"
```

---

### Task 5: PocketBase Download (`lib/pocketbase.sh`)

**Files:**
- Create: `~/GitRepos/llka-deploy/lib/pocketbase.sh`

- [ ] **Step 1: Create `lib/pocketbase.sh`**

```bash
#!/usr/bin/env bash
# Download and set up PocketBase binary

download_pocketbase() {
    local os="$1" arch="$2"
    local pb_dir="$INSTALL_DIR/pocketbase"
    local platform
    platform=$(pocketbase_platform "$os" "$arch")

    # Get latest PocketBase version
    log_info "Fetching latest PocketBase version..."
    local latest_version
    latest_version=$(curl -fsSL "https://api.github.com/repos/pocketbase/pocketbase/releases/latest" \
        | grep '"tag_name"' | head -1 | sed 's/.*"v\([^"]*\)".*/\1/')

    if [[ -z "$latest_version" ]]; then
        log_err "Could not determine latest PocketBase version"
        exit 1
    fi

    # Check if already downloaded at this version
    if [[ -f "$pb_dir/pocketbase" ]]; then
        local current_version
        current_version=$("$pb_dir/pocketbase" --version 2>/dev/null | grep -o '[0-9]\+\.[0-9]\+\.[0-9]\+' || echo "")
        if [[ "$current_version" == "$latest_version" ]]; then
            log_ok "PocketBase v${latest_version} already installed"
            config_write "LLKA_PB_VERSION" "$latest_version"
            return 0
        fi
    fi

    local pb_tarball="pocketbase_${latest_version}_${platform}.zip"
    local pb_url="https://github.com/pocketbase/pocketbase/releases/download/v${latest_version}/${pb_tarball}"

    mkdir -p "$pb_dir"
    local tmp_dir
    tmp_dir=$(mktemp -d)

    gum_spin "Downloading PocketBase v${latest_version}..." \
        curl -fsSL "$pb_url" -o "$tmp_dir/$pb_tarball"

    # PocketBase releases are zip files
    if command -v unzip &>/dev/null; then
        unzip -qo "$tmp_dir/$pb_tarball" -d "$tmp_dir/pb"
    else
        # Python fallback for systems without unzip
        python3 -c "import zipfile; zipfile.ZipFile('$tmp_dir/$pb_tarball').extractall('$tmp_dir/pb')"
    fi

    mv "$tmp_dir/pb/pocketbase" "$pb_dir/pocketbase"
    chmod +x "$pb_dir/pocketbase"
    rm -rf "$tmp_dir"

    config_write "LLKA_PB_VERSION" "$latest_version"
    log_ok "PocketBase v${latest_version} installed"
}

setup_pocketbase_files() {
    # Copy hooks and migrations from leihbackend clone to PB directory
    local pb_dir="$INSTALL_DIR/pocketbase"
    local backend_dir="$1"  # path to cloned leihbackend

    # Copy hooks
    rm -rf "$pb_dir/pb_hooks"
    cp -r "$backend_dir/pb_hooks" "$pb_dir/pb_hooks"
    log_ok "Copied pb_hooks"

    # Copy migrations
    rm -rf "$pb_dir/pb_migrations"
    cp -r "$backend_dir/pb_migrations" "$pb_dir/pb_migrations"
    log_ok "Copied pb_migrations"
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/GitRepos/llka-deploy
git add lib/pocketbase.sh
git commit -m "feat: add PocketBase download and setup"
```

---

### Task 6: App Cloning & Building (`lib/apps.sh`)

**Files:**
- Create: `~/GitRepos/llka-deploy/lib/apps.sh`

- [ ] **Step 1: Create `lib/apps.sh`**

```bash
#!/usr/bin/env bash
# Clone and build leih.lokal apps

GITHUB_ORG="https://github.com/leih-lokal"

clone_or_pull() {
    # Clone a repo, or pull if it already exists
    local repo="$1" dest="$2"
    if [[ -d "$dest/.git" ]]; then
        log_info "Updating $repo..."
        git -C "$dest" pull --quiet
    else
        log_info "Cloning $repo..."
        mkdir -p "$(dirname "$dest")"
        git clone --quiet "$GITHUB_ORG/$repo.git" "$dest"
    fi
}

install_deps() {
    local dir="$1"
    local runtime
    runtime=$(config_read "LLKA_RUNTIME" "node")

    if [[ "$runtime" == "bun" ]]; then
        gum_spin "Installing dependencies with bun..." \
            bun install --cwd "$dir"
    else
        gum_spin "Installing dependencies with npm..." \
            npm --prefix "$dir" install
    fi
}

build_app() {
    local dir="$1"
    local runtime
    runtime=$(config_read "LLKA_RUNTIME" "node")

    if [[ "$runtime" == "bun" ]]; then
        (cd "$dir" && bun run build)
    else
        (cd "$dir" && npm run build)
    fi
}

setup_leihbackend() {
    local tmp_dir
    tmp_dir=$(mktemp -d)

    clone_or_pull "leihbackend" "$tmp_dir/leihbackend"
    setup_pocketbase_files "$tmp_dir/leihbackend"

    rm -rf "$tmp_dir"
    log_ok "leihbackend configured"
}

setup_verwaltung() {
    local app_dir="$INSTALL_DIR/apps/llka-verwaltung"
    local domain
    domain=$(config_read "LLKA_DOMAIN" "")

    clone_or_pull "llka-verwaltung" "$app_dir"
    install_deps "$app_dir"

    # Build in standalone mode
    local build_env="DOCKER_BUILD=true"
    if [[ -n "$domain" ]]; then
        build_env="$build_env NEXT_PUBLIC_POCKETBASE_URL=https://$domain"
    else
        build_env="$build_env NEXT_PUBLIC_POCKETBASE_URL=http://localhost:8090"
    fi

    log_info "Building llka-verwaltung..."
    gum_spin "Building llka-verwaltung (this may take a few minutes)..." \
        env $build_env build_app "$app_dir"

    log_ok "llka-verwaltung built"
}

setup_resomaker() {
    local app_dir="$INSTALL_DIR/apps/llka-resomaker"
    local domain
    domain=$(config_read "LLKA_DOMAIN" "")

    clone_or_pull "llka-resomaker" "$app_dir"
    install_deps "$app_dir"

    # Build with env vars
    local api_base
    if [[ -n "$domain" ]]; then
        api_base="https://$domain"
    else
        api_base="http://localhost:8090"
    fi

    local app_name
    app_name=$(config_read "LLKA_APP_NAME" "leih.lokal")
    local tagline
    tagline=$(config_read "LLKA_TAGLINE" "Leihen statt kaufen")

    log_info "Building llka-resomaker..."
    gum_spin "Building llka-resomaker (this may take a few minutes)..." \
        env \
        NEXT_PUBLIC_API_BASE="$api_base" \
        NEXT_PUBLIC_BASE_PATH="/reservierung" \
        NEXT_PUBLIC_BRAND_NAME="$app_name" \
        NEXT_PUBLIC_BRAND_TAGLINE="$tagline" \
        build_app "$app_dir"

    # The build:standalone script handles asset copy
    # but if it doesn't exist, do it manually
    if [[ -d "$app_dir/.next/standalone" ]] && [[ ! -d "$app_dir/.next/standalone/.next/static" ]]; then
        cp -r "$app_dir/.next/static" "$app_dir/.next/standalone/.next/" 2>/dev/null || true
        cp -r "$app_dir/public" "$app_dir/.next/standalone/" 2>/dev/null || true
    fi

    log_ok "llka-resomaker built"
}

setup_apps() {
    local components
    components=$(config_read "LLKA_COMPONENTS" "leihbackend,llka-verwaltung")

    # Always set up backend
    setup_leihbackend

    # Frontend apps
    if [[ "$components" == *"llka-verwaltung"* ]]; then
        setup_verwaltung
    fi

    if [[ "$components" == *"llka-resomaker"* ]]; then
        setup_resomaker
    fi
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/GitRepos/llka-deploy
git add lib/apps.sh
git commit -m "feat: add app cloning and building (backend, verwaltung, resomaker)"
```

---

### Task 7: Admin Setup & Settings Seeding (`lib/admin.sh`)

**Files:**
- Create: `~/GitRepos/llka-deploy/lib/admin.sh`

This is the most complex module — it starts PocketBase, creates the superuser, creates the settings collection, and seeds the initial config.

- [ ] **Step 1: Create `lib/admin.sh`**

```bash
#!/usr/bin/env bash
# PocketBase admin setup and settings seeding

PB_URL="http://127.0.0.1:8090"
PB_DIR="$INSTALL_DIR/pocketbase"

start_pocketbase() {
    log_info "Starting PocketBase..."
    "$PB_DIR/pocketbase" serve --dir "$PB_DIR/pb_data" \
        --hooksDir "$PB_DIR/pb_hooks" \
        --migrationsDir "$PB_DIR/pb_migrations" \
        &>/dev/null &
    PB_PID=$!

    # Wait for PocketBase to be ready
    local attempts=0
    while ! curl -fsSL "$PB_URL/api/health" &>/dev/null; do
        attempts=$((attempts + 1))
        if [[ $attempts -ge 30 ]]; then
            log_err "PocketBase failed to start after 30 seconds"
            kill "$PB_PID" 2>/dev/null || true
            exit 1
        fi
        sleep 1
    done
    log_ok "PocketBase running (PID $PB_PID)"
}

stop_pocketbase() {
    if [[ -n "${PB_PID:-}" ]]; then
        kill "$PB_PID" 2>/dev/null || true
        wait "$PB_PID" 2>/dev/null || true
        log_ok "PocketBase stopped"
    fi
}

prompt_admin_credentials() {
    echo ""
    log_info "Create your admin account for PocketBase."
    echo ""

    ADMIN_EMAIL=$(gum_input --header "Admin email" --value "admin@example.com")
    ADMIN_PASS=$(gum_input --header "Admin password (min 8 characters)" --password)

    if [[ ${#ADMIN_PASS} -lt 8 ]]; then
        log_err "Password must be at least 8 characters"
        prompt_admin_credentials
        return
    fi

    config_write "LLKA_ADMIN_EMAIL" "$ADMIN_EMAIL"
}

create_superuser() {
    log_info "Creating superuser..."
    "$PB_DIR/pocketbase" superuser create "$ADMIN_EMAIL" "$ADMIN_PASS" \
        --dir "$PB_DIR/pb_data" 2>/dev/null || {
        # Might already exist (re-run scenario)
        log_warn "Superuser may already exist, trying to authenticate..."
    }
    log_ok "Superuser ready"
}

get_auth_token() {
    local response
    response=$(curl -fsSL "$PB_URL/api/admins/auth-with-password" \
        -H "Content-Type: application/json" \
        -d "{\"identity\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" 2>/dev/null) || {
        # Try the superuser endpoint (PocketBase 0.23+)
        response=$(curl -fsSL "$PB_URL/api/collections/_superusers/auth-with-password" \
            -H "Content-Type: application/json" \
            -d "{\"identity\":\"$ADMIN_EMAIL\",\"password\":\"$ADMIN_PASS\"}" 2>/dev/null)
    }

    AUTH_TOKEN=$(echo "$response" | grep -o '"token":"[^"]*"' | head -1 | cut -d'"' -f4)

    if [[ -z "$AUTH_TOKEN" ]]; then
        log_err "Failed to authenticate. Check your credentials."
        exit 1
    fi
}

create_settings_collection() {
    log_info "Creating settings collection..."

    # Check if collection already exists
    local status
    status=$(curl -fsSL -o /dev/null -w "%{http_code}" \
        "$PB_URL/api/collections/settings" \
        -H "Authorization: $AUTH_TOKEN" 2>/dev/null)

    if [[ "$status" == "200" ]]; then
        log_ok "Settings collection already exists"
        return 0
    fi

    # Create the collection — schema matches llka-verwaltung's SETTINGS_COLLECTION_SCHEMA
    local schema
    read -r -d '' schema << 'SCHEMA_EOF' || true
{
  "id": "pbc_settings_001",
  "name": "settings",
  "type": "base",
  "system": false,
  "fields": [
    {"autogeneratePattern":"[a-z0-9]{15}","hidden":false,"id":"text3208210256","max":15,"min":15,"name":"id","pattern":"^[a-z0-9]+$","presentable":false,"primaryKey":true,"required":true,"system":true,"type":"text"},
    {"autogeneratePattern":"","hidden":false,"id":"text1847291650","max":0,"min":0,"name":"app_name","pattern":"","presentable":true,"primaryKey":false,"required":false,"system":false,"type":"text"},
    {"autogeneratePattern":"","hidden":false,"id":"text2938475610","max":0,"min":0,"name":"tagline","pattern":"","presentable":false,"primaryKey":false,"required":false,"system":false,"type":"text"},
    {"hidden":false,"id":"file4829371056","maxSelect":1,"maxSize":2097152,"mimeTypes":["image/png","image/svg+xml","image/jpeg"],"name":"logo","presentable":false,"protected":false,"required":false,"system":false,"thumbs":[],"type":"file"},
    {"hidden":false,"id":"file5938271640","maxSelect":1,"maxSize":2097152,"mimeTypes":["image/png","image/svg+xml","image/x-icon","image/vnd.microsoft.icon"],"name":"favicon","presentable":false,"protected":false,"required":false,"system":false,"thumbs":[],"type":"file"},
    {"autogeneratePattern":"","hidden":false,"id":"text6019384752","max":0,"min":0,"name":"copyright_holder","pattern":"","presentable":false,"primaryKey":false,"required":false,"system":false,"type":"text"},
    {"hidden":false,"id":"bool7120495863","name":"show_powered_by","presentable":false,"required":false,"system":false,"type":"bool"},
    {"autogeneratePattern":"","hidden":false,"id":"text8231506974","max":0,"min":0,"name":"primary_color","pattern":"","presentable":false,"primaryKey":false,"required":false,"system":false,"type":"text"},
    {"autogeneratePattern":"","hidden":false,"id":"text9342618085","max":0,"min":0,"name":"id_format","pattern":"","presentable":false,"primaryKey":false,"required":false,"system":false,"type":"text"},
    {"hidden":false,"id":"number1053729196","max":null,"min":0,"name":"id_padding","onlyInt":true,"presentable":false,"required":false,"system":false,"type":"number"},
    {"hidden":false,"id":"bool2164830207","name":"reservations_enabled","presentable":false,"required":false,"system":false,"type":"bool"},
    {"hidden":false,"id":"bool3275941318","name":"setup_complete","presentable":false,"required":false,"system":false,"type":"bool"},
    {"hidden":false,"id":"json4386729150","maxSize":2000000,"name":"opening_hours","presentable":false,"required":false,"system":false,"type":"json"},
    {"hidden":false,"id":"autodate2990389176","name":"created","onCreate":true,"onUpdate":false,"presentable":false,"system":false,"type":"autodate"},
    {"hidden":false,"id":"autodate3332085495","name":"updated","onCreate":true,"onUpdate":true,"presentable":false,"system":false,"type":"autodate"}
  ],
  "indexes": [],
  "listRule": "",
  "viewRule": "",
  "createRule": null,
  "updateRule": null,
  "deleteRule": null
}
SCHEMA_EOF

    local response
    response=$(curl -fsSL "$PB_URL/api/collections" \
        -H "Content-Type: application/json" \
        -H "Authorization: $AUTH_TOKEN" \
        -d "$schema" 2>/dev/null)

    if echo "$response" | grep -q '"id"'; then
        log_ok "Settings collection created"
    else
        log_err "Failed to create settings collection: $response"
        exit 1
    fi
}

seed_settings() {
    log_info "Seeding initial settings..."

    local app_name tagline opening_hours
    app_name=$(config_read "LLKA_APP_NAME" "leih.lokal")
    tagline=$(config_read "LLKA_TAGLINE" "Verwaltungssoftware")
    opening_hours=$(config_read "LLKA_OPENING_HOURS" '[["mon","15:00","19:00"],["thu","15:00","19:00"],["fri","15:00","19:00"],["sat","10:00","14:00"]]')

    # Check if a settings record already exists
    local existing
    existing=$(curl -fsSL "$PB_URL/api/collections/settings/records?perPage=1" \
        -H "Authorization: $AUTH_TOKEN" 2>/dev/null)

    local total
    total=$(echo "$existing" | grep -o '"totalItems":[0-9]*' | cut -d: -f2)

    local payload
    payload=$(cat <<EOF
{
    "app_name": "$app_name",
    "tagline": "$tagline",
    "opening_hours": $opening_hours,
    "reservations_enabled": true,
    "setup_complete": true,
    "show_powered_by": true,
    "primary_color": "oklch(0.515 0.283 27.87)",
    "id_format": "#",
    "id_padding": 0
}
EOF
)

    if [[ "${total:-0}" -gt 0 ]]; then
        # Update existing record
        local record_id
        record_id=$(echo "$existing" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
        curl -fsSL "$PB_URL/api/collections/settings/records/$record_id" \
            -X PATCH \
            -H "Content-Type: application/json" \
            -H "Authorization: $AUTH_TOKEN" \
            -d "$payload" &>/dev/null
        log_ok "Settings updated"
    else
        # Create new record
        curl -fsSL "$PB_URL/api/collections/settings/records" \
            -H "Content-Type: application/json" \
            -H "Authorization: $AUTH_TOKEN" \
            -d "$payload" &>/dev/null
        log_ok "Settings seeded"
    fi
}

run_admin_setup() {
    start_pocketbase
    trap stop_pocketbase EXIT

    prompt_admin_credentials
    create_superuser
    get_auth_token
    create_settings_collection
    seed_settings

    trap - EXIT
    stop_pocketbase
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/GitRepos/llka-deploy
git add lib/admin.sh
git commit -m "feat: add admin setup (superuser creation, settings collection, seeding)"
```

---

### Task 8: Service Templates

**Files:**
- Create: `~/GitRepos/llka-deploy/templates/leihbackend.service.tmpl`
- Create: `~/GitRepos/llka-deploy/templates/llka-verwaltung.service.tmpl`
- Create: `~/GitRepos/llka-deploy/templates/llka-resomaker.service.tmpl`
- Create: `~/GitRepos/llka-deploy/templates/caddy.service.tmpl`
- Create: `~/GitRepos/llka-deploy/templates/cloudflared.service.tmpl`
- Create: `~/GitRepos/llka-deploy/templates/Caddyfile.tmpl`

- [ ] **Step 1: Create all template files**

`templates/leihbackend.service.tmpl`:
```ini
[Unit]
Description=leih.lokal PocketBase Backend
After=network.target

[Service]
Type=simple
ExecStart={{INSTALL_DIR}}/pocketbase/pocketbase serve --http=0.0.0.0:8090 --dir={{INSTALL_DIR}}/pocketbase/pb_data --hooksDir={{INSTALL_DIR}}/pocketbase/pb_hooks --migrationsDir={{INSTALL_DIR}}/pocketbase/pb_migrations
WorkingDirectory={{INSTALL_DIR}}/pocketbase
Restart=on-failure
RestartSec=5
Environment=DRY_MODE=false

[Install]
WantedBy=default.target
```

`templates/llka-verwaltung.service.tmpl`:
```ini
[Unit]
Description=leih.lokal Admin UI (llka-verwaltung)
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/env node {{INSTALL_DIR}}/apps/llka-verwaltung/.next/standalone/server.js
WorkingDirectory={{INSTALL_DIR}}/apps/llka-verwaltung/.next/standalone
Restart=on-failure
RestartSec=5
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0

[Install]
WantedBy=default.target
```

`templates/llka-resomaker.service.tmpl`:
```ini
[Unit]
Description=leih.lokal Reservation Frontend (llka-resomaker)
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/env node {{INSTALL_DIR}}/apps/llka-resomaker/.next/standalone/server.js
WorkingDirectory={{INSTALL_DIR}}/apps/llka-resomaker/.next/standalone
Restart=on-failure
RestartSec=5
Environment=PORT=3001
Environment=HOSTNAME=0.0.0.0

[Install]
WantedBy=default.target
```

`templates/caddy.service.tmpl`:
```ini
[Unit]
Description=leih.lokal Caddy Reverse Proxy
After=network.target

[Service]
Type=simple
ExecStart={{INSTALL_DIR}}/caddy/caddy run --config {{INSTALL_DIR}}/caddy/Caddyfile
WorkingDirectory={{INSTALL_DIR}}/caddy
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

`templates/cloudflared.service.tmpl`:
```ini
[Unit]
Description=leih.lokal Cloudflare Tunnel
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/env cloudflared tunnel --config {{INSTALL_DIR}}/cloudflared-config.yml run
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

`templates/Caddyfile.tmpl`:
```
{{DOMAIN}} {
    handle /reservierung/* {
        reverse_proxy localhost:3001
    }

    handle /_/* {
        reverse_proxy localhost:8090
    }

    handle /api/* {
        reverse_proxy localhost:8090
    }

    handle {
        reverse_proxy localhost:3000
    }
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/GitRepos/llka-deploy
git add templates/
git commit -m "feat: add service and config templates

systemd units for PocketBase, verwaltung, resomaker, Caddy, cloudflared.
Caddyfile template for reverse proxy routing."
```

---

### Task 9: Networking Setup (`lib/networking.sh`)

**Files:**
- Create: `~/GitRepos/llka-deploy/lib/networking.sh`

- [ ] **Step 1: Create `lib/networking.sh`**

```bash
#!/usr/bin/env bash
# Networking setup: Caddy, Cloudflare Tunnel, or manual

setup_networking() {
    local domain
    domain=$(config_read "LLKA_DOMAIN" "")

    if [[ -z "$domain" ]]; then
        log_info "No domain configured — localhost mode."
        print_localhost_urls
        config_write "LLKA_NETWORKING" "none"
        return 0
    fi

    echo ""
    log_info "Domain: $domain"
    echo ""
    echo "  How would you like to expose your leih.lokal?"
    echo ""

    local choice
    choice=$(gum_choose \
        --header "Networking setup" \
        "Caddy (recommended — auto-HTTPS, simple)" \
        "Cloudflare Tunnel (requires Cloudflare account)" \
        "I'll handle it myself (just show me the ports)")

    case "$choice" in
        Caddy*)
            setup_caddy "$domain"
            config_write "LLKA_NETWORKING" "caddy"
            ;;
        Cloudflare*)
            setup_cloudflare_tunnel "$domain"
            config_write "LLKA_NETWORKING" "cloudflared"
            ;;
        *)
            print_manual_config "$domain"
            config_write "LLKA_NETWORKING" "manual"
            ;;
    esac
}

setup_caddy() {
    local domain="$1"
    local os arch
    os=$(config_read "LLKA_OS" "linux")
    arch=$(config_read "LLKA_ARCH" "amd64")
    local caddy_dir="$INSTALL_DIR/caddy"
    local platform
    platform=$(caddy_platform "$os" "$arch")

    mkdir -p "$caddy_dir"

    # Download Caddy
    if [[ ! -f "$caddy_dir/caddy" ]]; then
        log_info "Downloading Caddy..."
        local caddy_version
        caddy_version=$(curl -fsSL "https://api.github.com/repos/caddyserver/caddy/releases/latest" \
            | grep '"tag_name"' | head -1 | sed 's/.*"v\([^"]*\)".*/\1/')

        local caddy_tarball="caddy_${caddy_version}_${platform}.tar.gz"
        local caddy_url="https://github.com/caddyserver/caddy/releases/download/v${caddy_version}/${caddy_tarball}"

        local tmp_dir
        tmp_dir=$(mktemp -d)
        gum_spin "Downloading Caddy v${caddy_version}..." \
            curl -fsSL "$caddy_url" -o "$tmp_dir/$caddy_tarball"
        tar -xzf "$tmp_dir/$caddy_tarball" -C "$tmp_dir"
        mv "$tmp_dir/caddy" "$caddy_dir/caddy"
        chmod +x "$caddy_dir/caddy"
        rm -rf "$tmp_dir"
        log_ok "Caddy downloaded"
    else
        log_ok "Caddy already installed"
    fi

    # Generate Caddyfile
    local components
    components=$(config_read "LLKA_COMPONENTS" "leihbackend,llka-verwaltung")

    # Build Caddyfile from template
    render_template "$TEMPLATES_DIR/Caddyfile.tmpl" \
        "DOMAIN=$domain" \
        > "$caddy_dir/Caddyfile"

    # If resomaker is not installed, remove its handle block
    if [[ "$components" != *"llka-resomaker"* ]]; then
        sed -i.bak '/handle \/reservierung/,/}/d' "$caddy_dir/Caddyfile"
        rm -f "$caddy_dir/Caddyfile.bak"
    fi

    log_ok "Caddyfile generated at $caddy_dir/Caddyfile"

    # Note about port 80/443 permissions
    if is_linux; then
        echo ""
        log_warn "Caddy needs to bind to ports 80/443 for HTTPS."
        echo "  If running as a non-root user, grant the capability:"
        echo ""
        echo "    sudo setcap cap_net_bind_service=+ep $caddy_dir/caddy"
        echo ""
        if gum_confirm "Run this command now?"; then
            sudo setcap cap_net_bind_service=+ep "$caddy_dir/caddy" && \
                log_ok "Capability set" || \
                log_warn "Failed — you may need to run this manually"
        fi
    fi
}

setup_cloudflare_tunnel() {
    local domain="$1"

    if ! command -v cloudflared &>/dev/null; then
        echo ""
        log_err "cloudflared not found."
        echo ""
        echo "  Install it first:"
        echo "    https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
        echo ""
        echo "  Then re-run the installer."
        exit 1
    fi

    echo ""
    log_info "Setting up Cloudflare Tunnel..."
    echo ""
    echo "  You'll need to authenticate with Cloudflare."
    echo "  A browser window will open for you to log in."
    echo ""

    if gum_confirm "Ready to authenticate with Cloudflare?"; then
        cloudflared tunnel login
    else
        log_err "Cloudflare authentication required"
        exit 1
    fi

    # Create tunnel
    log_info "Creating tunnel 'leihlokal'..."
    cloudflared tunnel create leihlokal 2>/dev/null || {
        log_warn "Tunnel 'leihlokal' may already exist, continuing..."
    }

    # Get tunnel credentials file path
    local cred_file
    cred_file=$(ls ~/.cloudflared/*-leihlokal.json 2>/dev/null | head -1 || echo "")
    if [[ -z "$cred_file" ]]; then
        cred_file=$(ls ~/.cloudflared/*.json 2>/dev/null | head -1 || echo "")
    fi

    # Generate config
    local components
    components=$(config_read "LLKA_COMPONENTS" "leihbackend,llka-verwaltung")

    local config_path="$INSTALL_DIR/cloudflared-config.yml"

    cat > "$config_path" << CFEOF
tunnel: leihlokal
credentials-file: $cred_file

ingress:
  - hostname: $domain
    path: /api/*
    service: http://localhost:8090
  - hostname: $domain
    path: /_/*
    service: http://localhost:8090
CFEOF

    if [[ "$components" == *"llka-resomaker"* ]]; then
        cat >> "$config_path" << CFEOF
  - hostname: $domain
    path: /reservierung/*
    service: http://localhost:3001
CFEOF
    fi

    cat >> "$config_path" << CFEOF
  - hostname: $domain
    service: http://localhost:3000
  - service: http_status:404
CFEOF

    log_ok "Cloudflare Tunnel configured at $config_path"

    echo ""
    log_info "Don't forget to create a DNS CNAME record:"
    echo "    $domain → <tunnel-id>.cfargotunnel.com"
    echo ""
}

print_localhost_urls() {
    local components
    components=$(config_read "LLKA_COMPONENTS" "leihbackend,llka-verwaltung")

    echo ""
    echo "  Your services will be available at:"
    echo ""
    echo "    PocketBase Admin:  http://localhost:8090/_/"
    if [[ "$components" == *"llka-verwaltung"* ]]; then
        echo "    Admin UI:          http://localhost:3000"
    fi
    if [[ "$components" == *"llka-resomaker"* ]]; then
        echo "    Reservations:      http://localhost:3001"
    fi
    echo ""
}

print_manual_config() {
    local domain="$1"
    local components
    components=$(config_read "LLKA_COMPONENTS" "leihbackend,llka-verwaltung")

    echo ""
    echo "  Configure your reverse proxy to route:"
    echo ""
    echo "    /api/*  →  localhost:8090   (PocketBase API)"
    echo "    /_/*    →  localhost:8090   (PocketBase Admin)"
    if [[ "$components" == *"llka-resomaker"* ]]; then
        echo "    /reservierung/*  →  localhost:3001   (Reservation page)"
    fi
    echo "    /*      →  localhost:3000   (Admin UI)"
    echo ""
    echo "  Example Caddyfile:"
    echo ""
    echo "    $domain {"
    if [[ "$components" == *"llka-resomaker"* ]]; then
        echo "        handle /reservierung/* { reverse_proxy localhost:3001 }"
    fi
    echo "        handle /_/*  { reverse_proxy localhost:8090 }"
    echo "        handle /api/* { reverse_proxy localhost:8090 }"
    echo "        handle { reverse_proxy localhost:3000 }"
    echo "    }"
    echo ""
    echo "  Example Nginx:"
    echo ""
    echo "    server {"
    echo "        server_name $domain;"
    if [[ "$components" == *"llka-resomaker"* ]]; then
        echo "        location /reservierung/ { proxy_pass http://localhost:3001; }"
    fi
    echo "        location /_/ { proxy_pass http://localhost:8090; }"
    echo "        location /api/ { proxy_pass http://localhost:8090; }"
    echo "        location / { proxy_pass http://localhost:3000; }"
    echo "    }"
    echo ""
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/GitRepos/llka-deploy
git add lib/networking.sh
git commit -m "feat: add networking setup (Caddy, Cloudflare Tunnel, manual)"
```

---

### Task 10: Systemd Services (`lib/services.sh`)

**Files:**
- Create: `~/GitRepos/llka-deploy/lib/services.sh`

- [ ] **Step 1: Create `lib/services.sh`**

```bash
#!/usr/bin/env bash
# systemd user service registration (Linux only)

SYSTEMD_USER_DIR="$HOME/.config/systemd/user"

setup_services() {
    if is_macos; then
        print_macos_start_commands
        return 0
    fi

    mkdir -p "$SYSTEMD_USER_DIR"

    local components
    components=$(config_read "LLKA_COMPONENTS" "leihbackend,llka-verwaltung")
    local networking
    networking=$(config_read "LLKA_NETWORKING" "none")

    # Always install PocketBase service
    install_service "leihbackend"

    if [[ "$components" == *"llka-verwaltung"* ]]; then
        install_service "llka-verwaltung"
    fi

    if [[ "$components" == *"llka-resomaker"* ]]; then
        install_service "llka-resomaker"
    fi

    if [[ "$networking" == "caddy" ]]; then
        install_service "caddy"
    elif [[ "$networking" == "cloudflared" ]]; then
        install_service "cloudflared"
    fi

    # Enable linger so services survive logout
    log_info "Enabling linger for $USER..."
    loginctl enable-linger "$USER" 2>/dev/null || {
        log_warn "Could not enable linger. Services may stop when you log out."
        echo "  Run manually: sudo loginctl enable-linger $USER"
    }

    # Reload and start
    systemctl --user daemon-reload

    enable_and_start "leihbackend"

    if [[ "$components" == *"llka-verwaltung"* ]]; then
        enable_and_start "llka-verwaltung"
    fi

    if [[ "$components" == *"llka-resomaker"* ]]; then
        enable_and_start "llka-resomaker"
    fi

    if [[ "$networking" == "caddy" ]]; then
        enable_and_start "caddy"
    elif [[ "$networking" == "cloudflared" ]]; then
        enable_and_start "cloudflared"
    fi

    log_ok "All services registered and started"
}

install_service() {
    local name="$1"
    local template="$TEMPLATES_DIR/${name}.service.tmpl"
    local dest="$SYSTEMD_USER_DIR/${name}.service"

    if [[ ! -f "$template" ]]; then
        log_err "Template not found: $template"
        return 1
    fi

    render_template "$template" "INSTALL_DIR=$INSTALL_DIR" > "$dest"
    log_ok "Installed ${name}.service"
}

enable_and_start() {
    local name="$1"
    systemctl --user enable "$name" 2>/dev/null
    systemctl --user restart "$name" 2>/dev/null
    log_ok "Started $name"
}

print_macos_start_commands() {
    local components
    components=$(config_read "LLKA_COMPONENTS" "leihbackend,llka-verwaltung")

    echo ""
    log_warn "macOS detected — no systemd available."
    echo ""
    echo "  Start services manually:"
    echo ""
    echo "    # PocketBase"
    echo "    $INSTALL_DIR/pocketbase/pocketbase serve \\"
    echo "      --dir=$INSTALL_DIR/pocketbase/pb_data \\"
    echo "      --hooksDir=$INSTALL_DIR/pocketbase/pb_hooks \\"
    echo "      --migrationsDir=$INSTALL_DIR/pocketbase/pb_migrations &"
    echo ""

    if [[ "$components" == *"llka-verwaltung"* ]]; then
        echo "    # Admin UI"
        echo "    cd $INSTALL_DIR/apps/llka-verwaltung/.next/standalone && PORT=3000 node server.js &"
        echo ""
    fi

    if [[ "$components" == *"llka-resomaker"* ]]; then
        echo "    # Reservation page"
        echo "    cd $INSTALL_DIR/apps/llka-resomaker/.next/standalone && PORT=3001 node server.js &"
        echo ""
    fi
}

stop_all_services() {
    # Used during update to stop services before rebuild
    if is_macos; then
        log_warn "On macOS, please stop services manually before updating."
        return 0
    fi

    local services=("leihbackend" "llka-verwaltung" "llka-resomaker" "caddy" "cloudflared")
    for svc in "${services[@]}"; do
        systemctl --user stop "$svc" 2>/dev/null || true
    done
    log_ok "Services stopped"
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/GitRepos/llka-deploy
git add lib/services.sh
git commit -m "feat: add systemd service registration (Linux) with macOS fallback"
```

---

### Task 11: Main Orchestrator (`setup.sh`)

**Files:**
- Create: `~/GitRepos/llka-deploy/setup.sh`

This wires everything together — the welcome screen, component selection, config prompts, and all phases in order.

- [ ] **Step 1: Create `setup.sh`**

```bash
#!/usr/bin/env bash
# llka-deploy main setup orchestrator
set -euo pipefail

# Resolve script directory and source all modules
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/detect.sh"
source "$SCRIPT_DIR/lib/prerequisites.sh"
source "$SCRIPT_DIR/lib/pocketbase.sh"
source "$SCRIPT_DIR/lib/apps.sh"
source "$SCRIPT_DIR/lib/admin.sh"
source "$SCRIPT_DIR/lib/networking.sh"
source "$SCRIPT_DIR/lib/services.sh"

# ============================================================
# Welcome
# ============================================================
show_welcome() {
    echo ""
    gum_style \
        --border double \
        --border-foreground 212 \
        --padding "1 3" \
        --margin "0 2" \
        "leih.lokal — Library of Things Management System" \
        "" \
        "This installer will set up the full leih.lokal stack:" \
        "  • PocketBase backend (API & database)" \
        "  • Admin UI for managing items, customers & rentals" \
        "  • Optional: public reservation page" \
        "" \
        "Everything will be installed to ~/.leihlokal/"
    echo ""
}

# ============================================================
# Update Mode
# ============================================================
run_update_mode() {
    echo ""
    log_info "Existing installation found at $INSTALL_DIR"
    echo ""

    local choice
    choice=$(gum_choose \
        --header "What would you like to do?" \
        "Update all components" \
        "Reconfigure (change settings, domain, etc.)" \
        "Fresh install (wipe and start over)")

    case "$choice" in
        "Update all"*)
            log_info "Updating all components..."
            source "$CONFIG_FILE"
            check_prerequisites
            download_pocketbase "$LLKA_OS" "$LLKA_ARCH"
            setup_apps
            setup_services
            run_health_check
            ;;
        "Reconfigure"*)
            run_fresh_install
            ;;
        "Fresh install"*)
            if gum_confirm "This will DELETE everything in $INSTALL_DIR. Are you sure?"; then
                # Preserve llka-deploy repo itself
                local deploy_backup
                deploy_backup=$(mktemp -d)
                if [[ -d "$INSTALL_DIR/llka-deploy" ]]; then
                    cp -r "$INSTALL_DIR/llka-deploy" "$deploy_backup/"
                fi

                stop_all_services
                rm -rf "$INSTALL_DIR"
                mkdir -p "$INSTALL_DIR"

                if [[ -d "$deploy_backup/llka-deploy" ]]; then
                    mv "$deploy_backup/llka-deploy" "$INSTALL_DIR/"
                fi
                rm -rf "$deploy_backup"

                run_fresh_install
            else
                log_info "Cancelled."
                exit 0
            fi
            ;;
    esac
}

# ============================================================
# Fresh Install
# ============================================================
run_fresh_install() {
    # --- Detect platform ---
    local os arch
    os=$(detect_os)
    arch=$(detect_arch)
    config_write "LLKA_OS" "$os"
    config_write "LLKA_ARCH" "$arch"
    config_write "LLKA_VERSION" "1"
    config_write "LLKA_INSTALL_DIR" "$INSTALL_DIR"

    if is_macos; then
        echo ""
        log_warn "macOS detected. This works for testing but is not recommended"
        echo "  for production. Systemd service registration is not available."
        echo ""
    fi

    # --- Component selection ---
    echo ""
    log_info "Which components do you want to install?"
    echo ""

    local verwaltung_sel resomaker_sel components
    verwaltung_sel="llka-verwaltung"
    resomaker_sel=""

    if gum_confirm "Install Admin UI (llka-verwaltung)? (recommended)"; then
        verwaltung_sel="llka-verwaltung"
    else
        verwaltung_sel=""
    fi

    if gum_confirm "Install public reservation page (llka-resomaker)?"; then
        resomaker_sel="llka-resomaker"
    fi

    components="leihbackend"
    [[ -n "$verwaltung_sel" ]] && components="$components,$verwaltung_sel"
    [[ -n "$resomaker_sel" ]] && components="$components,$resomaker_sel"
    config_write "LLKA_COMPONENTS" "$components"

    # --- Basic configuration ---
    echo ""
    log_info "Basic configuration"
    echo ""

    local app_name tagline
    app_name=$(gum_input --header "Name of your leih.lokal" --value "leih.lokal")
    config_write "LLKA_APP_NAME" "$app_name"

    tagline=$(gum_input --header "Tagline / subtitle" --value "Verwaltungssoftware")
    config_write "LLKA_TAGLINE" "$tagline"

    # --- Opening hours ---
    echo ""
    log_info "Opening hours"
    echo "  Configure when your leih.lokal is open."
    echo "  Press y/n for each day, then enter times."
    echo ""

    local opening_hours="["
    local days=("mon:Montag/Monday:15:00:19:00" "tue:Dienstag/Tuesday:09:00:17:00" "wed:Mittwoch/Wednesday:09:00:17:00" "thu:Donnerstag/Thursday:15:00:19:00" "fri:Freitag/Friday:15:00:19:00" "sat:Samstag/Saturday:10:00:14:00" "sun:Sonntag/Sunday:09:00:17:00")
    local defaults_open=("mon" "thu" "fri" "sat")
    local first=true

    for day_entry in "${days[@]}"; do
        IFS=':' read -r key label default_open default_close <<< "$day_entry"

        local is_default=false
        for d in "${defaults_open[@]}"; do
            [[ "$d" == "$key" ]] && is_default=true
        done

        local confirm_default=""
        if $is_default; then
            confirm_default="--default=yes"
        fi

        if gum_confirm "$label — open?" $confirm_default 2>/dev/null || \
           gum_confirm "$label — open?"; then
            local open_time close_time
            open_time=$(gum_input --header "$label — opening time" --value "$default_open")
            close_time=$(gum_input --header "$label — closing time" --value "$default_close")

            if ! $first; then opening_hours+=","; fi
            opening_hours+="[\"$key\",\"$open_time\",\"$close_time\"]"
            first=false
        fi
    done
    opening_hours+="]"
    config_write "LLKA_OPENING_HOURS" "'$opening_hours'"

    # --- Domain ---
    echo ""
    local domain
    domain=$(gum_input --header "Domain name (leave blank for localhost only)" --value "")
    config_write "LLKA_DOMAIN" "$domain"

    # --- Run phases ---
    echo ""
    echo "  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo ""

    check_prerequisites

    echo ""
    download_pocketbase "$os" "$arch"

    echo ""
    setup_apps

    echo ""
    run_admin_setup

    echo ""
    setup_networking

    echo ""
    setup_services

    echo ""
    run_health_check
}

# ============================================================
# Health Check & Summary
# ============================================================
run_health_check() {
    local domain
    domain=$(config_read "LLKA_DOMAIN" "")
    local components
    components=$(config_read "LLKA_COMPONENTS" "leihbackend,llka-verwaltung")
    local admin_email
    admin_email=$(config_read "LLKA_ADMIN_EMAIL" "")

    local base_url
    if [[ -n "$domain" ]]; then
        base_url="https://$domain"
    else
        base_url="http://localhost"
    fi

    # Wait a moment for services to start
    sleep 2

    local all_ok=true

    # Check PocketBase
    if curl -fsSL "http://localhost:8090/api/health" &>/dev/null; then
        log_ok "PocketBase is running"
    else
        log_warn "PocketBase may still be starting..."
        all_ok=false
    fi

    # Check verwaltung
    if [[ "$components" == *"llka-verwaltung"* ]]; then
        if curl -fsSL "http://localhost:3000" &>/dev/null; then
            log_ok "Admin UI is running"
        else
            log_warn "Admin UI may still be starting..."
            all_ok=false
        fi
    fi

    # Check resomaker
    if [[ "$components" == *"llka-resomaker"* ]]; then
        if curl -fsSL "http://localhost:3001" &>/dev/null; then
            log_ok "Reservation page is running"
        else
            log_warn "Reservation page may still be starting..."
            all_ok=false
        fi
    fi

    # Summary
    echo ""
    local status_icon="✓"
    local status_msg="leih.lokal is running!"
    if ! $all_ok; then
        status_icon="~"
        status_msg="leih.lokal is starting up (give it a moment)..."
    fi

    gum_style \
        --border rounded \
        --border-foreground 212 \
        --padding "1 3" \
        --margin "1 2" \
        "$status_icon $status_msg" \
        "" \
        "PocketBase Admin:  ${base_url}:8090/_/" \
        "$(if [[ "$components" == *"llka-verwaltung"* ]]; then echo "Admin UI:          ${base_url}:3000"; fi)" \
        "$(if [[ "$components" == *"llka-resomaker"* ]]; then echo "Reservations:      ${base_url}:3001/reservierung"; fi)" \
        "" \
        "$(if [[ -n "$admin_email" ]]; then echo "Admin login:       $admin_email"; fi)" \
        "" \
        "Config saved to:   $CONFIG_FILE"

    # Adjust URLs if using reverse proxy
    if [[ -n "$domain" ]]; then
        local networking
        networking=$(config_read "LLKA_NETWORKING" "none")
        if [[ "$networking" != "none" && "$networking" != "manual" ]]; then
            echo ""
            echo "  With your reverse proxy, use:"
            echo "    Admin UI:     https://$domain/"
            if [[ "$components" == *"llka-resomaker"* ]]; then
                echo "    Reservations: https://$domain/reservierung"
            fi
            echo "    PocketBase:   https://$domain/_/"
        fi
    fi

    echo ""
}

# ============================================================
# Main
# ============================================================
main() {
    show_welcome

    if has_existing_install; then
        run_update_mode
    else
        run_fresh_install
    fi
}

main "$@"
```

- [ ] **Step 2: Make executable and commit**

```bash
cd ~/GitRepos/llka-deploy
chmod +x setup.sh
git add setup.sh
git commit -m "feat: add main setup orchestrator

Wires together all phases: welcome, component selection, config,
prerequisites, PocketBase, apps, admin, networking, services, health check.
Supports both fresh install and update mode."
```

---

### Task 12: README

**Files:**
- Modify: `~/GitRepos/llka-deploy/README.md`

- [ ] **Step 1: Write README**

```markdown
# LLKA-D (llka-deploy)

One-command installer for the [leih.lokal](https://leihlokal-ka.de) stack — a management system for Libraries of Things (Leihladen).

## Quick Start

```bash
curl -fsSL https://raw.githubusercontent.com/leih-lokal/llka-deploy/main/install.sh | bash
```

This will:
1. Download a TUI tool ([gum](https://github.com/charmbracelet/gum)) for interactive prompts
2. Clone this repo
3. Walk you through setting up your leih.lokal

## What Gets Installed

| Component | Description | Port |
|-----------|-------------|------|
| **leihbackend** | PocketBase backend (API + database) | 8090 |
| **llka-verwaltung** | Admin UI for managing items, customers, rentals | 3000 |
| **llka-resomaker** | Public reservation page (optional) | 3001 |

Everything is installed to `~/.leihlokal/`.

## Requirements

- **Linux** (recommended) or macOS (testing only — no systemd)
- **Node.js 20+** (Bun auto-detected and preferred if available)
- **git** and **curl**

## What the Installer Does

1. **Component selection** — choose which parts of the stack to install
2. **Configuration** — name, opening hours, domain
3. **Prerequisites check** — verifies git, curl, Node.js
4. **PocketBase** — downloads the latest binary for your platform
5. **Apps** — clones and builds the selected frontend apps
6. **Admin setup** — creates your PocketBase superuser and seeds initial settings
7. **Networking** — optionally sets up Caddy (auto-HTTPS) or Cloudflare Tunnel
8. **Services** — registers systemd user services (Linux) so everything starts on boot

## Updating

Just run the installer again:

```bash
curl -fsSL https://raw.githubusercontent.com/leih-lokal/llka-deploy/main/install.sh | bash
```

It detects your existing installation and offers to update, reconfigure, or start fresh.

## Configuration

All settings are saved to `~/.leihlokal/config.env`. The installer reads this file on re-runs to detect existing installations and preserve your choices.

## Networking Options

When you provide a domain name, the installer offers three options:

- **Caddy** (recommended) — downloads Caddy, generates a Caddyfile, handles HTTPS automatically
- **Cloudflare Tunnel** — if you have a Cloudflare account, sets up a tunnel with `cloudflared`
- **Manual** — prints port map and example configs for Caddy and Nginx

## macOS Limitations

macOS works for local testing but is not recommended for production:
- No systemd — services won't auto-start (manual start commands are printed)
- No Cloudflare Tunnel setup
- Caddy works but won't be registered as a service

## Project Structure

```
llka-deploy/
├── install.sh         # Bootstrap (curl target)
├── setup.sh           # Main orchestrator
├── lib/
│   ├── common.sh      # Shared utilities
│   ├── detect.sh      # OS/arch detection
│   ├── prerequisites.sh
│   ├── pocketbase.sh
│   ├── apps.sh
│   ├── admin.sh
│   ├── networking.sh
│   └── services.sh
└── templates/         # systemd units, Caddyfile
```

## Related Repos

- [leihbackend](https://github.com/leih-lokal/leihbackend) — PocketBase backend
- [llka-verwaltung](https://github.com/leih-lokal/llka-verwaltung) — Admin UI
- [llka-resomaker](https://github.com/leih-lokal/llka-resomaker) — Public reservation page
```

- [ ] **Step 2: Commit**

```bash
cd ~/GitRepos/llka-deploy
git add README.md
git commit -m "docs: add comprehensive README

Quick start, requirements, what gets installed, updating,
networking options, macOS limitations, project structure."
```

---

## Summary

| Task | Files | What |
|------|-------|------|
| 1 | `lib/common.sh` | Shared utilities (logging, gum wrappers, config, templates) |
| 2 | `lib/detect.sh` | OS, arch, runtime, package manager detection |
| 3 | `install.sh` | Bootstrap curl target (~60 lines) |
| 4 | `lib/prerequisites.sh` | Check git, curl, node 20+, detect bun |
| 5 | `lib/pocketbase.sh` | Download + extract PocketBase binary |
| 6 | `lib/apps.sh` | Clone repos, install deps, build Next.js apps |
| 7 | `lib/admin.sh` | Start PB, create superuser, seed settings |
| 8 | `templates/*` | systemd units, Caddyfile |
| 9 | `lib/networking.sh` | Caddy / Cloudflare Tunnel / manual config |
| 10 | `lib/services.sh` | systemd registration + macOS fallback |
| 11 | `setup.sh` | Main orchestrator wiring all phases |
| 12 | `README.md` | Usage documentation |
