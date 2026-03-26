import * as p from '@clack/prompts'
import { existsSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { INSTALL_DIR, configRead, configWrite } from './config.js'
import { exec, ensureDir, renderTemplate, which } from './utils.js'
import { caddyPlatform, type Platform } from './detect.js'

export async function setupNetworking(platform: Platform): Promise<void> {
  const domain = configRead('LLKA_DOMAIN', '')

  if (!domain) {
    p.log.info('No domain configured — localhost mode.')
    printLocalhostUrls()
    configWrite('LLKA_NETWORKING', 'none')
    return
  }

  p.log.info(`Domain: ${domain}`)

  const choice = await p.select({
    message: 'How would you like to expose your leih.lokal?',
    options: [
      { value: 'caddy', label: 'Caddy (recommended)', hint: 'auto-HTTPS, simple config' },
      { value: 'cloudflare', label: 'Cloudflare Tunnel', hint: 'requires Cloudflare account' },
      { value: 'manual', label: "I'll handle it myself", hint: 'prints port map + example configs' },
    ],
  })
  if (p.isCancel(choice)) { p.cancel('Setup cancelled.'); process.exit(0) }

  switch (choice) {
    case 'caddy':
      await setupCaddy(domain, platform)
      configWrite('LLKA_NETWORKING', 'caddy')
      break
    case 'cloudflare':
      await setupCloudflareTunnel(domain)
      configWrite('LLKA_NETWORKING', 'cloudflared')
      break
    case 'manual':
      printManualConfig(domain)
      configWrite('LLKA_NETWORKING', 'manual')
      break
  }
}

async function setupCaddy(domain: string, platform: Platform): Promise<void> {
  const caddyDir = resolve(INSTALL_DIR, 'caddy')
  ensureDir(caddyDir)

  if (!existsSync(resolve(caddyDir, 'caddy'))) {
    p.log.info('Downloading Caddy...')
    const releaseJson = exec('curl -fsSL https://api.github.com/repos/caddyserver/caddy/releases/latest')
    const version = releaseJson.match(/"tag_name":\s*"v([^"]+)"/)?.[1]
    if (!version) { p.log.error('Could not determine Caddy version'); process.exit(1) }

    const plat = caddyPlatform(platform)
    const tarball = `caddy_${version}_${plat}.tar.gz`
    const url = `https://github.com/caddyserver/caddy/releases/download/v${version}/${tarball}`

    const s = p.spinner()
    s.start(`Downloading Caddy v${version}...`)
    const tmpDir = exec('mktemp -d')
    exec(`curl -fsSL "${url}" -o "${tmpDir}/${tarball}"`)
    exec(`tar -xzf "${tmpDir}/${tarball}" -C "${tmpDir}"`)
    exec(`mv "${tmpDir}/caddy" "${caddyDir}/caddy"`)
    exec(`chmod +x "${caddyDir}/caddy"`)
    exec(`rm -rf "${tmpDir}"`)
    s.stop('Caddy downloaded')
  } else {
    p.log.success('Caddy already installed')
  }

  // Generate Caddyfile
  const components = configRead('LLKA_COMPONENTS', 'leihbackend,llka-verwaltung')
  let caddyfile = renderTemplate('Caddyfile.tmpl', { DOMAIN: domain })

  if (!components.includes('llka-resomaker')) {
    // Remove resomaker handle block
    caddyfile = caddyfile.replace(/\s*handle \/reservierung\/\* \{[^}]*\}\n?/, '')
  }

  writeFileSync(resolve(caddyDir, 'Caddyfile'), caddyfile)
  p.log.success(`Caddyfile generated at ${caddyDir}/Caddyfile`)

  if (platform.isLinux) {
    p.log.warn('Caddy needs to bind to ports 80/443 for HTTPS.')
    p.log.message(`  If running as non-root, run:`)
    p.log.message(`  sudo setcap cap_net_bind_service=+ep ${caddyDir}/caddy`)

    const run = await p.confirm({ message: 'Run this command now?' })
    if (!p.isCancel(run) && run) {
      try {
        exec(`sudo setcap cap_net_bind_service=+ep "${caddyDir}/caddy"`)
        p.log.success('Capability set')
      } catch {
        p.log.warn('Failed — you may need to run this manually')
      }
    }
  }
}

