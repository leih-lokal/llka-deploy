# llka-deploy TypeScript Rewrite — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite llka-deploy as a TypeScript CLI tool, delivered via `npx llka-deploy`, replacing the bash scripts with a robust, portable Node.js implementation using @clack/prompts for the TUI.

**Architecture:** Single TypeScript CLI package. Each phase of the installer is a module in `src/`. The main entry point orchestrates them in sequence. Templates are bundled in the package. Published to npm as `llka-deploy` so users just run `npx llka-deploy`.

**Tech Stack:** TypeScript, @clack/prompts (TUI), Node.js built-in `child_process` + `fs`, [tsx](https://github.com/privatenumber/tsx) (for dev), [tsup](https://github.com/egoist/tsup) (bundler)

**Repo:** `~/GitRepos/llka-deploy` — delete all existing bash files first, start fresh.

---

## Context

This replaces the bash-based installer. Same functionality, same install target (`~/.leihlokal/`), same phases — just implemented in TypeScript. The bash version had portability issues (bash 3.2 on macOS, gum as a dependency, function-in-subprocess bugs). The TypeScript version solves all of these.

**What the installer does (unchanged):**
1. Welcome screen + existing install detection
2. Component selection (backend always, verwaltung recommended, resomaker optional)
3. Basic config (name, tagline, opening hours, domain)
4. Prerequisites check (git, curl, node 20+, detect bun)
5. Download PocketBase binary for platform
6. Clone & build selected apps
7. Start PocketBase, create superuser, create settings collection, seed config
8. Networking setup (Caddy / Cloudflare Tunnel / manual)
9. Register systemd services (Linux) or print manual commands (macOS)
10. Health check & summary

**Settings collection schema** (needed for seeding in admin.ts — this exact JSON is sent to PocketBase API):
```json
{
  "id": "pbc_settings_001",
  "name": "settings",
  "type": "base",
  "system": false,
  "fields": [
    {"autogeneratePattern":"[a-z0-9]{15}","hidden":false,"id":"text3208210256","max":15,"min":15,"name":"id","pattern":"^[a-z0-9]+$","presentable":false,"primaryKey":true,"required":true,"system":true,"type":"text"},
    {"autogeneratePattern":"","hidden":false,"id":"text1847291650","max":0,"min":0,"name":"app_name","pattern":"","presentable":true,"primaryKey":false,"required":false,"system":false,"type":"text"},
    {"autogeneratePattern":"","hidden":false,"id":"text2938475610","max":0,"min":0,"name":"tagline","pattern":"","presentable":false,"primaryKey":false,"required":false,"system":false,"type":"text"},
    {"hidden":false,"id":"file4829371056","maxSelect":1,"maxSize":2097152,"mimeTypes":["image/png","image/svg+xml","image/jpeg"],"name":"logo","presentable":false,"protected":false,"required":false,"system":false,"thumbs":[],"type":"file"},
    {"hidden":false,"id":"file5938271640","maxSelect":1,"maxSize":2097152,"mimeTypes":["image/png","image/svg+xml","image/x-icon","image/vnd.microsoft.icon"],"name":"favicon","presentable":false,"protected":false,"required":false,"system":false,"thumbs":[],"type":"file"},
    {"autogeneratePattern":"","hidden":false,"id":"text6019384752","max":0,"min":0,"name":"copyright_holder","pattern":"","presentable":false,"primaryKey":false,"required":false,"system":false,"type":"text"},
    {"hidden":false,"id":"bool7120495863","name":"show_powered_by","presentable":false,"required":false,"system":false,"type":"bool"},
    {"autogeneratePattern":"","hidden":false,"id":"text8231506974","max":0,"min":0,"name":"primary_color","pattern":"","presentable":false,"primaryKey":false,"required":false,"system":false,"type":"text"},
    {"autogeneratePattern":"","hidden":false,"id":"text9342618085","max":0,"min":0,"name":"id_format","pattern":"","presentable":false,"primaryKey":false,"required":false,"system":false,"type":"text"},
    {"hidden":false,"id":"number1053729196","max":null,"min":0,"name":"id_padding","onlyInt":true,"presentable":false,"required":false,"system":false,"type":"number"},
    {"hidden":false,"id":"bool2164830207","name":"reservations_enabled","presentable":false,"required":false,"system":false,"type":"bool"},
    {"hidden":false,"id":"bool3275941318","name":"setup_complete","presentable":false,"required":false,"system":false,"type":"bool"},
    {"hidden":false,"id":"json4386729150","maxSize":2000000,"name":"opening_hours","presentable":false,"required":false,"system":false,"type":"json"},
    {"hidden":false,"id":"autodate2990389176","name":"created","onCreate":true,"onUpdate":false,"presentable":false,"system":false,"type":"autodate"},
    {"hidden":false,"id":"autodate3332085495","name":"updated","onCreate":true,"onUpdate":true,"presentable":false,"system":false,"type":"autodate"}
  ],
  "indexes": [],
  "listRule": "",
  "viewRule": "",
  "createRule": null,
  "updateRule": null,
  "deleteRule": null
}
```

**Port assignments:**
- PocketBase: 8090
- llka-verwaltung: 3000
- llka-resomaker: 3001
- Caddy: 80/443

**Opening hours data format:** `[["mon","15:00","19:00"],["thu","15:00","19:00"],...]`

**Install location:** `~/.leihlokal/` with structure:
```
~/.leihlokal/
├── pocketbase/          # PB binary + pb_data + hooks + migrations
├── apps/
│   ├── llka-verwaltung/ # Cloned repo + built app
│   └── llka-resomaker/  # Cloned repo + built app (if selected)
├── caddy/               # Caddy binary + Caddyfile (if using Caddy)
└── config.env           # Saved choices for re-runs/updates
```

**Systemd service templates** use `{{INSTALL_DIR}}` placeholders, rendered at install time. See Task 8 for the exact template contents.

---

## File Map

```
llka-deploy/
├── package.json
├── tsconfig.json
├── tsup.config.ts
├── src/
│   ├── index.ts            # Entry point: welcome, detect existing, route to fresh/update
│   ├── config.ts           # Config read/write (~/.leihlokal/config.env)
│   ├── detect.ts           # OS, arch, runtime, package manager detection
│   ├── prerequisites.ts    # Check git, curl, node 20+, detect bun
│   ├── prompts.ts          # Fresh install prompts (components, name, hours, domain)
│   ├── pocketbase.ts       # Download PB binary for platform
│   ├── apps.ts             # Clone repos, install deps, build Next.js apps
│   ├── admin.ts            # Start PB, create superuser, seed settings
│   ├── networking.ts       # Caddy / Cloudflare Tunnel / manual
│   ├── services.ts         # systemd unit generation + registration
│   ├── update.ts           # Update mode (pull, rebuild, restart)
│   └── utils.ts            # exec helper, retry, template rendering
├── templates/
│   ├── Caddyfile.tmpl
│   ├── leihbackend.service.tmpl
│   ├── llka-verwaltung.service.tmpl
│   ├── llka-resomaker.service.tmpl
│   ├── caddy.service.tmpl
│   └── cloudflared.service.tmpl
└── README.md
```

---

### Task 1: Project scaffolding

**Files:**
- Create: `~/GitRepos/llka-deploy/package.json`
- Create: `~/GitRepos/llka-deploy/tsconfig.json`
- Create: `~/GitRepos/llka-deploy/tsup.config.ts`
- Delete: all bash files (`install.sh`, `setup.sh`, `lib/`)

- [ ] **Step 1: Remove old bash files**

```bash
cd ~/GitRepos/llka-deploy
rm -rf install.sh setup.sh lib/
```

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "llka-deploy",
  "version": "0.1.0",
  "description": "One-command installer for the leih.lokal stack",
  "type": "module",
  "bin": {
    "llka-deploy": "./dist/index.js"
  },
  "files": [
    "dist",
    "templates"
  ],
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsup",
    "prepublishOnly": "npm run build"
  },
  "dependencies": {
    "@clack/prompts": "^0.10.0"
  },
  "devDependencies": {
    "tsup": "^8.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.7.0"
  },
  "keywords": ["leih-lokal", "installer", "pocketbase", "library-of-things"],
  "repository": {
    "type": "git",
    "url": "https://github.com/leih-lokal/llka-deploy"
  },
  "license": "MIT"
}
```

- [ ] **Step 3: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 4: Create `tsup.config.ts`**

```typescript
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  clean: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
})
```

- [ ] **Step 5: Install dependencies**

```bash
cd ~/GitRepos/llka-deploy
npm install
```

- [ ] **Step 6: Commit**

```bash
cd ~/GitRepos/llka-deploy
git add -A
git commit -m "refactor: replace bash scripts with TypeScript CLI scaffolding

