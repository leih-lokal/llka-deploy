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
