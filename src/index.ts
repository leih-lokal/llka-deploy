import * as p from '@clack/prompts'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { configExists, configWrite, configRead, INSTALL_DIR } from './config.js'
import { detectPlatform } from './detect.js'
import { checkPrerequisites } from './prerequisites.js'
import { runPrompts } from './prompts.js'
import { downloadPocketBase } from './pocketbase.js'
import { setupApps } from './apps.js'
import { runAdminSetup } from './admin.js'
import { setupNetworking } from './networking.js'
import { setupServices } from './services.js'
import { runUpdateMode } from './update.js'
import { exec } from './utils.js'

async function main(): Promise<void> {
  console.log('')
  console.log('  ██╗     ██╗     ██╗  ██╗ █████╗ ')
  console.log('  ██║     ██║     ██║ ██╔╝██╔══██╗')
  console.log('  ██║     ██║     █████╔╝ ███████║')
  console.log('  ██║     ██║     ██╔═██╗ ██╔══██║')
  console.log('  ███████╗███████╗██║  ██╗██║  ██║')
  console.log('  ╚══════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝')
  console.log('')

  p.intro('leih.lokal — Library of Things Management System')

  p.log.message('')
  p.log.message('  The LLKA stack:')
  p.log.message('    LLKA-B  PocketBase backend (API & database)')
  p.log.message('    LLKA-V  Management UI (items, customers & rentals)')
  p.log.message('    LLKA-R  Public reservation portal (optional)')
  p.log.message('')
  p.log.message(`  Install directory: ${INSTALL_DIR}`)
  p.log.message('')

  const platform = detectPlatform()

  if (platform.isMacOS) {
    p.log.info('macOS detected — services will be managed via launchd.')
  }

  // Check for existing installation
  if (configExists()) {
    const result = await runUpdateMode(platform)
    if (result === 'update') {
      // Update already performed in runUpdateMode
      await runHealthCheck()
      p.outro('Update complete!')
      return
    }
    // 'reconfigure' and 'fresh' fall through to fresh install
  }

  // --- Fresh install ---
  configWrite('LLKA_OS', platform.os)
  configWrite('LLKA_ARCH', platform.arch)
  configWrite('LLKA_VERSION', '1')
  configWrite('LLKA_INSTALL_DIR', INSTALL_DIR)

  await runPrompts()
  await checkPrerequisites()
  await downloadPocketBase(platform)
  setupApps()
  await runAdminSetup()
  await setupNetworking(platform)
  setupServices(platform)
  await runHealthCheck()
  generateClaudeMd(platform)
  printNextSteps()

  p.outro('leih.lokal is ready!')
}

async function runHealthCheck(): Promise<void> {
  const domain = configRead('LLKA_DOMAIN', '')
  const components = configRead('LLKA_COMPONENTS', 'leihbackend,llka-verwaltung')
  const adminEmail = configRead('LLKA_ADMIN_EMAIL', '')
  const networking = configRead('LLKA_NETWORKING', 'none')

  // Give services a moment to start
  await new Promise((resolve) => setTimeout(resolve, 2000))

  // Check LLKA-B
  try { exec('curl -fsSL http://localhost:8090/api/health'); p.log.success('LLKA-B is running') }
  catch { p.log.warn('LLKA-B may still be starting...') }

  // Check LLKA-V
  if (components.includes('llka-verwaltung')) {
    try { exec('curl -fsSL http://localhost:3000'); p.log.success('LLKA-V is running') }
    catch { p.log.warn('LLKA-V may still be starting...') }
  }

  // Check LLKA-R
  if (components.includes('llka-resomaker')) {
    try { exec('curl -fsSL http://localhost:3001'); p.log.success('LLKA-R is running') }
    catch { p.log.warn('LLKA-R may still be starting...') }
  }

  // Summary
  const baseUrl = domain ? `https://${domain}` : 'http://localhost'

  p.log.message('')
  p.log.message('  ┌──────────────────────────────────────────────┐')
  p.log.message('  │  leih.lokal is running!                      │')
  p.log.message('  │                                              │')
  p.log.message(`  │  LLKA-B  ${baseUrl}:8090/_/`)
  if (components.includes('llka-verwaltung')) {
    p.log.message(`  │  LLKA-V  ${baseUrl}:3000`)
  }
  if (components.includes('llka-resomaker')) {
    p.log.message(`  │  LLKA-R  ${baseUrl}:3001/reservierung`)
  }
  if (adminEmail) {
    p.log.message('  │                                              │')
    p.log.message(`  │  Admin:  ${adminEmail}`)
  }
  p.log.message('  └──────────────────────────────────────────────┘')

  if (domain && networking !== 'none' && networking !== 'manual') {
    p.log.message('')
    p.log.message('  With your reverse proxy:')
    p.log.message(`    LLKA-V  https://${domain}/`)
    if (components.includes('llka-resomaker')) {
      p.log.message(`    LLKA-R  https://${domain}/reservierung`)
    }
    p.log.message(`    LLKA-B  https://${domain}/_/`)
  }
}

