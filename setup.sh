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