Switches from bash + gum to TypeScript + @clack/prompts.
Delivery via npx llka-deploy instead of curl | bash."
```

---

### Task 2: Utilities and config (`src/utils.ts`, `src/config.ts`)

**Files:**
- Create: `~/GitRepos/llka-deploy/src/utils.ts`
- Create: `~/GitRepos/llka-deploy/src/config.ts`

- [ ] **Step 1: Create `src/utils.ts`**

```typescript
import { execSync, type ExecSyncOptions } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function exec(cmd: string, opts?: ExecSyncOptions): string {
  return execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', ...opts }).trim()
}

export function execLive(cmd: string, opts?: ExecSyncOptions): void {
  execSync(cmd, { stdio: 'inherit', ...opts })
}

export function which(cmd: string): boolean {
  try {
    exec(`command -v ${cmd}`)
    return true
  } catch {
    return false
  }
}

export function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
}

export function renderTemplate(templateName: string, vars: Record<string, string>): string {
  // Templates are in ../templates/ relative to dist/index.js,
  // or ../../templates/ when running from src/ via tsx
  let templateDir = resolve(__dirname, '..', 'templates')
  if (!existsSync(templateDir)) {
    templateDir = resolve(__dirname, '..', '..', 'templates')
  }

  const templatePath = resolve(templateDir, templateName)
  let content = readFileSync(templatePath, 'utf-8')

  for (const [key, val] of Object.entries(vars)) {
    content = content.replaceAll(`{{${key}}}`, val)
  }

  return content
}
```

- [ ] **Step 2: Create `src/config.ts`**

```typescript
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { ensureDir } from './utils.js'

export const INSTALL_DIR = resolve(homedir(), '.leihlokal')
export const CONFIG_FILE = resolve(INSTALL_DIR, 'config.env')

export interface Config {
  LLKA_VERSION: string
  LLKA_INSTALL_DIR: string
  LLKA_COMPONENTS: string
  LLKA_APP_NAME: string
  LLKA_TAGLINE: string
  LLKA_OPENING_HOURS: string
  LLKA_DOMAIN: string
  LLKA_NETWORKING: string
  LLKA_RUNTIME: string
  LLKA_ADMIN_EMAIL: string
  LLKA_PB_VERSION: string
  LLKA_OS: string
  LLKA_ARCH: string
}