function printNextSteps(): void {
  const domain = configRead('LLKA_DOMAIN', '')
  const components = configRead('LLKA_COMPONENTS', 'leihbackend,llka-verwaltung')
  const baseUrl = domain ? `https://${domain}` : 'http://localhost'

  p.log.message('')
  p.log.step('Next steps')
  p.log.message('')
  p.log.message('  1. Log into LLKA-V to configure your leih.lokal:')
  p.log.message(`     ${domain ? `${baseUrl}/` : `${baseUrl}:3000`}`)
  p.log.message('     Set up categories, add items, configure your branding.')
  p.log.message('')
  p.log.message('  2. Import existing data (if you have any):')
  p.log.message(`     Use the LLKA-B admin UI at ${baseUrl}:8090/_/`)
  p.log.message('     You can import via CSV, the API, or direct SQL on the')
  p.log.message(`     SQLite database at ${INSTALL_DIR}/pocketbase/pb_data/data.db`)
  p.log.message('')
  if (components.includes('llka-resomaker')) {
    p.log.message('  3. Share your reservation page with users:')
    p.log.message(`     ${domain ? `${baseUrl}/reservierung` : `${baseUrl}:3001`}`)
    p.log.message('')
  }
  p.log.message('  A CLAUDE.md has been generated at:')
  p.log.message(`  ${INSTALL_DIR}/CLAUDE.md`)
  p.log.message('  Point an AI agent at your install directory and it can')
  p.log.message('  help with maintenance, updates, and configuration.')
}

