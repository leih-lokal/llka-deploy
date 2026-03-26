import * as p from '@clack/prompts'
import { which, exec } from './utils.js'
import { configWrite } from './config.js'
import { detectRuntime, detectPackageManager } from './detect.js'

export async function checkPrerequisites(): Promise<void> {
  const missing: string[] = []
  const pkgMgr = detectPackageManager()

  // git
  if (which('git')) {
    const version = exec('git --version').split(' ')[2]
    p.log.success(`git ${version}`)
  } else {
    missing.push('git')
  }

  // curl
  if (which('curl')) {
    p.log.success('curl found')
  } else {
    missing.push('curl')
  }

  // Node.js 20+
  if (which('node')) {
    const version = exec('node -v').replace('v', '')
    const major = parseInt(version.split('.')[0])
    if (major >= 20) {
      p.log.success(`node v${version}`)
    } else {
      p.log.warn(`node v${version} found, but v20+ required`)
      missing.push('node')
    }
  } else {
    missing.push('node')
  }

  // bun (optional)
  const runtime = detectRuntime()
  if (runtime === 'bun') {
    const bunVersion = exec('bun --version')
    p.log.success(`bun ${bunVersion} detected — will use for faster builds`)
  }
  configWrite('LLKA_RUNTIME', runtime)

  if (missing.length > 0) {
    p.log.error(`Missing required tools: ${missing.join(', ')}`)
    p.log.message('')
    p.log.message('Install them for your system:')
    p.log.message('')
    for (const tool of missing) {
      printInstallHint(tool, pkgMgr)
    }

    const retry = await p.confirm({ message: 'Retry after installing?' })
    if (p.isCancel(retry) || !retry) {
      p.cancel(`Cannot continue without: ${missing.join(', ')}`)
      process.exit(1)
    }
    return checkPrerequisites()
  }

  p.log.success('All prerequisites met')
}

function printInstallHint(tool: string, pkgMgr: string): void {
  const hints: Record<string, Record<string, string>> = {
    git: {
      apt: '  sudo apt install git',
      dnf: '  sudo dnf install git',
      brew: '  brew install git',
      pacman: '  sudo pacman -S git',
      unknown: '  Install git from https://git-scm.com',
    },
    curl: {
      apt: '  sudo apt install curl',
      dnf: '  sudo dnf install curl',
      brew: '  brew install curl',
      pacman: '  sudo pacman -S curl',
      unknown: '  Install curl from https://curl.se',
    },
    node: {
      apt: '  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs',
      dnf: '  sudo dnf module install nodejs:20',
      brew: '  brew install node@20',
      pacman: '  sudo pacman -S nodejs npm',
      unknown: '  https://nodejs.org/en/download',
    },
  }

  const hint = hints[tool]?.[pkgMgr] ?? hints[tool]?.unknown ?? `  Install ${tool}`
  if (tool === 'node') {
    p.log.message('  Recommended: install via nvm')
    p.log.message('  curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash')
    p.log.message('  nvm install 20')
    p.log.message('')
    p.log.message('  Or via package manager:')
  }
  p.log.message(hint)
}
