import * as p from '@clack/prompts'
import { spawn, type ChildProcess } from 'node:child_process'
import { resolve } from 'node:path'
import { INSTALL_DIR, configWrite, configRead } from './config.js'
import { exec } from './utils.js'
import { getPbDir } from './pocketbase.js'

const PB_URL = 'http://127.0.0.1:8090'

let pbProcess: ChildProcess | null = null

const SETTINGS_COLLECTION_SCHEMA = '{"id":"pbc_settings_001","name":"settings","type":"base","system":false,"fields":[{"autogeneratePattern":"[a-z0-9]{15}","hidden":false,"id":"text3208210256","max":15,"min":15,"name":"id","pattern":"^[a-z0-9]+$","presentable":false,"primaryKey":true,"required":true,"system":true,"type":"text"},{"autogeneratePattern":"","hidden":false,"id":"text1847291650","max":0,"min":0,"name":"app_name","pattern":"","presentable":true,"primaryKey":false,"required":false,"system":false,"type":"text"},{"autogeneratePattern":"","hidden":false,"id":"text2938475610","max":0,"min":0,"name":"tagline","pattern":"","presentable":false,"primaryKey":false,"required":false,"system":false,"type":"text"},{"hidden":false,"id":"file4829371056","maxSelect":1,"maxSize":2097152,"mimeTypes":["image/png","image/svg+xml","image/jpeg"],"name":"logo","presentable":false,"protected":false,"required":false,"system":false,"thumbs":[],"type":"file"},{"hidden":false,"id":"file5938271640","maxSelect":1,"maxSize":2097152,"mimeTypes":["image/png","image/svg+xml","image/x-icon","image/vnd.microsoft.icon"],"name":"favicon","presentable":false,"protected":false,"required":false,"system":false,"thumbs":[],"type":"file"},{"autogeneratePattern":"","hidden":false,"id":"text6019384752","max":0,"min":0,"name":"copyright_holder","pattern":"","presentable":false,"primaryKey":false,"required":false,"system":false,"type":"text"},{"hidden":false,"id":"bool7120495863","name":"show_powered_by","presentable":false,"required":false,"system":false,"type":"bool"},{"autogeneratePattern":"","hidden":false,"id":"text8231506974","max":0,"min":0,"name":"primary_color","pattern":"","presentable":false,"primaryKey":false,"required":false,"system":false,"type":"text"},{"autogeneratePattern":"","hidden":false,"id":"text9342618085","max":0,"min":0,"name":"id_format","pattern":"","presentable":false,"primaryKey":false,"required":false,"system":false,"type":"text"},{"hidden":false,"id":"number1053729196","max":null,"min":0,"name":"id_padding","onlyInt":true,"presentable":false,"required":false,"system":false,"type":"number"},{"hidden":false,"id":"bool2164830207","name":"reservations_enabled","presentable":false,"required":false,"system":false,"type":"bool"},{"hidden":false,"id":"bool3275941318","name":"setup_complete","presentable":false,"required":false,"system":false,"type":"bool"},{"hidden":false,"id":"json4386729150","maxSize":2000000,"name":"opening_hours","presentable":false,"required":false,"system":false,"type":"json"},{"hidden":false,"id":"autodate2990389176","name":"created","onCreate":true,"onUpdate":false,"presentable":false,"system":false,"type":"autodate"},{"hidden":false,"id":"autodate3332085495","name":"updated","onCreate":true,"onUpdate":true,"presentable":false,"system":false,"type":"autodate"}],"indexes":[],"listRule":"","viewRule":"","createRule":null,"updateRule":null,"deleteRule":null}'

function startPocketBase(): void {
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

function configureEmailTemplates(token: string): void {
  p.log.info('Configuring email templates...')

  const appName = configRead('LLKA_APP_NAME', 'leih.lokal')
  const domain = configRead('LLKA_DOMAIN', '')
  const appUrl = domain ? `https://${domain}` : 'http://localhost:3000'

  const templates = {
    meta: {
      appName,
      appURL: appUrl,
      senderName: appName,
      senderAddress: `noreply@${domain || 'localhost'}`,
    },
    // Verification email
    verificationTemplate: {
      subject: `${appName} — E-Mail bestätigen / Verify your email`,
      body: `<p>Hallo,</p><p>Bitte bestätigen Sie Ihre E-Mail-Adresse für <strong>${appName}</strong>.</p><p>Please verify your email address for <strong>${appName}</strong>.</p><p><a href="{ACTION_URL}">E-Mail bestätigen / Verify email</a></p><p>Falls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.</p><p>If you did not request this, you can ignore this email.</p><p>— ${appName}</p>`,
      actionURL: `${appUrl}/api/verification/{TOKEN}`,
    },
    // Password reset
    resetPasswordTemplate: {
      subject: `${appName} — Passwort zurücksetzen / Reset your password`,
      body: `<p>Hallo,</p><p>Sie haben ein neues Passwort für <strong>${appName}</strong> angefordert.</p><p>You requested a password reset for <strong>${appName}</strong>.</p><p><a href="{ACTION_URL}">Passwort zurücksetzen / Reset password</a></p><p>Falls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.</p><p>If you did not request this, you can ignore this email.</p><p>— ${appName}</p>`,
      actionURL: `${appUrl}/api/password-reset/{TOKEN}`,
    },
    // Email change confirmation
    confirmEmailChangeTemplate: {
      subject: `${appName} — E-Mail-Änderung bestätigen / Confirm email change`,
      body: `<p>Hallo,</p><p>Bitte bestätigen Sie die Änderung Ihrer E-Mail-Adresse für <strong>${appName}</strong>.</p><p>Please confirm your email change for <strong>${appName}</strong>.</p><p><a href="{ACTION_URL}">E-Mail-Änderung bestätigen / Confirm email change</a></p><p>Falls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.</p><p>If you did not request this, you can ignore this email.</p><p>— ${appName}</p>`,
      actionURL: `${appUrl}/api/confirm-email-change/{TOKEN}`,
    },
  }

  const payload = JSON.stringify(templates)

  try {
    exec(`curl -fsSL "${PB_URL}/api/settings" -X PATCH -H "Content-Type: application/json" -H "Authorization: ${token}" -d '${payload}'`)
    p.log.success('Email templates configured')
  } catch {
    p.log.warn('Could not configure email templates — you can set them manually in LLKA-B admin')
  }
}

export async function runAdminSetup(): Promise<void> {
  startPocketBase()

  try {
    const { email, password } = await promptAdminCredentials()
    createSuperuser(email, password)
    const token = getAuthToken(email, password)
    createSettingsCollection(token)
    seedSettings(token)
    configureEmailTemplates(token)
  } finally {
    stopPocketBase()
  }
}