function generateClaudeMd(platform: import('./detect.js').Platform): void {
  const appName = configRead('LLKA_APP_NAME', 'leih.lokal')
  const domain = configRead('LLKA_DOMAIN', '')
  const components = configRead('LLKA_COMPONENTS', 'leihbackend,llka-verwaltung')
  const networking = configRead('LLKA_NETWORKING', 'none')
  const runtime = configRead('LLKA_RUNTIME', 'node')
  const adminEmail = configRead('LLKA_ADMIN_EMAIL', '')
  const baseUrl = domain ? `https://${domain}` : 'http://localhost'

  const hasV = components.includes('llka-verwaltung')
  const hasR = components.includes('llka-resomaker')
  const isMac = platform.isMacOS

  // Service management commands differ by platform
  const svcMgr = isMac ? 'launchd' : 'systemd'

  const restartCmds = isMac
    ? `launchctl unload ~/Library/LaunchAgents/de.leihlokal.backend.plist && launchctl load ~/Library/LaunchAgents/de.leihlokal.backend.plist
${hasV ? 'launchctl unload ~/Library/LaunchAgents/de.leihlokal.verwaltung.plist && launchctl load ~/Library/LaunchAgents/de.leihlokal.verwaltung.plist\n' : ''}${hasR ? 'launchctl unload ~/Library/LaunchAgents/de.leihlokal.resomaker.plist && launchctl load ~/Library/LaunchAgents/de.leihlokal.resomaker.plist\n' : ''}`
    : `systemctl --user restart leihbackend
${hasV ? 'systemctl --user restart llka-verwaltung\n' : ''}${hasR ? 'systemctl --user restart llka-resomaker\n' : ''}`

  const statusCmds = isMac
    ? `launchctl list | grep leihlokal`
    : `systemctl --user status leihbackend
${hasV ? 'systemctl --user status llka-verwaltung\n' : ''}${hasR ? 'systemctl --user status llka-resomaker\n' : ''}`

  const logCmds = isMac
    ? `tail -f ${INSTALL_DIR}/logs/leihbackend.log
${hasV ? `tail -f ${INSTALL_DIR}/logs/llka-verwaltung.log\n` : ''}${hasR ? `tail -f ${INSTALL_DIR}/logs/llka-resomaker.log\n` : ''}`
    : `journalctl --user -u leihbackend -f
${hasV ? 'journalctl --user -u llka-verwaltung -f\n' : ''}${hasR ? 'journalctl --user -u llka-resomaker -f\n' : ''}`

  const restartAfterRebuildV = isMac
    ? 'launchctl unload ~/Library/LaunchAgents/de.leihlokal.verwaltung.plist && launchctl load ~/Library/LaunchAgents/de.leihlokal.verwaltung.plist'
    : 'systemctl --user restart llka-verwaltung'

  const restartAfterRebuildR = isMac
    ? 'launchctl unload ~/Library/LaunchAgents/de.leihlokal.resomaker.plist && launchctl load ~/Library/LaunchAgents/de.leihlokal.resomaker.plist'
    : 'systemctl --user restart llka-resomaker'

  const content = `# ${appName} — LLKA Installation

This is an LLKA (leih.lokal) installation managed by \`llka-deploy\`.

## Architecture

| Component | Description | Port | Directory |
|-----------|-------------|------|-----------|
| **LLKA-B** | PocketBase backend (API + SQLite database) | 8090 | \`${INSTALL_DIR}/pocketbase/\` |
${hasV ? `| **LLKA-V** | Management UI (Next.js) | 3000 | \`${INSTALL_DIR}/apps/llka-verwaltung/\` |\n` : ''}${hasR ? `| **LLKA-R** | Public reservation portal (Next.js) | 3001 | \`${INSTALL_DIR}/apps/llka-resomaker/\` |\n` : ''}
## URLs

- LLKA-B admin: ${baseUrl}:8090/_/
${hasV ? `- LLKA-V: ${domain ? `${baseUrl}/` : `${baseUrl}:3000`}\n` : ''}${hasR ? `- LLKA-R: ${domain ? `${baseUrl}/reservierung` : `${baseUrl}:3001`}\n` : ''}- Admin email: ${adminEmail}

## Key Files

- **Config**: \`${INSTALL_DIR}/config.env\` — all install-time choices
- **Database**: \`${INSTALL_DIR}/pocketbase/pb_data/data.db\` — SQLite, back this up
- **PB Hooks**: \`${INSTALL_DIR}/pocketbase/pb_hooks/\` — server-side JS hooks
- **PB Migrations**: \`${INSTALL_DIR}/pocketbase/pb_migrations/\` — schema migrations
${hasV ? `- **LLKA-V env**: \`${INSTALL_DIR}/apps/llka-verwaltung/.env.local\`\n` : ''}${hasR ? `- **LLKA-R env**: \`${INSTALL_DIR}/apps/llka-resomaker/.env.local\`\n` : ''}${networking === 'caddy' ? `- **Caddyfile**: \`${INSTALL_DIR}/caddy/Caddyfile\`\n` : ''}${networking === 'cloudflared' ? `- **Tunnel config**: \`${INSTALL_DIR}/cloudflared-config.yml\`\n` : ''}${isMac ? `- **Logs**: \`${INSTALL_DIR}/logs/\`\n` : ''}
## Runtime

