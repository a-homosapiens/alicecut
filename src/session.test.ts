import { describe, expect, it } from 'vitest'
import { serializeProject } from './session'

describe('serializeProject（会话/工程序列化）', () => {
  it('产出 v2 结构，clips 去掉运行时 id', () => {
    const s = {
      meta: { offset: 0 },
      lines: [{ id: 1, text: 'hi' }],
      style: { effectId: 'pop' },
      lrcName: 'a.lrc',
      clips: [{ id: 9, kind: 'audio', path: 'x', name: 'x', start: 0 }]
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out = serializeProject(s as any) as any
    expect(out.version).toBe(2)
    expect(out.lrcName).toBe('a.lrc')
    expect(out.lines).toBe(s.lines)
    expect(out.clips[0].id).toBeUndefined()
    expect(out.clips[0].path).toBe('x')
  })
})
