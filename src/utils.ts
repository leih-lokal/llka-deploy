import { execSync, type ExecSyncOptions } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

export function exec(cmd: string, opts?: ExecSyncOptions): string {
  return (execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', ...opts }) as string).trim()
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
