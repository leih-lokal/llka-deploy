import * as p from '@clack/prompts'
import { existsSync, cpSync } from 'node:fs'
import { resolve } from 'node:path'
import { INSTALL_DIR, configRead } from './config.js'
import { exec, execLive, ensureDir } from './utils.js'
import { setupPocketBaseFiles } from './pocketbase.js'

const GITHUB_ORG = 'https://github.com/leih-lokal'

function cloneOrPull(repo: string, dest: string): void {
  if (existsSync(resolve(dest, '.git'))) {
    p.log.info(`Updating ${repo}...`)
    exec(`git -C "${dest}" pull --quiet`)
  } else {
    p.log.info(`Cloning ${repo}...`)
    ensureDir(resolve(dest, '..'))
    exec(`git clone --quiet ${GITHUB_ORG}/${repo}.git "${dest}"`)
  }
}

function installDeps(dir: string): void {
  const runtime = configRead('LLKA_RUNTIME', 'node')
  const s = p.spinner()
  s.start(`Installing dependencies with ${runtime}...`)

  if (runtime === 'bun') {
    exec(`bun install --cwd "${dir}"`, { stdio: 'pipe' })
  } else {
    exec(`npm --prefix "${dir}" install`, { stdio: 'pipe' })
  }

  s.stop('Dependencies installed')
}

function buildApp(dir: string, env: Record<string, string> = {}): void {
  const runtime = configRead('LLKA_RUNTIME', 'node')
  const envStr = Object.entries(env).map(([k, v]) => `${k}=${v}`).join(' ')
  const cmd = runtime === 'bun' ? 'bun run build' : 'npm run build'

  exec(`${envStr} ${cmd}`, { cwd: dir, stdio: 'pipe' })
}

function setupLeihbackend(): void {
  const tmpDir = exec('mktemp -d')

  cloneOrPull('leihbackend', `${tmpDir}/leihbackend`)
  setupPocketBaseFiles(`${tmpDir}/leihbackend`)

  exec(`rm -rf "${tmpDir}"`)
  p.log.success('leihbackend configured')
}

function setupVerwaltung(): void {
  const appDir = resolve(INSTALL_DIR, 'apps', 'llka-verwaltung')
  const domain = configRead('LLKA_DOMAIN', '')

  cloneOrPull('llka-verwaltung', appDir)
  installDeps(appDir)

  const env: Record<string, string> = {
    DOCKER_BUILD: 'true',
    NEXT_PUBLIC_POCKETBASE_URL: domain ? `https://${domain}` : 'http://localhost:8090',
  }

  const s = p.spinner()
  s.start('Building llka-verwaltung (this may take a few minutes)...')
  buildApp(appDir, env)
  s.stop('llka-verwaltung built')
}

function setupResomaker(): void {
  const appDir = resolve(INSTALL_DIR, 'apps', 'llka-resomaker')
  const domain = configRead('LLKA_DOMAIN', '')
  const appName = configRead('LLKA_APP_NAME', 'leih.lokal')
  const tagline = configRead('LLKA_TAGLINE', 'Leihen statt kaufen')

  cloneOrPull('llka-resomaker', appDir)
  installDeps(appDir)

  const env: Record<string, string> = {
    NEXT_PUBLIC_API_BASE: domain ? `https://${domain}` : 'http://localhost:8090',
    NEXT_PUBLIC_BASE_PATH: '/reservierung',
    NEXT_PUBLIC_BRAND_NAME: appName,
    NEXT_PUBLIC_BRAND_TAGLINE: tagline,
  }

  const s = p.spinner()
  s.start('Building llka-resomaker (this may take a few minutes)...')
  buildApp(appDir, env)
  s.stop('llka-resomaker built')

  // Handle standalone asset copy if needed
  const standaloneDir = resolve(appDir, '.next', 'standalone')
  const staticDir = resolve(standaloneDir, '.next', 'static')
  if (existsSync(standaloneDir) && !existsSync(staticDir)) {
    cpSync(resolve(appDir, '.next', 'static'), staticDir, { recursive: true })
    const publicSrc = resolve(appDir, 'public')
    if (existsSync(publicSrc)) {
      cpSync(publicSrc, resolve(standaloneDir, 'public'), { recursive: true })
    }
  }
}

export function setupApps(): void {
  const components = configRead('LLKA_COMPONENTS', 'leihbackend,llka-verwaltung')

  setupLeihbackend()

  if (components.includes('llka-verwaltung')) {
    setupVerwaltung()
  }

  if (components.includes('llka-resomaker')) {
    setupResomaker()
  }
}
