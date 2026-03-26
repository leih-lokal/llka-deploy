import * as p from '@clack/prompts'
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
    p.log.warn('macOS detected. This works for testing but is not recommended')
    p.log.message('  for production. Systemd service registration is not available.')
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

main().catch((err) => {
  p.log.error(err.message ?? String(err))
  process.exit(1)
})