export function configExists(): boolean {
  return existsSync(CONFIG_FILE)
}

export function configRead(key: string, fallback = ''): string {
  if (!existsSync(CONFIG_FILE)) return fallback
  const content = readFileSync(CONFIG_FILE, 'utf-8')
  const match = content.match(new RegExp(`^${key}=(.*)$`, 'm'))
  return match ? match[1] : fallback
}

export function configWrite(key: string, value: string): void {
  ensureDir(INSTALL_DIR)
  if (!existsSync(CONFIG_FILE)) {
    writeFileSync(CONFIG_FILE, '')
  }

  let content = readFileSync(CONFIG_FILE, 'utf-8')
  const regex = new RegExp(`^${key}=.*$`, 'm')

  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`)
  } else {
    content += `${key}=${value}\n`
  }

  writeFileSync(CONFIG_FILE, content)
}

export function configReadAll(): Partial<Config> {
  if (!existsSync(CONFIG_FILE)) return {}
  const content = readFileSync(CONFIG_FILE, 'utf-8')
  const config: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const match = line.match(/^([^=]+)=(.*)$/)
    if (match) config[match[1]] = match[2]
  }
  return config as Partial<Config>
}
```

- [ ] **Step 3: Commit**

```bash
cd ~/GitRepos/llka-deploy
git add src/
git commit -m "feat: add utilities and config module"
```

---

### Task 3: Detection (`src/detect.ts`)

**Files:**
- Create: `~/GitRepos/llka-deploy/src/detect.ts`

- [ ] **Step 1: Create `src/detect.ts`**

```typescript
import { platform, arch } from 'node:os'
import { which, exec } from './utils.js'

export interface Platform {
  os: 'linux' | 'darwin'
  arch: 'amd64' | 'arm64'
  isMacOS: boolean
  isLinux: boolean
}

export function detectPlatform(): Platform {
  const os = platform()
  const cpuArch = arch()

  if (os !== 'linux' && os !== 'darwin') {
    console.error(`Unsupported OS: ${os}. Use Linux or macOS (or WSL on Windows).`)
    process.exit(1)
  }

  let mappedArch: 'amd64' | 'arm64'
  if (cpuArch === 'x64') mappedArch = 'amd64'
  else if (cpuArch === 'arm64') mappedArch = 'arm64'
  else {
    console.error(`Unsupported architecture: ${cpuArch}`)
    process.exit(1)
  }

  return {
    os,
    arch: mappedArch,
    isMacOS: os === 'darwin',
    isLinux: os === 'linux',
  }
}

export type Runtime = 'bun' | 'node'

export function detectRuntime(): Runtime {
  return which('bun') ? 'bun' : 'node'
}

export function detectPackageManager(): string {
  if (which('apt-get')) return 'apt'
  if (which('dnf')) return 'dnf'
  if (which('brew')) return 'brew'
  if (which('pacman')) return 'pacman'
  return 'unknown'
}

/** PocketBase uses: linux_amd64, darwin_arm64, etc. */
export function pocketbasePlatform(p: Platform): string {
  return `${p.os}_${p.arch}`
}

/** Caddy uses the same naming as PocketBase */
export function caddyPlatform(p: Platform): string {
  return `${p.os}_${p.arch}`
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/GitRepos/llka-deploy
git add src/detect.ts
git commit -m "feat: add platform, runtime, and package manager detection"
```

---

### Task 4: Prerequisites check (`src/prerequisites.ts`)

**Files:**
- Create: `~/GitRepos/llka-deploy/src/prerequisites.ts`

- [ ] **Step 1: Create `src/prerequisites.ts`**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
cd ~/GitRepos/llka-deploy
git add src/prerequisites.ts
git commit -m "feat: add prerequisites check with retry loop"
```

---

### Task 5: Install prompts (`src/prompts.ts`)

**Files:**
- Create: `~/GitRepos/llka-deploy/src/prompts.ts`

- [ ] **Step 1: Create `src/prompts.ts`**

```typescript
import * as p from '@clack/prompts'
import { configWrite } from './config.js'

const WEEKDAYS = [
  { key: 'mon', label: 'Montag / Monday', defaultOpen: '15:00', defaultClose: '19:00', isDefault: true },
  { key: 'tue', label: 'Dienstag / Tuesday', defaultOpen: '09:00', defaultClose: '17:00', isDefault: false },
  { key: 'wed', label: 'Mittwoch / Wednesday', defaultOpen: '09:00', defaultClose: '17:00', isDefault: false },
  { key: 'thu', label: 'Donnerstag / Thursday', defaultOpen: '15:00', defaultClose: '19:00', isDefault: true },
  { key: 'fri', label: 'Freitag / Friday', defaultOpen: '15:00', defaultClose: '19:00', isDefault: true },
  { key: 'sat', label: 'Samstag / Saturday', defaultOpen: '10:00', defaultClose: '14:00', isDefault: true },
  { key: 'sun', label: 'Sonntag / Sunday', defaultOpen: '09:00', defaultClose: '17:00', isDefault: false },
] as const

export interface InstallConfig {
  components: string[]
  appName: string
  tagline: string
  openingHours: [string, string, string][]
  domain: string
}

export async function runPrompts(): Promise<InstallConfig> {
  // --- Component selection ---
  const components = await p.multiselect({
    message: 'Which components do you want to install?',
    options: [
      { value: 'leihbackend', label: 'leihbackend (PocketBase backend)', hint: 'required' },
      { value: 'llka-verwaltung', label: 'llka-verwaltung (Admin UI)', hint: 'recommended' },
      { value: 'llka-resomaker', label: 'llka-resomaker (Public reservation page)', hint: 'optional' },
    ],
    initialValues: ['leihbackend', 'llka-verwaltung'],
    required: true,
  })
  if (p.isCancel(components)) { p.cancel('Setup cancelled.'); process.exit(0) }

  // Ensure backend is always included
  if (!components.includes('leihbackend')) {
    components.unshift('leihbackend')
  }

  configWrite('LLKA_COMPONENTS', components.join(','))

  // --- Basic config ---
  const appName = await p.text({
    message: 'Name of your leih.lokal',
    initialValue: 'leih.lokal',
  })
  if (p.isCancel(appName)) { p.cancel('Setup cancelled.'); process.exit(0) }
  configWrite('LLKA_APP_NAME', appName)

  const tagline = await p.text({
    message: 'Tagline / subtitle',
    initialValue: 'Verwaltungssoftware',
  })
  if (p.isCancel(tagline)) { p.cancel('Setup cancelled.'); process.exit(0) }
  configWrite('LLKA_TAGLINE', tagline)

  // --- Opening hours ---
  p.log.info('Configure your opening hours. Toggle each day on/off.')

  const openingHours: [string, string, string][] = []

  for (const day of WEEKDAYS) {
    const isOpen = await p.confirm({
      message: `${day.label} — open?`,
      initialValue: day.isDefault,
    })
    if (p.isCancel(isOpen)) { p.cancel('Setup cancelled.'); process.exit(0) }

    if (isOpen) {
      const open = await p.text({
        message: `${day.label} — opening time`,
        initialValue: day.defaultOpen,
      })
      if (p.isCancel(open)) { p.cancel('Setup cancelled.'); process.exit(0) }

      const close = await p.text({
        message: `${day.label} — closing time`,
        initialValue: day.defaultClose,
      })
      if (p.isCancel(close)) { p.cancel('Setup cancelled.'); process.exit(0) }

      openingHours.push([day.key, open, close])
    }
  }

  configWrite('LLKA_OPENING_HOURS', JSON.stringify(openingHours))

  // --- Domain ---
  const domain = await p.text({
    message: 'Domain name (leave blank for localhost only)',
    initialValue: '',
  })
  if (p.isCancel(domain)) { p.cancel('Setup cancelled.'); process.exit(0) }
  configWrite('LLKA_DOMAIN', domain || '')

  return {
    components,
    appName,
    tagline,
    openingHours,
    domain: domain || '',
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/GitRepos/llka-deploy
git add src/prompts.ts
git commit -m "feat: add interactive install prompts (components, config, hours, domain)"
```

---

### Task 6: PocketBase download (`src/pocketbase.ts`)

**Files:**
- Create: `~/GitRepos/llka-deploy/src/pocketbase.ts`

- [ ] **Step 1: Create `src/pocketbase.ts`**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
cd ~/GitRepos/llka-deploy
git add src/pocketbase.ts
git commit -m "feat: add PocketBase download and file setup"
```

---

### Task 7: App cloning & building (`src/apps.ts`)

**Files:**
- Create: `~/GitRepos/llka-deploy/src/apps.ts`

- [ ] **Step 1: Create `src/apps.ts`**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
cd ~/GitRepos/llka-deploy
git add src/apps.ts
git commit -m "feat: add app cloning and building"
```

---

### Task 8: Templates

**Files:** Keep existing `templates/` directory — it was not deleted in Task 1 (only `install.sh`, `setup.sh`, `lib/` were removed). Verify the templates are still there.

- [ ] **Step 1: Verify templates exist**

```bash
ls ~/GitRepos/llka-deploy/templates/
```

Expected: `Caddyfile.tmpl`, `caddy.service.tmpl`, `cloudflared.service.tmpl`, `leihbackend.service.tmpl`, `llka-resomaker.service.tmpl`, `llka-verwaltung.service.tmpl`

If they're missing, recreate them. Contents (for reference — these were created in the bash version and should still exist):

`templates/leihbackend.service.tmpl`:
```ini
[Unit]
Description=leih.lokal PocketBase Backend
After=network.target

[Service]
Type=simple
ExecStart={{INSTALL_DIR}}/pocketbase/pocketbase serve --http=0.0.0.0:8090 --dir={{INSTALL_DIR}}/pocketbase/pb_data --hooksDir={{INSTALL_DIR}}/pocketbase/pb_hooks --migrationsDir={{INSTALL_DIR}}/pocketbase/pb_migrations
WorkingDirectory={{INSTALL_DIR}}/pocketbase
Restart=on-failure
RestartSec=5
Environment=DRY_MODE=false

[Install]
WantedBy=default.target
```

`templates/llka-verwaltung.service.tmpl`:
```ini
[Unit]
Description=leih.lokal Admin UI (llka-verwaltung)
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/env node {{INSTALL_DIR}}/apps/llka-verwaltung/.next/standalone/server.js
WorkingDirectory={{INSTALL_DIR}}/apps/llka-verwaltung/.next/standalone
Restart=on-failure
RestartSec=5
Environment=PORT=3000
Environment=HOSTNAME=0.0.0.0

[Install]
WantedBy=default.target
```

`templates/llka-resomaker.service.tmpl`:
```ini
[Unit]
Description=leih.lokal Reservation Frontend (llka-resomaker)
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/env node {{INSTALL_DIR}}/apps/llka-resomaker/.next/standalone/server.js
WorkingDirectory={{INSTALL_DIR}}/apps/llka-resomaker/.next/standalone
Restart=on-failure
RestartSec=5
Environment=PORT=3001
Environment=HOSTNAME=0.0.0.0

[Install]
WantedBy=default.target
```

`templates/caddy.service.tmpl`:
```ini
[Unit]
Description=leih.lokal Caddy Reverse Proxy
After=network.target

[Service]
Type=simple
ExecStart={{INSTALL_DIR}}/caddy/caddy run --config {{INSTALL_DIR}}/caddy/Caddyfile
WorkingDirectory={{INSTALL_DIR}}/caddy
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

`templates/cloudflared.service.tmpl`:
```ini
[Unit]
Description=leih.lokal Cloudflare Tunnel
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/env cloudflared tunnel --config {{INSTALL_DIR}}/cloudflared-config.yml run
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

`templates/Caddyfile.tmpl`:
```
{{DOMAIN}} {
    handle /reservierung/* {
        reverse_proxy localhost:3001
    }

    handle /_/* {
        reverse_proxy localhost:8090
    }

    handle /api/* {
        reverse_proxy localhost:8090
    }

    handle {
        reverse_proxy localhost:3000
    }
}
```

- [ ] **Step 2: No commit needed if templates already exist**

---

### Task 9: Admin setup & seeding (`src/admin.ts`)

**Files:**
- Create: `~/GitRepos/llka-deploy/src/admin.ts`

- [ ] **Step 1: Create `src/admin.ts`**

```typescript
import * as p from '@clack/prompts'
import { resolve } from 'node:path'
import { INSTALL_DIR, configWrite, configRead } from './config.js'
import { exec } from './utils.js'
import { getPbDir } from './pocketbase.js'

const PB_URL = 'http://127.0.0.1:8090'

let pbProcess: ReturnType<typeof import('node:child_process').spawn> | null = null

const SETTINGS_COLLECTION_SCHEMA = '{"id":"pbc_settings_001","name":"settings","type":"base","system":false,"fields":[{"autogeneratePattern":"[a-z0-9]{15}","hidden":false,"id":"text3208210256","max":15,"min":15,"name":"id","pattern":"^[a-z0-9]+$","presentable":false,"primaryKey":true,"required":true,"system":true,"type":"text"},{"autogeneratePattern":"","hidden":false,"id":"text1847291650","max":0,"min":0,"name":"app_name","pattern":"","presentable":true,"primaryKey":false,"required":false,"system":false,"type":"text"},{"autogeneratePattern":"","hidden":false,"id":"text2938475610","max":0,"min":0,"name":"tagline","pattern":"","presentable":false,"primaryKey":false,"required":false,"system":false,"type":"text"},{"hidden":false,"id":"file4829371056","maxSelect":1,"maxSize":2097152,"mimeTypes":["image/png","image/svg+xml","image/jpeg"],"name":"logo","presentable":false,"protected":false,"required":false,"system":false,"thumbs":[],"type":"file"},{"hidden":false,"id":"file5938271640","maxSelect":1,"maxSize":2097152,"mimeTypes":["image/png","image/svg+xml","image/x-icon","image/vnd.microsoft.icon"],"name":"favicon","presentable":false,"protected":false,"required":false,"system":false,"thumbs":[],"type":"file"},{"autogeneratePattern":"","hidden":false,"id":"text6019384752","max":0,"min":0,"name":"copyright_holder","pattern":"","presentable":false,"primaryKey":false,"required":false,"system":false,"type":"text"},{"hidden":false,"id":"bool7120495863","name":"show_powered_by","presentable":false,"required":false,"system":false,"type":"bool"},{"autogeneratePattern":"","hidden":false,"id":"text8231506974","max":0,"min":0,"name":"primary_color","pattern":"","presentable":false,"primaryKey":false,"required":false,"system":false,"type":"text"},{"autogeneratePattern":"","hidden":false,"id":"text9342618085","max":0,"min":0,"name":"id_format","pattern":"","presentable":false,"primaryKey":false,"required":false,"system":false,"type":"text"},{"hidden":false,"id":"number1053729196","max":null,"min":0,"name":"id_padding","onlyInt":true,"presentable":false,"required":false,"system":false,"type":"number"},{"hidden":false,"id":"bool2164830207","name":"reservations_enabled","presentable":false,"required":false,"system":false,"type":"bool"},{"hidden":false,"id":"bool3275941318","name":"setup_complete","presentable":false,"required":false,"system":false,"type":"bool"},{"hidden":false,"id":"json4386729150","maxSize":2000000,"name":"opening_hours","presentable":false,"required":false,"system":false,"type":"json"},{"hidden":false,"id":"autodate2990389176","name":"created","onCreate":true,"onUpdate":false,"presentable":false,"system":false,"type":"autodate"},{"hidden":false,"id":"autodate3332085495","name":"updated","onCreate":true,"onUpdate":true,"presentable":false,"system":false,"type":"autodate"}],"indexes":[],"listRule":"","viewRule":"","createRule":null,"updateRule":null,"deleteRule":null}'

function startPocketBase(): void {
  const { spawn } = require('node:child_process') as typeof import('node:child_process')
  const pbDir = getPbDir()
  const pbBin = resolve(pbDir, 'pocketbase')

  p.log.info('Starting PocketBase...')
  pbProcess = spawn(pbBin, [
    'serve',
    `--dir=${resolve(pbDir, 'pb_data')}`,
    `--hooksDir=${resolve(pbDir, 'pb_hooks')}`,
    `--migrationsDir=${resolve(pbDir, 'pb_migrations')}`,
  ], { stdio: 'ignore', detached: true })

  // Wait for PocketBase to be ready
  let attempts = 0
  while (attempts < 30) {
    try {
      exec(`curl -fsSL ${PB_URL}/api/health`)
      p.log.success(`PocketBase running (PID ${pbProcess.pid})`)
      return
    } catch {
      attempts++
      exec('sleep 1')
    }
  }

  p.log.error('PocketBase failed to start after 30 seconds')
  stopPocketBase()
  process.exit(1)
}

function stopPocketBase(): void {
  if (pbProcess?.pid) {
    try {
      process.kill(pbProcess.pid)
    } catch { /* already dead */ }
    p.log.success('PocketBase stopped')
  }
}

async function promptAdminCredentials(): Promise<{ email: string; password: string }> {
  p.log.info('Create your admin account for PocketBase.')

  const email = await p.text({
    message: 'Admin email',
    initialValue: 'admin@example.com',
    validate: (v) => v.includes('@') ? undefined : 'Must be a valid email',
  })
  if (p.isCancel(email)) { p.cancel('Setup cancelled.'); process.exit(0) }

  const password = await p.password({
    message: 'Admin password (min 8 characters)',
    validate: (v) => v.length >= 8 ? undefined : 'Must be at least 8 characters',
  })
  if (p.isCancel(password)) { p.cancel('Setup cancelled.'); process.exit(0) }

  configWrite('LLKA_ADMIN_EMAIL', email)
  return { email, password }
}

function createSuperuser(email: string, password: string): void {
  const pbDir = getPbDir()
  p.log.info('Creating superuser...')
  try {
    exec(`"${resolve(pbDir, 'pocketbase')}" superuser create "${email}" "${password}" --dir="${resolve(pbDir, 'pb_data')}"`)
  } catch {
    p.log.warn('Superuser may already exist, trying to authenticate...')
  }
  p.log.success('Superuser ready')
}

function getAuthToken(email: string, password: string): string {
  const payload = JSON.stringify({ identity: email, password })
  let response: string

  try {
    response = exec(`curl -fsSL "${PB_URL}/api/collections/_superusers/auth-with-password" -H "Content-Type: application/json" -d '${payload}'`)
  } catch {
    try {
      response = exec(`curl -fsSL "${PB_URL}/api/admins/auth-with-password" -H "Content-Type: application/json" -d '${payload}'`)
    } catch {
      p.log.error('Failed to authenticate. Check your credentials.')
      process.exit(1)
    }
  }

  const tokenMatch = response.match(/"token":"([^"]+)"/)
  if (!tokenMatch) {
    p.log.error('Failed to extract auth token')
    process.exit(1)
  }
  return tokenMatch[1]
}

