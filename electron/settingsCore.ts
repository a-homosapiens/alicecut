export interface StoredSettings extends Record<string, unknown> {
  locale?: 'zh' | 'en'
  lastProjectDirectory?: string
}

export function parseStoredSettings(text: string): StoredSettings {
  try {
    const value = JSON.parse(text) as unknown
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as StoredSettings) : {}
  } catch {
    return {}
  }
}

export function mergeStoredSettings(current: StoredSettings, patch: Partial<StoredSettings>): StoredSettings {
  return { ...current, ...patch }
}
