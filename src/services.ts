import * as p from '@clack/prompts'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { INSTALL_DIR, configRead } from './config.js'
import { exec, ensureDir, renderTemplate } from './utils.js'
import type { Platform } from './detect.js'

const SYSTEMD_USER_DIR = resolve(homedir(), '.config', 'systemd', 'user')

export function setupServices(platform: Platform): void {
  if (platform.isMacOS) {
    printMacOSCommands()
    return
  }

  ensureDir(SYSTEMD_USER_DIR)

  const components = configRead('LLKA_COMPONENTS', 'leihbackend,llka-verwaltung')
  const networking = configRead('LLKA_NETWORKING', 'none')

  installService('leihbackend')
  if (components.includes('llka-verwaltung')) installService('llka-verwaltung')
  if (components.includes('llka-resomaker')) installService('llka-resomaker')
  if (networking === 'caddy') installService('caddy')
  if (networking === 'cloudflared') installService('cloudflared')

  // Enable linger
  p.log.info(`Enabling linger for ${process.env.USER}...`)
  try {
    exec(`loginctl enable-linger ${process.env.USER}`)
  } catch {
    p.log.warn('Could not enable linger. Services may stop when you log out.')
    p.log.message(`  Run manually: sudo loginctl enable-linger ${process.env.USER}`)
  }

  // Reload and start
  exec('systemctl --user daemon-reload')
  enableAndStart('leihbackend')
  if (components.includes('llka-verwaltung')) enableAndStart('llka-verwaltung')
  if (components.includes('llka-resomaker')) enableAndStart('llka-resomaker')
  if (networking === 'caddy') enableAndStart('caddy')
  if (networking === 'cloudflared') enableAndStart('cloudflared')

  p.log.success('All services registered and started')
}

function installService(name: string): void {
  const content = renderTemplate(`${name}.service.tmpl`, { INSTALL_DIR })
  const dest = resolve(SYSTEMD_USER_DIR, `${name}.service`)
  writeFileSync(dest, content)
  p.log.success(`Installed ${name}.service`)
}

function enableAndStart(name: string): void {
  try {
    exec(`systemctl --user enable ${name}`)
    exec(`systemctl --user restart ${name}`)
    p.log.success(`Started ${name}`)
  } catch {
    p.log.warn(`Could not start ${name} — check systemctl --user status ${name}`)
  }
}

function printMacOSCommands(): void {
  const components = configRead('LLKA_COMPONENTS', 'leihbackend,llka-verwaltung')

  p.log.warn('macOS detected — no systemd available.')
  p.log.message('')
  p.log.message('  Start services manually:')
  p.log.message('')
  p.log.message(`  # LLKA-B`)
  p.log.message(`  ${INSTALL_DIR}/pocketbase/pocketbase serve \\`)
  p.log.message(`    --dir=${INSTALL_DIR}/pocketbase/pb_data \\`)
  p.log.message(`    --hooksDir=${INSTALL_DIR}/pocketbase/pb_hooks \\`)
  p.log.message(`    --migrationsDir=${INSTALL_DIR}/pocketbase/pb_migrations &`)

  if (components.includes('llka-verwaltung')) {
    p.log.message('')
    p.log.message(`  # LLKA-V`)
    p.log.message(`  cd ${INSTALL_DIR}/apps/llka-verwaltung/.next/standalone && PORT=3000 node server.js &`)
  }

  if (components.includes('llka-resomaker')) {
    p.log.message('')
    p.log.message(`  # LLKA-R`)
    p.log.message(`  cd ${INSTALL_DIR}/apps/llka-resomaker/.next/standalone && PORT=3001 node server.js &`)
  }
}

export function stopAllServices(platform: Platform): void {
  if (platform.isMacOS) {
    p.log.warn('On macOS, please stop services manually before updating.')
    return
  }

  for (const svc of ['leihbackend', 'llka-verwaltung', 'llka-resomaker', 'caddy', 'cloudflared']) {
    try { exec(`systemctl --user stop ${svc}`) } catch { /* may not be running */ }
  }
  p.log.success('Services stopped')
}
