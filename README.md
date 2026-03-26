```
██╗     ██╗     ██╗  ██╗ █████╗
██║     ██║     ██║ ██╔╝██╔══██╗
██║     ██║     █████╔╝ ███████║
██║     ██║     ██╔═██╗ ██╔══██║
███████╗███████╗██║  ██╗██║  ██║
╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝
```

# llka-deploy

One-command installer for [leih.lokal](https://leihlokal-ka.de) — a management system for Libraries of Things (*Leihladen*).

```bash
npx llka-deploy
```

That's it. The interactive installer walks you through everything.

## The LLKA Stack

| Component | What it does | Port |
|-----------|-------------|------|
| **LLKA-B** | PocketBase backend — API, database, auth, hooks | 8090 |
| **LLKA-V** | Management UI — items, customers, rentals | 3000 |
| **LLKA-R** | Public reservation portal *(optional)* | 3001 |

Everything is installed to `~/.leihlokal/`.

## What the Installer Does

1. **Component selection** — choose which parts of the stack to install
2. **Configuration** — name your library, set opening hours, configure your domain
3. **Prerequisites check** — verifies git, curl, Node.js 20+
4. **LLKA-B** — downloads the latest PocketBase binary for your platform
5. **LLKA-V / LLKA-R** — clones, configures `.env.local`, and builds the Next.js apps
6. **Admin setup** — creates your superuser, seeds settings, configures email templates
7. **Networking** — optionally sets up Caddy (auto-HTTPS) or Cloudflare Tunnel
8. **Services** — registers systemd (Linux) or launchd (macOS) services for auto-start
9. **CLAUDE.md** — generates an agent-readable config file for AI-assisted maintenance

## Requirements

- **Linux** or **macOS**
- **Node.js 20+** (Bun auto-detected and preferred if available)
- **git** and **curl**

## Updating

```bash
npx llka-deploy@latest
```

The installer detects your existing installation and offers to update, reconfigure, start fresh, or uninstall.

## Networking

When you provide a domain name, the installer offers three options:

- **Caddy** *(recommended)* — downloads Caddy, generates a Caddyfile, handles HTTPS automatically
- **Cloudflare Tunnel** — sets up a tunnel with `cloudflared` for Cloudflare-managed domains
- **Manual** — prints the port map and example reverse proxy configs

Without a domain, everything runs on localhost.

## Platform Support

| | Linux | macOS |
|---|---|---|
| Services | systemd (auto-start, auto-restart) | launchd (auto-start, auto-restart) |
| Logs | `journalctl --user -u leihbackend` | `~/.leihlokal/logs/` |
| Networking | Caddy, Cloudflare Tunnel, manual | Caddy, manual |
| Production | Yes | Testing recommended |

## Uninstalling

```bash
npx llka-deploy
# Select "Uninstall"
```

Stops all services, deregisters service files, and removes `~/.leihlokal/`.

## Development

```bash
git clone https://github.com/leih-lokal/llka-deploy
cd llka-deploy
npm install
npm run dev    # Run directly via tsx
npm run build  # Build for distribution
```

**Tech stack:** TypeScript, [@clack/prompts](https://github.com/bombshell-dev/clack) (TUI), [tsup](https://github.com/egoist/tsup) (bundler), Node.js built-ins for everything else.

## Related Repos

- [leih-lokal/leihbackend](https://github.com/leih-lokal/leihbackend) — LLKA-B: PocketBase backend, hooks, migrations
- [leih-lokal/llka-verwaltung](https://github.com/leih-lokal/llka-verwaltung) — LLKA-V: Next.js management UI
- [leih-lokal/llka-resomaker](https://github.com/leih-lokal/llka-resomaker) — LLKA-R: Next.js reservation portal

## License

MIT
