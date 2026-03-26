import * as p from '@clack/prompts'
import { rmSync, cpSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { INSTALL_DIR, configRead } from './config.js'
import { exec, ensureDir } from './utils.js'
import { downloadPocketBase } from './pocketbase.js'
import { setupApps } from './apps.js'
import { setupServices, stopAllServices, unregisterAllServices } from './services.js'
import type { Platform } from './detect.js'

export async function runUpdateMode(platform: Platform): Promise<'update' | 'reconfigure' | 'fresh' | 'uninstall'> {
  p.log.info(`Existing installation found at ${INSTALL_DIR}`)

  const choice = await p.select({
    message: 'What would you like to do?',
    options: [
      { value: 'update', label: 'Update all components' },
      { value: 'reconfigure', label: 'Reconfigure (change settings, domain, etc.)' },
      { value: 'fresh', label: 'Fresh install (wipe and start over)' },
      { value: 'uninstall', label: 'Uninstall (remove everything)', hint: 'stops services, deletes all data' },
    ],
  })
  if (p.isCancel(choice)) { p.cancel('Setup cancelled.'); process.exit(0) }

  if (choice === 'update') {
    await performUpdate(platform)
  }

  if (choice === 'fresh') {
    const sure = await p.confirm({
      message: `This will DELETE everything in ${INSTALL_DIR}. Are you sure?`,
    })
    if (p.isCancel(sure) || !sure) {
      p.log.info('Cancelled.')
      process.exit(0)
    }

    stopAllServices(platform)

    // Preserve llka-deploy repo if it's inside the install dir
    const deployDir = resolve(INSTALL_DIR, 'llka-deploy')
    const tmpDir = exec('mktemp -d')
    if (existsSync(deployDir)) {
      cpSync(deployDir, resolve(tmpDir, 'llka-deploy'), { recursive: true })
    }

    rmSync(INSTALL_DIR, { recursive: true, force: true })
    ensureDir(INSTALL_DIR)

    if (existsSync(resolve(tmpDir, 'llka-deploy'))) {
      cpSync(resolve(tmpDir, 'llka-deploy'), deployDir, { recursive: true })
    }
    rmSync(tmpDir, { recursive: true, force: true })
  }

  if (choice === 'uninstall') {
    await performUninstall(platform)
  }

  return choice as 'update' | 'reconfigure' | 'fresh' | 'uninstall'
}

async function performUninstall(platform: Platform): Promise<void> {
  p.log.warn(`This will completely remove your leih.lokal installation.`)
  p.log.message('')
  p.log.message(`  What will be deleted:`)
  p.log.message(`    • All services (stopped and deregistered)`)
  p.log.message(`    • All app data, configs, and databases`)
  p.log.message(`    • Everything in ${INSTALL_DIR}`)
  p.log.message('')

  const confirm1 = await p.confirm({
    message: 'Are you sure you want to uninstall?',
    initialValue: false,
  })
  if (p.isCancel(confirm1) || !confirm1) {
    p.log.info('Uninstall cancelled.')
    process.exit(0)
  }

  const confirm2 = await p.text({
    message: `Type "uninstall" to confirm`,
    validate: (v) => v === 'uninstall' ? undefined : 'Type "uninstall" to proceed',
  })
  if (p.isCancel(confirm2)) {
    p.log.info('Uninstall cancelled.')
    process.exit(0)
  }

  // 1. Stop and deregister all services
  p.log.step('Stopping and deregistering services...')
  unregisterAllServices(platform)

  // 2. Remove the install directory
  p.log.step(`Removing ${INSTALL_DIR}...`)
  rmSync(INSTALL_DIR, { recursive: true, force: true })
  p.log.success(`Removed ${INSTALL_DIR}`)

  p.log.message('')
  p.log.message('  leih.lokal has been completely uninstalled.')
  p.log.message('  To reinstall, run: npx llka-deploy')
  p.log.message('')

  p.outro('Uninstall complete.')
  process.exit(0)
}

async function performUpdate(platform: Platform): Promise<void> {
  const os = configRead('LLKA_OS', platform.os) as 'linux' | 'darwin'
  const arch = configRead('LLKA_ARCH', platform.arch) as 'amd64' | 'arm64'

  p.log.info('Updating all components...')

  const checkResult = await import('./prerequisites.js')
  await checkResult.checkPrerequisites()

  await downloadPocketBase({ os, arch, isMacOS: os === 'darwin', isLinux: os === 'linux' })
  setupApps()
  setupServices(platform)
}
