import { describe, expect, it, beforeEach } from 'vitest'
import { useProject } from './project'

const LRC = '[00:01.00]hello\n[00:03.00]world'

describe('撤销 / 重做', () => {
  beforeEach(() => {
    useProject.getState().loadLrc(LRC, 'x.lrc') // 载入会清空历史
  })

  it('载入后历史为空，undo 安全无操作', () => {
    expect(useProject.getState().past.length).toBe(0)
    const before = useProject.getState().lines.length
    useProject.getState().undo()
    expect(useProject.getState().lines.length).toBe(before)
  })

  it('编辑后可 undo 还原、redo 重做', () => {
    const before = useProject.getState().lines.length
    useProject.getState().addLineAt(5000, 'lyric', '新词')
    expect(useProject.getState().lines.length).toBe(before + 1)
    expect(useProject.getState().past.length).toBe(1)

    useProject.getState().undo()
    expect(useProject.getState().lines.length).toBe(before)
    expect(useProject.getState().future.length).toBe(1)

    useProject.getState().redo()
    expect(useProject.getState().lines.length).toBe(before + 1)
  })

  it('新编辑作废 redo 栈', () => {
    useProject.getState().addLineAt(5000, 'text', 'a')
    useProject.getState().undo()
    expect(useProject.getState().future.length).toBe(1)
    useProject.getState().addLineAt(6000, 'text', 'b')
    expect(useProject.getState().future.length).toBe(0) // 新编辑清空 redo
  })
})