async function setupCloudflareTunnel(domain: string): Promise<void> {
  if (!which('cloudflared')) {
    p.log.error('cloudflared not found.')
    p.log.message('  Install it first:')
    p.log.message('  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/')
    p.log.message('')
    p.log.message('  Then re-run the installer.')
    process.exit(1)
  }

  p.log.info('Setting up Cloudflare Tunnel...')
  p.log.message('  You\'ll need to authenticate with Cloudflare.')
  p.log.message('  A browser window will open for you to log in.')

  const ready = await p.confirm({ message: 'Ready to authenticate with Cloudflare?' })
  if (p.isCancel(ready) || !ready) { p.cancel('Cloudflare authentication required'); process.exit(1) }

  try { exec('cloudflared tunnel login', { stdio: 'inherit' }) } catch { /* may already be logged in */ }

  p.log.info("Creating tunnel 'leihlokal'...")
  try { exec('cloudflared tunnel create leihlokal') } catch { p.log.warn("Tunnel 'leihlokal' may already exist") }

  const components = configRead('LLKA_COMPONENTS', 'leihbackend,llka-verwaltung')
  const configPath = resolve(INSTALL_DIR, 'cloudflared-config.yml')

  let credFile = ''
  try { credFile = exec('ls ~/.cloudflared/*.json 2>/dev/null | head -1') } catch { /* no cred file */ }

  let config = `tunnel: leihlokal
credentials-file: ${credFile}

ingress:
  - hostname: ${domain}
    path: /api/*
    service: http://localhost:8090
  - hostname: ${domain}
    path: /_/*
    service: http://localhost:8090
`

  if (components.includes('llka-resomaker')) {
    config += `  - hostname: ${domain}
    path: /reservierung/*
    service: http://localhost:3001
`
  }

  config += `  - hostname: ${domain}
    service: http://localhost:3000
  - service: http_status:404
`

  writeFileSync(configPath, config)
  p.log.success(`Cloudflare Tunnel configured at ${configPath}`)
  p.log.info("Don't forget to create a DNS CNAME record:")
  p.log.message(`  ${domain} → <tunnel-id>.cfargotunnel.com`)
}

function printLocalhostUrls(): void {
  const components = configRead('LLKA_COMPONENTS', 'leihbackend,llka-verwaltung')
  p.log.message('')
  p.log.message('  Your services will be available at:')
  p.log.message('  PocketBase Admin:  http://localhost:8090/_/')
  if (components.includes('llka-verwaltung')) p.log.message('  Admin UI:          http://localhost:3000')
  if (components.includes('llka-resomaker')) p.log.message('  Reservations:      http://localhost:3001')
}

function printManualConfig(domain: string): void {
  const components = configRead('LLKA_COMPONENTS', 'leihbackend,llka-verwaltung')
  p.log.message('')
  p.log.message('  Configure your reverse proxy to route:')
  p.log.message('  /api/*  →  localhost:8090   (PocketBase API)')
  p.log.message('  /_/*    →  localhost:8090   (PocketBase Admin)')
  if (components.includes('llka-resomaker')) p.log.message('  /reservierung/*  →  localhost:3001')
  p.log.message('  /*      →  localhost:3000   (Admin UI)')
  p.log.message('')
  p.log.message(`  Example Caddyfile:`)
  p.log.message(`  ${domain} {`)
  if (components.includes('llka-resomaker')) p.log.message('      handle /reservierung/* { reverse_proxy localhost:3001 }')
  p.log.message('      handle /_/*  { reverse_proxy localhost:8090 }')
  p.log.message('      handle /api/* { reverse_proxy localhost:8090 }')
  p.log.message('      handle { reverse_proxy localhost:3000 }')
  p.log.message('  }')
}
