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
