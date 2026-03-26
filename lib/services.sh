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
