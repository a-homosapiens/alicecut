// 插件校验 CLI：node scripts/validate-plugin.ts <plugin.mjs>
// 第三方/agent 写完插件后跑它自检（确定性/范围/性能/纯净度/不崩）。
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validatePlugin } from '../src/core/effects/validator.ts'

const file = process.argv[2]
if (!file) {
  console.error('用法: node scripts/validate-plugin.ts <plugin.mjs>')
  process.exit(2)
}

const abs = resolve(file)
const source = await readFile(abs, 'utf-8')
const mod = await import(pathToFileURL(abs).href)
const report = validatePlugin(mod.default, source)

console.log(`\n插件: ${report.pluginName} · ${report.effectCount} 个文字特效`)
if (report.sample.length) {
  console.log('样例输出:')
  for (const s of report.sample) console.log('  ' + s)
}
for (const it of report.issues) {
  const tag = it.level === 'error' ? '✗ 错误' : '⚠ 警告'
  console.log(`${tag}${it.effect ? ` [${it.effect}]` : ''}: ${it.message}`)
}
console.log(report.ok ? '\n✓ 通过（无致命错误）\n' : '\n✗ 未通过\n')
process.exit(report.ok ? 0 : 1)
