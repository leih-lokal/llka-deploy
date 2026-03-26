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
