import { useProject } from '../store/project'
import { zh } from './zh'
import { en } from './en'

/** 语言 id：内置 'zh'/'en' 或安装的语言包 id（如 'ja'）。 */
export type Locale = string
export type MsgKey = keyof typeof zh
export type TParams = Record<string, string | number>

interface LangEntry {
  name: string
  strings: Record<string, string>
}

/** 运行时语言注册表：内置 zh/en 预置，语言包导入时注入。 */
const registry = new Map<Locale, LangEntry>([
  ['zh', { name: '中文', strings: zh }],
  ['en', { name: 'English', strings: en }]
])

/** 注册（或覆盖）一种语言；strings 为键→译文（可只含部分键，缺的回退中文）。 */
export function registerLanguage(id: string, name: string, strings: Record<string, string>): void {
  registry.set(id, { name, strings })
}

/** 当前可用语言（内置 + 已安装），供切换 UI 展示。 */
export function availableLanguages(): { id: string; name: string }[] {
  return [...registry.entries()].map(([id, e]) => ({ id, name: e.name }))
}

export function hasLanguage(id: string): boolean {
  return registry.has(id)
}

/** 全部界面键（用于导出语言包模板）。 */
export function allKeys(): MsgKey[] {
  return Object.keys(zh) as MsgKey[]
}

/** 从语言标签（navigator.language / app.getLocale()）推断内置 Locale。 */
export function detectLocale(tag: string | undefined | null): Locale {
  return tag && tag.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/** 取译文：注册表缺键回退中文，再回退键名；{name} 占位插值。 */
export function translate(locale: Locale, key: MsgKey, params?: TParams): string {
  let s = registry.get(locale)?.strings[key] ?? zh[key] ?? String(key)
  if (params) for (const k in params) s = s.split(`{${k}}`).join(String(params[k]))
  return s
}

/** React 钩子：随当前语言变化重渲染。 */
export function useT(): (key: MsgKey, params?: TParams) => string {
  const locale = useProject((s) => s.locale)
  return (key, params) => translate(locale, key, params)
}

/** 该键是否存在（区分内置——有键、可翻译——与插件——无键、回退自带 name）。 */
export function hasMsg(key: string): key is MsgKey {
  return Object.prototype.hasOwnProperty.call(zh, key)
}
