import * as p from '@clack/prompts'
import { writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { INSTALL_DIR, configRead } from './config.js'
import { exec, ensureDir, renderTemplate } from './utils.js'
import type { Platform } from './detect.js'

const SYSTEMD_USER_DIR = resolve(homedir(), '.config', 'systemd', 'user')
const LAUNCH_AGENTS_DIR = resolve(homedir(), 'Library', 'LaunchAgents')

export function setupServices(platform: Platform): void {
  const components = configRead('LLKA_COMPONENTS', 'leihbackend,llka-verwaltung')
  const networking = configRead('LLKA_NETWORKING', 'none')

  if (platform.isMacOS) {
    setupLaunchd(components, networking)
    return
  }

  setupSystemd(components, networking)
}

// --- systemd (Linux) ---

function setupSystemd(components: string, networking: string): void {
  ensureDir(SYSTEMD_USER_DIR)

  installSystemdService('leihbackend')
  if (components.includes('llka-verwaltung')) installSystemdService('llka-verwaltung')
  if (components.includes('llka-resomaker')) installSystemdService('llka-resomaker')
  if (networking === 'caddy') installSystemdService('caddy')
  if (networking === 'cloudflared') installSystemdService('cloudflared')

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
  enableAndStartSystemd('leihbackend')
  if (components.includes('llka-verwaltung')) enableAndStartSystemd('llka-verwaltung')
  if (components.includes('llka-resomaker')) enableAndStartSystemd('llka-resomaker')
  if (networking === 'caddy') enableAndStartSystemd('caddy')
  if (networking === 'cloudflared') enableAndStartSystemd('cloudflared')

  p.log.success('All services registered and started')
}

function installSystemdService(name: string): void {
  const content = renderTemplate(`${name}.service.tmpl`, { INSTALL_DIR })
  const dest = resolve(SYSTEMD_USER_DIR, `${name}.service`)
  writeFileSync(dest, content)
  p.log.success(`Installed ${name}.service`)
}

function enableAndStartSystemd(name: string): void {
  try {
    exec(`systemctl --user enable ${name}`)
    exec(`systemctl --user restart ${name}`)
    p.log.success(`Started ${name}`)
  } catch {
    p.log.warn(`Could not start ${name} — check systemctl --user status ${name}`)
  }
}

// --- launchd (macOS) ---

function setupLaunchd(components: string, networking: string): void {
  ensureDir(LAUNCH_AGENTS_DIR)

  const nodePath = exec('command -v node')

  installLaunchdAgent('leihbackend', {
    label: 'de.leihlokal.backend',
    program: resolve(INSTALL_DIR, 'pocketbase', 'pocketbase'),
    args: [
      'serve',
      `--dir=${resolve(INSTALL_DIR, 'pocketbase', 'pb_data')}`,
      `--hooksDir=${resolve(INSTALL_DIR, 'pocketbase', 'pb_hooks')}`,
      `--migrationsDir=${resolve(INSTALL_DIR, 'pocketbase', 'pb_migrations')}`,
    ],
    workingDir: resolve(INSTALL_DIR, 'pocketbase'),
    env: { DRY_MODE: 'false' },
  })

  if (components.includes('llka-verwaltung')) {
    installLaunchdAgent('llka-verwaltung', {
      label: 'de.leihlokal.verwaltung',
      program: nodePath,
      args: [resolve(INSTALL_DIR, 'apps', 'llka-verwaltung', '.next', 'standalone', 'server.js')],
      workingDir: resolve(INSTALL_DIR, 'apps', 'llka-verwaltung', '.next', 'standalone'),
      env: { PORT: '3000', HOSTNAME: '0.0.0.0' },
    })
  }

  if (components.includes('llka-resomaker')) {
    installLaunchdAgent('llka-resomaker', {
      label: 'de.leihlokal.resomaker',
      program: nodePath,
      args: [resolve(INSTALL_DIR, 'apps', 'llka-resomaker', '.next', 'standalone', 'server.js')],
      workingDir: resolve(INSTALL_DIR, 'apps', 'llka-resomaker', '.next', 'standalone'),
      env: { PORT: '3001', HOSTNAME: '0.0.0.0' },
    })
  }

  if (networking === 'caddy') {
    installLaunchdAgent('caddy', {
      label: 'de.leihlokal.caddy',
      program: resolve(INSTALL_DIR, 'caddy', 'caddy'),
      args: ['run', '--config', resolve(INSTALL_DIR, 'caddy', 'Caddyfile')],
      workingDir: resolve(INSTALL_DIR, 'caddy'),
      env: {},
    })
  }

  if (networking === 'cloudflared') {
    const cloudflaredPath = exec('command -v cloudflared')
    installLaunchdAgent('cloudflared', {
      label: 'de.leihlokal.cloudflared',
      program: cloudflaredPath,
      args: ['tunnel', '--config', resolve(INSTALL_DIR, 'cloudflared-config.yml'), 'run'],
      workingDir: INSTALL_DIR,
      env: {},
    })
  }

  p.log.success('All services registered and started (launchd)')
}

interface LaunchdConfig {
  label: string
  program: string
  args: string[]
  workingDir: string
  env: Record<string, string>
}

function installLaunchdAgent(name: string, config: LaunchdConfig): void {
  const logDir = resolve(INSTALL_DIR, 'logs')
  ensureDir(logDir)

  const envEntries = Object.entries(config.env)
    .map(([k, v]) => `      <key>${k}</key>\n      <string>${v}</string>`)
    .join('\n')

  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${config.label}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${config.program}</string>
${config.args.map(a => `    <string>${a}</string>`).join('\n')}
  </array>

  <key>WorkingDirectory</key>
  <string>${config.workingDir}</string>
${envEntries ? `
  <key>EnvironmentVariables</key>
  <dict>
${envEntries}
  </dict>
` : ''}
  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>${resolve(logDir, `${name}.log`)}</string>

  <key>StandardErrorPath</key>
  <string>${resolve(logDir, `${name}.error.log`)}</string>
</dict>
</plist>
`

  const dest = resolve(LAUNCH_AGENTS_DIR, `${config.label}.plist`)

  // Unload if already loaded
  if (existsSync(dest)) {
    try { exec(`launchctl unload "${dest}"`) } catch { /* not loaded */ }
  }

  writeFileSync(dest, plist)
  p.log.success(`Installed ${config.label}.plist`)

  try {
    exec(`launchctl load "${dest}"`)
    p.log.success(`Started ${name}`)
  } catch {
    p.log.warn(`Could not start ${name} — try: launchctl load "${dest}"`)
  }
}

// --- Stop all ---

export function stopAllServices(platform: Platform): void {
  if (platform.isMacOS) {
    stopLaunchdServices()
    return
  }

  for (const svc of ['leihbackend', 'llka-verwaltung', 'llka-resomaker', 'caddy', 'cloudflared']) {
    try { exec(`systemctl --user stop ${svc}`) } catch { /* may not be running */ }
  }
  p.log.success('Services stopped')
}

function stopLaunchdServices(): void {
  const labels = [
    'de.leihlokal.backend',
    'de.leihlokal.verwaltung',
    'de.leihlokal.resomaker',
    'de.leihlokal.caddy',
    'de.leihlokal.cloudflared',
  ]

  for (const label of labels) {
    const plistPath = resolve(LAUNCH_AGENTS_DIR, `${label}.plist`)
    if (existsSync(plistPath)) {
      try { exec(`launchctl unload "${plistPath}"`) } catch { /* not loaded */ }
    }
  }
  p.log.success('Services stopped')
}
