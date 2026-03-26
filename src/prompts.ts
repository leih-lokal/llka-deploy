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
