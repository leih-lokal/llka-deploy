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
