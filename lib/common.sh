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
