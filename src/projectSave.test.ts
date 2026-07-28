import { describe, expect, it, vi } from 'vitest'
import { saveProjectDocument, type ProjectSaveIo } from './projectSave'

function io(saveAsResult: string | null = 'D:/new.alicecut.json'): ProjectSaveIo & {
  writeProject: ReturnType<typeof vi.fn>
  saveProjectAs: ReturnType<typeof vi.fn>
} {
  return {
    writeProject: vi.fn(async () => {}),
    saveProjectAs: vi.fn(async () => saveAsResult)
  }
}

describe('project save semantics', () => {
  it('Save writes the current file directly without opening a picker', async () => {
    const port = io()
    const result = await saveProjectDocument('save', 'D:/current.alicecut.json', '{}', 'untitled.alicecut.json', port)

    expect(port.writeProject).toHaveBeenCalledWith('{}', 'D:/current.alicecut.json')
    expect(port.saveProjectAs).not.toHaveBeenCalled()
    expect(result).toEqual({ saved: true, path: 'D:/current.alicecut.json' })
  })

  it('the first Save opens the picker because no current file exists', async () => {
    const port = io('D:/first.alicecut.json')
    const result = await saveProjectDocument('save', null, '{}', 'untitled.alicecut.json', port)

    expect(port.writeProject).not.toHaveBeenCalled()
    expect(port.saveProjectAs).toHaveBeenCalledWith('{}', 'untitled.alicecut.json')
    expect(result).toEqual({ saved: true, path: 'D:/first.alicecut.json' })
  })

  it('Save As always opens the picker and cancellation preserves the current path', async () => {
    const port = io(null)
    const result = await saveProjectDocument('saveAs', 'D:/current.alicecut.json', '{}', 'ignored.json', port)

    expect(port.writeProject).not.toHaveBeenCalled()
    expect(port.saveProjectAs).toHaveBeenCalledWith('{}', 'D:/current.alicecut.json')
    expect(result).toEqual({ saved: false, path: 'D:/current.alicecut.json' })
  })
})
