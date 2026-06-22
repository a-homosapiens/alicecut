import { registerLanguage, allKeys } from './index'
import { en } from './en'

/**
 * 语言包（纯数据 JSON，无代码 → 无需沙箱）：
 *   { "id": "ja", "name": "日本語", "strings": { "<键>": "<译文>", ... } }
 * 缺失的键由 translate 回退到中文，故部分翻译的包也能用。
 * 安装的包持久化在 localStorage（应用级偏好，不写入工程文件）。
 */
export interface LanguagePack {
  id: string
  name: string
  strings: Record<string, string>
}

const PACKS_KEY = 'dlv.languages'
const LOCALE_KEY = 'dlv.locale'

/** 解析并校验语言包文本；非法抛出可读错误。 */
export function parseLanguagePack(text: string): LanguagePack {
  let o: unknown
  try {
    o = JSON.parse(text)
  } catch {
    throw new Error('不是有效的 JSON')
  }
  if (!o || typeof o !== 'object') throw new Error('语言包应为 JSON 对象')
  const m = o as Record<string, unknown>
  if (typeof m.id !== 'string' || !m.id) throw new Error('缺少 id')
  if (typeof m.name !== 'string' || !m.name) throw new Error('缺少 name')
  if (!m.strings || typeof m.strings !== 'object') throw new Error('缺少 strings')
  const strings: Record<string, string> = {}
  for (const [k, v] of Object.entries(m.strings as Record<string, unknown>)) {
    if (typeof v === 'string') strings[k] = v
  }
  if (Object.keys(strings).length === 0) throw new Error('strings 为空')
  return { id: m.id, name: m.name, strings }
}

function readPacks(): LanguagePack[] {
  try {
    const raw = localStorage.getItem(PACKS_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((p) => p && typeof p.id === 'string' && p.strings) : []
  } catch {
    return []
  }
}

function writePacks(packs: LanguagePack[]): void {
  try {
    localStorage.setItem(PACKS_KEY, JSON.stringify(packs))
  } catch {
    /* 忽略存储失败（隐私模式等） */
  }
}

/** 注册并持久化一个语言包（按 id 去重覆盖）。 */
export function installPack(pack: LanguagePack): void {
  registerLanguage(pack.id, pack.name, pack.strings)
  writePacks([...readPacks().filter((p) => p.id !== pack.id), pack])
}

/** 启动时把已安装的语言包注册进注册表。 */
export function registerStoredPacks(): void {
  for (const p of readPacks()) registerLanguage(p.id, p.name, p.strings)
}

/** 记住 / 读取上次选择的语言。 */
export function saveLocalePref(locale: string): void {
  try {
    localStorage.setItem(LOCALE_KEY, locale)
  } catch {
    /* 忽略 */
  }
}
export function loadLocalePref(): string | null {
  try {
    return localStorage.getItem(LOCALE_KEY)
  } catch {
    return null
  }
}

/** 生成语言包模板：含全部界面键、以英文为初值，供翻译者/agent 填写。 */
export function makeTemplate(): string {
  const strings: Record<string, string> = {}
  for (const k of allKeys()) strings[k] = en[k]
  return JSON.stringify({ id: '', name: '', strings }, null, 2)
}
