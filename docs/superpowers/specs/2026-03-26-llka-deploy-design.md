# llka-deploy Design Spec

**Goal:** A `curl | bash` installer that takes someone from zero to a running leih.lokal stack on a Linux server.

**Audience:** "Computer touchers" — comfortable with a terminal, not necessarily developers.

**Entry point:** `curl -fsSL https://leihlokal.de/install | bash`

---

## Architecture

### Two-Stage Entry

1. **`install.sh`** (the curl target) — ~50 lines. Downloads `gum` for TUI, clones the `llka-deploy` repo, execs `setup.sh`. Almost never changes.
2. **`setup.sh`** (the real installer) — lives in the repo, versioned, updatable. Orchestrates modular scripts from `lib/`.

### File Structure

```
llka-deploy/
├── install.sh              # Bootstrap (curl target, ~50 lines)
├── setup.sh                # Main orchestrator
├── lib/
│   ├── common.sh           # Shared utils (logging, colors, gum wrappers)
│   ├── detect.sh           # OS, arch, existing install detection
│   ├── prerequisites.sh    # Check/install node 20+, git, curl
│   ├── pocketbase.sh       # Download PB binary for platform
│   ├── apps.sh             # Clone repos, install deps, build
│   ├── admin.sh            # Start PB, create superuser, seed settings
│   ├── networking.sh       # Caddy / Cloudflare Tunnel / manual
│   └── services.sh         # systemd unit generation & registration
├── templates/
│   ├── Caddyfile.tmpl      # Reverse proxy config template
│   ├── leihbackend.service.tmpl
│   ├── llka-verwaltung.service.tmpl
│   └── llka-resomaker.service.tmpl
└── README.md
```

### Install Location

Everything under `~/.leihlokal/`:

```
~/.leihlokal/
├── pocketbase/          # PB binary + pb_data + hooks + migrations
├── apps/
│   ├── llka-verwaltung/ # Cloned repo + built app
│   └── llka-resomaker/  # Cloned repo + built app (if selected)
├── caddy/               # Caddy binary + Caddyfile (if using Caddy)
├── config.env           # Saved choices for re-runs/updates
└── llka-deploy/         # This repo (cloned by bootstrap)
```

---

## User Flow

### Phase 1: Bootstrap (`install.sh`)

1. Detect OS (`uname -s`) and architecture (`uname -m`).
2. If not Linux or macOS, abort with error.
3. If macOS, print warning: "macOS works for testing but is not recommended for production. Systemd service registration is not available."
4. Download `gum` binary for the detected platform from GitHub releases. Place in a temp directory.
5. Check if `~/.leihlokal/llka-deploy/` exists. If yes, `git pull`. If no, `git clone https://github.com/leih-lokal/llka-deploy.git ~/.leihlokal/llka-deploy/`.
6. Exec `~/.leihlokal/llka-deploy/setup.sh`, passing the path to the `gum` binary.

### Phase 2: Welcome & Detection (`setup.sh` + `lib/detect.sh`)

7. Display branded welcome screen via `gum style`. Brief explanation: "leih.lokal is a management system for Libraries of Things (Leihladen)."
8. Check for `~/.leihlokal/config.env`. If found → existing installation detected, enter **update mode** (see Update Mode section below). If not → fresh install, continue.

### Phase 3: Component Selection

9. `gum choose` with multi-select:
   - `[x] leihbackend (PocketBase backend) — required` (cannot deselect)
   - `[x] llka-verwaltung (Admin UI) — recommended`
   - `[ ] llka-resomaker (Public reservation page) — optional`
10. Save selection to `config.env`.

### Phase 4: Basic Configuration

11. `gum input` prompts:
    - **Name** of your leih.lokal (default: `leih.lokal`)
    - **Tagline** (default: `Verwaltungssoftware`)
12. **Opening hours** — interactive weekday picker:
    - For each day (Monday–Sunday): `gum confirm "Montag / Monday — open?"`
    - If yes: `gum input "Opening time" --value "15:00"` and `gum input "Closing time" --value "19:00"`
    - Defaults pre-filled: Mon/Thu/Fri 15:00–19:00, Sat 10:00–14:00, rest closed.
