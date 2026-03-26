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
