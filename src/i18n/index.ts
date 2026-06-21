import { useProject } from '../store/project'
import { zh } from './zh'
import { en } from './en'

export type Locale = 'zh' | 'en'
export type MsgKey = keyof typeof zh
export type TParams = Record<string, string | number>

/** 可选语言（供切换 UI 展示） */
export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' }
]

const dicts: Record<Locale, Record<string, string>> = { zh, en }

/** 从语言标签（如 navigator.language / app.getLocale()）推断我们的 Locale */
export function detectLocale(tag: string | undefined | null): Locale {
  return tag && tag.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

/** 取译文：缺失键回退到中文再回退到键本身；{name} 占位符插值 */
export function translate(locale: Locale, key: MsgKey, params?: TParams): string {
  let s = dicts[locale]?.[key] ?? zh[key] ?? String(key)
  if (params) for (const k in params) s = s.split(`{${k}}`).join(String(params[k]))
  return s
}

/** React 钩子：随当前语言变化重渲染 */
export function useT(): (key: MsgKey, params?: TParams) => string {
  const locale = useProject((s) => s.locale)
  return (key, params) => translate(locale, key, params)
}