function createSettingsCollection(token: string): void {
  p.log.info('Creating settings collection...')

  // Check if it exists
  try {
    const status = exec(`curl -fsSL -o /dev/null -w "%{http_code}" "${PB_URL}/api/collections/settings" -H "Authorization: ${token}"`)
    if (status === '200') {
      p.log.success('Settings collection already exists')
      return
    }
  } catch { /* doesn't exist, create it */ }

  const response = exec(`curl -fsSL "${PB_URL}/api/collections" -H "Content-Type: application/json" -H "Authorization: ${token}" -d '${SETTINGS_COLLECTION_SCHEMA}'`)

  if (response.includes('"id"')) {
    p.log.success('Settings collection created')
  } else {
    p.log.error(`Failed to create settings collection: ${response}`)
    process.exit(1)
  }
}

function seedSettings(token: string): void {
  p.log.info('Seeding initial settings...')

  const appName = configRead('LLKA_APP_NAME', 'leih.lokal')
  const tagline = configRead('LLKA_TAGLINE', 'Verwaltungssoftware')
  const openingHours = configRead('LLKA_OPENING_HOURS', '[["mon","15:00","19:00"],["thu","15:00","19:00"],["fri","15:00","19:00"],["sat","10:00","14:00"]]')

  const payload = JSON.stringify({
    app_name: appName,
    tagline,
    opening_hours: JSON.parse(openingHours),
    reservations_enabled: true,
    setup_complete: true,
    show_powered_by: true,
    primary_color: 'oklch(0.515 0.283 27.87)',
    id_format: '#',
    id_padding: 0,
  })

  // Check if record exists
  try {
    const existing = exec(`curl -fsSL "${PB_URL}/api/collections/settings/records?perPage=1" -H "Authorization: ${token}"`)
    const totalMatch = existing.match(/"totalItems":(\d+)/)
    const total = totalMatch ? parseInt(totalMatch[1]) : 0

    if (total > 0) {
      const idMatch = existing.match(/"id":"([^"]+)"/)
      if (idMatch) {
        exec(`curl -fsSL "${PB_URL}/api/collections/settings/records/${idMatch[1]}" -X PATCH -H "Content-Type: application/json" -H "Authorization: ${token}" -d '${payload}'`)
        p.log.success('Settings updated')
        return
      }
    }
  } catch { /* create new */ }

  exec(`curl -fsSL "${PB_URL}/api/collections/settings/records" -H "Content-Type: application/json" -H "Authorization: ${token}" -d '${payload}'`)
  p.log.success('Settings seeded')
}

