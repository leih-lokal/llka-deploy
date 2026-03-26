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