- **Platform**: ${platform.os} ${platform.arch}
- **Service manager**: ${svcMgr}
- **Runtime**: ${runtime}
- **Networking**: ${networking}
${domain ? `- **Domain**: ${domain}\n` : '- **Domain**: none (localhost only)\n'}
## Common Tasks

### Update all components
\`\`\`bash
npx llka-deploy@latest
# Select "Update all components"
\`\`\`

### Restart services
\`\`\`bash
${restartCmds}\`\`\`

### Check service status
\`\`\`bash
${statusCmds}\`\`\`

### View logs
\`\`\`bash
${logCmds}\`\`\`

### Back up the database
\`\`\`bash
cp ${INSTALL_DIR}/pocketbase/pb_data/data.db ~/data-backup-$(date +%Y%m%d).db
\`\`\`

### Rebuild LLKA-V after config change
\`\`\`bash
cd ${INSTALL_DIR}/apps/llka-verwaltung
${runtime === 'bun' ? 'bun run build' : 'npm run build'}
${restartAfterRebuildV}
\`\`\`

${hasR ? `### Rebuild LLKA-R after config change
\`\`\`bash
cd ${INSTALL_DIR}/apps/llka-resomaker
${runtime === 'bun' ? 'bun run build' : 'npm run build'}
${restartAfterRebuildR}
\`\`\`
` : ''}
### PocketBase API
The PocketBase API is at \`${baseUrl}:8090/api/\`. Collections can be managed
via the admin UI at \`${baseUrl}:8090/_/\` or via the REST API. The \`settings\`
collection holds the app config (name, tagline, opening hours, colors).

### Import data
- **CSV import**: Use the LLKA-B admin UI (Collections → Import)
- **API import**: POST to \`${baseUrl}:8090/api/collections/{collection}/records\`
- **Direct SQL**: \`sqlite3 ${INSTALL_DIR}/pocketbase/pb_data/data.db\`

## Upstream Repositories

These are the source repos for each component. Check them for docs, issues, and updates:

- **LLKA-B**: [leih-lokal/leihbackend](https://github.com/leih-lokal/leihbackend) — PocketBase backend, hooks, migrations
- **LLKA-V**: [leih-lokal/llka-verwaltung](https://github.com/leih-lokal/llka-verwaltung) — Next.js management UI
- **LLKA-R**: [leih-lokal/llka-resomaker](https://github.com/leih-lokal/llka-resomaker) — Next.js reservation portal
- **Installer**: [leih-lokal/llka-deploy](https://github.com/leih-lokal/llka-deploy) — This installer (\`npx llka-deploy\`)

## Caution

- Always back up \`pb_data/data.db\` before making schema changes
- The \`NEXT_PUBLIC_*\` env vars in \`.env.local\` are baked in at build time — rebuild after changing them
- PocketBase hooks in \`pb_hooks/\` are loaded at startup — restart LLKA-B after editing

## Agent Directives

**Keep this file up to date.** If you make any change to this installation — config
edits, rebuilds, service changes, new collections, domain changes, dependency updates —
update this CLAUDE.md to reflect the current state. This file is the source of truth for
agents working on this installation.

**Do not trust this file blindly.** The operator may have made manual changes to config
files, the database, services, or environment variables outside of \`llka-deploy\`. Before
acting on information in this file, verify the actual state:
- Check \`config.env\` for current config values
- Check running services (\`${isMac ? 'launchctl list | grep leihlokal' : 'systemctl --user list-units | grep llka'}\`)
- Check \`.env.local\` files for actual env vars
- Check the database schema via PocketBase admin or API
- Check upstream repos for breaking changes before updating

If you find a discrepancy between this file and reality, update this file to match reality.
`

  writeFileSync(resolve(INSTALL_DIR, 'CLAUDE.md'), content)
  p.log.success(`CLAUDE.md generated at ${INSTALL_DIR}/CLAUDE.md`)
}

main().catch((err) => {
  p.log.error(err.message ?? String(err))
  process.exit(1)
})