13. **Domain** — `gum input "Domain name (leave blank for localhost only)"`. If blank, set localhost mode flag.
14. Save all config to `config.env`.

### Phase 5: Prerequisites (`lib/prerequisites.sh`)

15. Check for required tools: `git`, `curl`, `node` (v20+).
16. Detect `bun` — if present, set `RUNTIME=bun` flag. Otherwise `RUNTIME=node`.
17. Missing prerequisites → print what's missing with install instructions for their platform (detect apt/dnf/brew). Do **not** auto-install Node — too many ways to do it. Print the recommended command and wait for them to install, then re-check.
18. All prerequisites met → continue.

### Phase 6: Download PocketBase (`lib/pocketbase.sh`)

19. Map architecture: `x86_64` → `amd64`, `aarch64`/`arm64` → `arm64`.
20. Query GitHub releases API for latest stable PocketBase release.
21. Download and extract to `~/.leihlokal/pocketbase/`.
22. Copy `pb_hooks/` and `pb_migrations/` from the leihbackend repo (cloned in next phase) into the PocketBase directory.

### Phase 7: Clone & Build Apps (`lib/apps.sh`)

23. Clone `leih-lokal/leihbackend` into a temp location (for hooks/migrations only — PocketBase binary is separate).
24. Copy `pb_hooks/` and `pb_migrations/` to `~/.leihlokal/pocketbase/`.
25. For each selected frontend app (llka-verwaltung, llka-resomaker):
    - Clone into `~/.leihlokal/apps/<name>/`.
    - Run `bun install` or `npm install` (based on detected runtime).
    - Build:
      - **llka-verwaltung:** `DOCKER_BUILD=true npm run build` (standalone mode). If domain set, `BASE_PATH=` (empty, root). If sharing domain with resomaker, verwaltung stays at root.
      - **llka-resomaker:** Build with env vars: `NEXT_PUBLIC_API_BASE=http://localhost:8090` (or `https://<domain>`), `NEXT_PUBLIC_BASE_PATH=/reservierung`. Run `npm run build:standalone` (handles asset copy).
26. Show progress via `gum spin`.

### Phase 8: Admin & Seeding (`lib/admin.sh`)

27. Start PocketBase in background: `~/.leihlokal/pocketbase/pocketbase serve &`.
28. Wait for PocketBase to be ready (poll `http://localhost:8090/api/health`).
29. Prompt for superuser credentials:
    - `gum input "Admin email"`
    - `gum input "Admin password" --password`
30. Create superuser: `./pocketbase superuser create <email> <pass>`.
31. Authenticate against PocketBase API using those credentials.
32. Create the `settings` collection via `POST /api/collections` using the schema defined in llka-verwaltung (the `SETTINGS_COLLECTION_SCHEMA` object — replicated in this script as a JSON payload).
33. Create the settings record via `POST /api/collections/settings/records` with:
    - `app_name`: from step 11
    - `tagline`: from step 11
    - `opening_hours`: from step 12 (JSON array format: `[["mon","15:00","19:00"],...]`)
    - `reservations_enabled`: `true`
    - `setup_complete`: `true`
34. Stop the background PocketBase process (it will be started properly by systemd).

### Phase 9: Networking (`lib/networking.sh`)

35. If no domain (localhost mode) → skip. Print localhost URLs and continue to services.
36. If domain provided, `gum choose`:
    - **Caddy (recommended)** — auto-HTTPS, simple config
    - **Cloudflare Tunnel** — if they have a Cloudflare account
    - **I'll handle it myself** — print port map + config snippets

