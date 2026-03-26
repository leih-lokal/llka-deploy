import * as p from '@clack/prompts'
import { existsSync, mkdirSync, cpSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { INSTALL_DIR, configWrite, configRead } from './config.js'
import { exec, ensureDir } from './utils.js'
import type { Platform } from './detect.js'
import { pocketbasePlatform } from './detect.js'

const PB_DIR = resolve(INSTALL_DIR, 'pocketbase')

export function getPbDir(): string {
  return PB_DIR
}

export async function downloadPocketBase(platform: Platform): Promise<void> {
  const pbPlatform = pocketbasePlatform(platform)

  // Get latest version
  p.log.info('Fetching latest PocketBase version...')
  const releaseJson = exec('curl -fsSL https://api.github.com/repos/pocketbase/pocketbase/releases/latest')
  const match = releaseJson.match(/"tag_name":\s*"v([^"]+)"/)
  if (!match) {
    p.log.error('Could not determine latest PocketBase version')
    process.exit(1)
  }
  const version = match[1]

  // Check if already installed at this version
  if (existsSync(resolve(PB_DIR, 'pocketbase'))) {
    try {
      const current = exec(`${resolve(PB_DIR, 'pocketbase')} --version`).match(/[\d.]+/)?.[0]
      if (current === version) {
        p.log.success(`PocketBase v${version} already installed`)
        configWrite('LLKA_PB_VERSION', version)
        return
      }
    } catch { /* continue to download */ }
  }

  ensureDir(PB_DIR)

  const zipName = `pocketbase_${version}_${pbPlatform}.zip`
  const url = `https://github.com/pocketbase/pocketbase/releases/download/v${version}/${zipName}`

  const s = p.spinner()
  s.start(`Downloading PocketBase v${version}...`)

  const tmpDir = exec('mktemp -d')
  try {
    exec(`curl -fsSL "${url}" -o "${tmpDir}/${zipName}"`)

    // Unzip
    try {
      exec(`unzip -qo "${tmpDir}/${zipName}" -d "${tmpDir}/pb"`)
    } catch {
      exec(`python3 -c "import zipfile; zipfile.ZipFile('${tmpDir}/${zipName}').extractall('${tmpDir}/pb')"`)
    }

    exec(`mv "${tmpDir}/pb/pocketbase" "${PB_DIR}/pocketbase"`)
    exec(`chmod +x "${PB_DIR}/pocketbase"`)
  } finally {
    rmSync(tmpDir, { recursive: true, force: true })
  }

  s.stop(`PocketBase v${version} installed`)
  configWrite('LLKA_PB_VERSION', version)
}

export function setupPocketBaseFiles(backendDir: string): void {
  const hooksDir = resolve(PB_DIR, 'pb_hooks')
  const migrationsDir = resolve(PB_DIR, 'pb_migrations')

  // Remove old and copy fresh
  rmSync(hooksDir, { recursive: true, force: true })
  cpSync(resolve(backendDir, 'pb_hooks'), hooksDir, { recursive: true })
  p.log.success('Copied pb_hooks')

  rmSync(migrationsDir, { recursive: true, force: true })
  cpSync(resolve(backendDir, 'pb_migrations'), migrationsDir, { recursive: true })
  p.log.success('Copied pb_migrations')
}
