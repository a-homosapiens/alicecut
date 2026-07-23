import { beforeEach, describe, expect, it } from 'vitest'
import { runConsoleCommand } from './consoleCommand'
import { useProject } from './store/project'

const LRC = '[00:01.00]hello\n[00:03.00]world'

describe('caption selection console commands', () => {
  beforeEach(() => {
    useProject.getState().loadLrc(LRC, 'test.lrc')
    useProject.getState().addLineAt(500, 'text', 'Title')
  })

  it('selects every caption and batch-applies in/out effects and style', async () => {
    const logs: string[] = []
    await runConsoleCommand(
      JSON.stringify({
        select: 'captions',
        effectIn: 'rise',
        effectOut: 'pop',
        effectInDuration: 1.5,
        effectOutDuration: 1,
        selectedStyle: { fontSize: 108, textColor: '#ffd400' }
      }),
      (message) => logs.push(message)
    )

    const state = useProject.getState()
    const captions = state.lines.filter((line) => line.kind !== 'text')
    const title = state.lines.find((line) => line.kind === 'text')!
    expect(state.selectedIds).toEqual(captions.map((line) => line.id))
    expect(captions.every((line) => line.effectId === 'rise')).toBe(true)
    expect(captions.every((line) => line.effectOutId === 'pop')).toBe(true)
    // The first caption is 2s long. Both values arrived in one command, so In
    // keeps 1.5s and Out is shortened to the remaining 0.5s.
    expect(captions[0].effectInDurationMs).toBe(1500)
    expect(captions[0].effectOutDurationMs).toBe(500)
    expect(captions.every((line) => line.over?.fontSize === 108 && line.over.textColor === '#ffd400')).toBe(true)
    expect(title.effectId).toBeNull()
    expect(title.over).toBeUndefined()
    expect(logs.some((line) => line.startsWith('✗'))).toBe(false)
  })
})
