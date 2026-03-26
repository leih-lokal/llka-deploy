# LLKA-D (llka-deploy)

One-command installer for the [leih.lokal](https://leihlokal-ka.de) stack — a management system for Libraries of Things (Leihladen).

## Quick Start

```bash
npx llka-deploy
```

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

Just run it again:

```bash
npx llka-deploy@latest
```

It detects your existing installation and offers to update, reconfigure, or start fresh.

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

## Development

```bash
git clone https://github.com/leih-lokal/llka-deploy
cd llka-deploy
npm install
npm run dev    # Run directly via tsx
npm run build  # Build for distribution
```

## Related Repos

- [leihbackend](https://github.com/leih-lokal/leihbackend) — PocketBase backend
- [llka-verwaltung](https://github.com/leih-lokal/llka-verwaltung) — Admin UI
- [llka-resomaker](https://github.com/leih-lokal/llka-resomaker) — Public reservation page