export async function runAdminSetup(): Promise<void> {
  startPocketBase()

  try {
    const { email, password } = await promptAdminCredentials()
    createSuperuser(email, password)
    const token = getAuthToken(email, password)
    createSettingsCollection(token)
    seedSettings(token)
  } finally {
    stopPocketBase()
  }
}
```

- [ ] **Step 2: Commit**

```bash
cd ~/GitRepos/llka-deploy
git add src/admin.ts
git commit -m "feat: add admin setup, settings collection creation, and seeding"
```

---

### Task 10: Networking (`src/networking.ts`)

**Files:**
- Create: `~/GitRepos/llka-deploy/src/networking.ts`

- [ ] **Step 1: Create `src/networking.ts`**

```typescript
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
```

- [ ] **Step 2: Commit**

```bash
cd ~/GitRepos/llka-deploy
git add src/networking.ts
git commit -m "feat: add networking setup (Caddy, Cloudflare Tunnel, manual)"
```

---

### Task 11: Systemd services (`src/services.ts`)

**Files:**
- Create: `~/GitRepos/llka-deploy/src/services.ts`

- [ ] **Step 1: Create `src/services.ts`**

```typescript
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
  p.log.message(`  # PocketBase`)
  p.log.message(`  ${INSTALL_DIR}/pocketbase/pocketbase serve \\`)
  p.log.message(`    --dir=${INSTALL_DIR}/pocketbase/pb_data \\`)
  p.log.message(`    --hooksDir=${INSTALL_DIR}/pocketbase/pb_hooks \\`)
  p.log.message(`    --migrationsDir=${INSTALL_DIR}/pocketbase/pb_migrations &`)

  if (components.includes('llka-verwaltung')) {
    p.log.message('')
    p.log.message(`  # Admin UI`)
    p.log.message(`  cd ${INSTALL_DIR}/apps/llka-verwaltung/.next/standalone && PORT=3000 node server.js &`)
  }

  if (components.includes('llka-resomaker')) {
    p.log.message('')
    p.log.message(`  # Reservation page`)
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
```

- [ ] **Step 2: Commit**

```bash
cd ~/GitRepos/llka-deploy
git add src/services.ts
git commit -m "feat: add systemd service registration with macOS fallback"
```

---

### Task 12: Update mode (`src/update.ts`)

**Files:**
- Create: `~/GitRepos/llka-deploy/src/update.ts`

- [ ] **Step 1: Create `src/update.ts`**

```typescript
import * as p from '@clack/prompts'
import { rmSync, cpSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { INSTALL_DIR, configRead } from './config.js'
import { exec, ensureDir } from './utils.js'
import { downloadPocketBase } from './pocketbase.js'
import { setupApps } from './apps.js'
import { setupServices, stopAllServices } from './services.js'
import type { Platform } from './detect.js'

export async function runUpdateMode(platform: Platform): Promise<'update' | 'reconfigure' | 'fresh'> {
  p.log.info(`Existing installation found at ${INSTALL_DIR}`)

  const choice = await p.select({
    message: 'What would you like to do?',
    options: [
      { value: 'update', label: 'Update all components' },
      { value: 'reconfigure', label: 'Reconfigure (change settings, domain, etc.)' },
      { value: 'fresh', label: 'Fresh install (wipe and start over)' },
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

  return choice as 'update' | 'reconfigure' | 'fresh'
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
```

- [ ] **Step 2: Commit**

```bash
cd ~/GitRepos/llka-deploy
git add src/update.ts
git commit -m "feat: add update mode (update, reconfigure, fresh install)"
```

---

### Task 13: Main entry point (`src/index.ts`)

**Files:**
- Create: `~/GitRepos/llka-deploy/src/index.ts`

- [ ] **Step 1: Create `src/index.ts`**

```typescript
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
  p.intro('leih.lokal — Library of Things Management System')

  p.log.message('')
  p.log.message('  This installer will set up the full leih.lokal stack:')
  p.log.message('    • PocketBase backend (API & database)')
  p.log.message('    • Admin UI for managing items, customers & rentals')
  p.log.message('    • Optional: public reservation page')
  p.log.message('')
  p.log.message(`  Everything will be installed to ${INSTALL_DIR}`)
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

  // Check PocketBase
  try { exec('curl -fsSL http://localhost:8090/api/health'); p.log.success('PocketBase is running') }
  catch { p.log.warn('PocketBase may still be starting...') }

  // Check verwaltung
  if (components.includes('llka-verwaltung')) {
    try { exec('curl -fsSL http://localhost:3000'); p.log.success('Admin UI is running') }
    catch { p.log.warn('Admin UI may still be starting...') }
  }

  // Check resomaker
  if (components.includes('llka-resomaker')) {
    try { exec('curl -fsSL http://localhost:3001'); p.log.success('Reservation page is running') }
    catch { p.log.warn('Reservation page may still be starting...') }
  }

  // Summary
  const baseUrl = domain ? `https://${domain}` : 'http://localhost'

  p.log.message('')
  p.log.message('  ┌──────────────────────────────────────────┐')
  p.log.message('  │  leih.lokal is running!                  │')
  p.log.message('  │                                          │')
  p.log.message(`  │  PocketBase:   ${baseUrl}:8090/_/`)
  if (components.includes('llka-verwaltung')) {
    p.log.message(`  │  Admin UI:     ${baseUrl}:3000`)
  }
  if (components.includes('llka-resomaker')) {
    p.log.message(`  │  Reservations: ${baseUrl}:3001/reservierung`)
  }
  if (adminEmail) {
    p.log.message('  │                                          │')
    p.log.message(`  │  Admin login:  ${adminEmail}`)
  }
  p.log.message('  └──────────────────────────────────────────┘')

  if (domain && networking !== 'none' && networking !== 'manual') {
    p.log.message('')
    p.log.message('  With your reverse proxy:')
    p.log.message(`    Admin UI:     https://${domain}/`)
    if (components.includes('llka-resomaker')) {
      p.log.message(`    Reservations: https://${domain}/reservierung`)
    }
    p.log.message(`    PocketBase:   https://${domain}/_/`)
  }
}

main().catch((err) => {
  p.log.error(err.message ?? String(err))
  process.exit(1)
})
```

- [ ] **Step 2: Commit**

```bash
cd ~/GitRepos/llka-deploy
git add src/index.ts
git commit -m "feat: add main entry point and health check

Orchestrates: welcome, update detection, prompts, prerequisites,
PocketBase, apps, admin, networking, services, and health check."
```

---

### Task 14: Update README

**Files:**
- Modify: `~/GitRepos/llka-deploy/README.md`

- [ ] **Step 1: Replace README.md**

Replace the entire file with:

```markdown
# LLKA-D (llka-deploy)

One-command installer for the [leih.lokal](https://leihlokal-ka.de) stack — a management system for Libraries of Things (Leihladen).

## Quick Start

```bash
npx llka-deploy
```

## What Gets Installed

| Component | Description | Port |
|-----------|-------------|------|
| **leihbackend** | PocketBase backend (API + database) | 8090 |
| **llka-verwaltung** | Admin UI for managing items, customers, rentals | 3000 |
| **llka-resomaker** | Public reservation page (optional) | 3001 |

Everything is installed to `~/.leihlokal/`.

## Requirements

- **Linux** (recommended) or macOS (testing only — no systemd)
- **Node.js 20+** (Bun auto-detected and preferred if available)
- **git** and **curl**

## What the Installer Does

1. **Component selection** — choose which parts of the stack to install
2. **Configuration** — name, opening hours, domain
3. **Prerequisites check** — verifies git, curl, Node.js
4. **PocketBase** — downloads the latest binary for your platform
5. **Apps** — clones and builds the selected frontend apps
6. **Admin setup** — creates your PocketBase superuser and seeds initial settings
7. **Networking** — optionally sets up Caddy (auto-HTTPS) or Cloudflare Tunnel
8. **Services** — registers systemd user services (Linux) so everything starts on boot

## Updating

Just run it again:

```bash
npx llka-deploy@latest
```

It detects your existing installation and offers to update, reconfigure, or start fresh.

## Networking Options

When you provide a domain name, the installer offers three options:

- **Caddy** (recommended) — downloads Caddy, generates a Caddyfile, handles HTTPS automatically
- **Cloudflare Tunnel** — if you have a Cloudflare account, sets up a tunnel with `cloudflared`
- **Manual** — prints port map and example configs for Caddy and Nginx

## macOS Limitations

macOS works for local testing but is not recommended for production:
- No systemd — services won't auto-start (manual start commands are printed)
- No Cloudflare Tunnel setup
- Caddy works but won't be registered as a service

## Development

```bash
git clone https://github.com/leih-lokal/llka-deploy
cd llka-deploy
npm install
npm run dev    # Run directly via tsx
npm run build  # Build for distribution
```

## Related Repos

- [leihbackend](https://github.com/leih-lokal/leihbackend) — PocketBase backend
- [llka-verwaltung](https://github.com/leih-lokal/llka-verwaltung) — Admin UI
- [llka-resomaker](https://github.com/leih-lokal/llka-resomaker) — Public reservation page
```

- [ ] **Step 2: Commit**

```bash
cd ~/GitRepos/llka-deploy
git add README.md
git commit -m "docs: update README for TypeScript CLI (npx llka-deploy)"
```

---

## Summary

| Task | Files | What |
|------|-------|------|
| 1 | `package.json`, `tsconfig.json`, `tsup.config.ts` | Project scaffolding, remove bash files |
| 2 | `src/utils.ts`, `src/config.ts` | Shell exec, config read/write, template rendering |
| 3 | `src/detect.ts` | OS, arch, runtime, package manager detection |
| 4 | `src/prerequisites.ts` | Check git, curl, node 20+, detect bun |
| 5 | `src/prompts.ts` | Interactive prompts (components, name, hours, domain) |
| 6 | `src/pocketbase.ts` | Download PocketBase binary for platform |
| 7 | `src/apps.ts` | Clone repos, install deps, build Next.js apps |
| 8 | `templates/*` | Verify existing templates (no changes) |
| 9 | `src/admin.ts` | Start PB, create superuser, seed settings |
| 10 | `src/networking.ts` | Caddy / Cloudflare Tunnel / manual |
| 11 | `src/services.ts` | systemd registration + macOS fallback |
| 12 | `src/update.ts` | Update mode (update/reconfigure/fresh) |
| 13 | `src/index.ts` | Main entry point, orchestrates all phases |
| 14 | `README.md` | Updated for `npx llka-deploy` |