**Caddy path:**
37. Download Caddy binary for platform from GitHub releases.
38. Place in `~/.leihlokal/caddy/`.
39. Generate `Caddyfile` from `templates/Caddyfile.tmpl`:
    ```
    <domain> {
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
40. Register Caddy as a systemd service.

**Cloudflare Tunnel path:**
41. Check for `cloudflared` binary. If missing, print install instructions.
42. Guide through `cloudflared tunnel login` and `cloudflared tunnel create leihlokal`.
43. Generate `~/.leihlokal/cloudflared-config.yml` with ingress rules matching the same routing as the Caddyfile.
44. Register `cloudflared` as a systemd service.

**Manual path:**
45. Print port map:
    ```
    PocketBase:      localhost:8090  (route /api/* and /_/*)
    llka-verwaltung: localhost:3000  (route /*)
    llka-resomaker:  localhost:3001  (route /reservierung/*)
    ```
46. Print example Caddyfile and Nginx config block.

### Phase 10: Systemd Services (`lib/services.sh`) — Linux only

47. Generate systemd user unit files from `templates/*.service.tmpl` for each component:
    - `leihbackend.service` — runs `pocketbase serve`
    - `llka-verwaltung.service` — runs `node .next/standalone/server.js` (port 3000)
    - `llka-resomaker.service` — runs `node .next/standalone/server.js` (port 3001), if selected
    - Caddy or cloudflared service, if applicable
48. Install to `~/.config/systemd/user/`.
49. Run `loginctl enable-linger $USER` (so services survive logout).
50. `systemctl --user enable --now` each service.

**macOS:** Skip systemd. Print manual start commands:
```
~/.leihlokal/pocketbase/pocketbase serve &
cd ~/.leihlokal/apps/llka-verwaltung && node .next/standalone/server.js &
cd ~/.leihlokal/apps/llka-resomaker && node .next/standalone/server.js &
```

### Phase 11: Health Check & Summary

51. Poll each service's health/root endpoint.
52. Display summary via `gum style`:
    ```
    ┌──────────────────────────────────────────┐
    │  ✓ leih.lokal is running!                │
    │                                          │
    │  Admin UI:      https://example.com/     │
    │  Reservations:  https://example.com/     │
    │                 reservierung              │
    │  PocketBase:    https://example.com/_/   │
    │                                          │
    │  Admin login:   your-email@example.com   │
    └──────────────────────────────────────────┘
    ```

---

## Update Mode

When `setup.sh` finds `~/.leihlokal/config.env`:

1. Display "Existing installation found."
2. `gum choose`:
   - **Update all** — git pull each repo, rebuild apps, copy new hooks/migrations, restart services
   - **Update specific component** — select which to update
   - **Reconfigure** — re-run config prompts (name, hours, domain, networking), regenerate files, rebuild
   - **Fresh install** — wipe `~/.leihlokal/` and start over (with confirmation)
3. Update pulls latest code, rebuilds with existing `config.env` values, restarts systemd services.
4. PocketBase migrations run automatically on restart.

---

## config.env Format

```bash
# llka-deploy configuration — generated by setup.sh
LLKA_VERSION=1
LLKA_INSTALL_DIR="$HOME/.leihlokal"
LLKA_COMPONENTS="leihbackend,llka-verwaltung,llka-resomaker"
LLKA_APP_NAME="leih.lokal"
LLKA_TAGLINE="Verwaltungssoftware"
LLKA_OPENING_HOURS='[["mon","15:00","19:00"],["thu","15:00","19:00"],["fri","15:00","19:00"],["sat","10:00","14:00"]]'
LLKA_DOMAIN=""
LLKA_NETWORKING="caddy"
LLKA_RUNTIME="bun"
LLKA_ADMIN_EMAIL="admin@example.com"
LLKA_PB_VERSION="0.36.2"
LLKA_OS="linux"
LLKA_ARCH="amd64"
```

---

## Port Assignments

| Service | Port | Notes |
|---------|------|-------|
| PocketBase | 8090 | Backend API + admin UI |
| llka-verwaltung | 3000 | Admin dashboard |
| llka-resomaker | 3001 | Public reservation page |
| Caddy | 80/443 | Reverse proxy (if used) |

---

## Error Handling

- Every phase checks its own success before proceeding.
- On failure: print clear error message, suggest fix, offer to retry or abort.
- Partial installs are resumable — `config.env` tracks what was completed.
- Network failures during downloads → retry up to 3 times with backoff.

---

## Out of Scope (for now)

- Windows support (point to WSL)
- Docker-based installation path (possible future addition)
- Automatic Node.js installation
- Email/SMTP configuration (done through PocketBase admin UI after install)
- SSL certificate management beyond what Caddy handles automatically
