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
