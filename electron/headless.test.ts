import { describe, expect, it } from 'vitest'
import { hasExportArg, hasSaveProjectArg, parseExportArg, parseSaveProjectArg } from './headless'

describe('headless CLI args', () => {
  it('parses explicit job paths', () => {
    const argv = ['electron', '.', '--export', 'render.job.json', '--save-project', 'project.job.json']

    expect(parseExportArg(argv)).toBe('render.job.json')
    expect(hasExportArg(argv)).toBe(true)
    expect(hasSaveProjectArg(argv)).toBe(true)
    expect(parseSaveProjectArg(argv)).toBe('project.job.json')
  })

  it('does not treat another flag as the --save-project job path', () => {
    const argv = ['electron', '.', '--save-project', '--export', 'job.json']

    expect(hasSaveProjectArg(argv)).toBe(true)
    expect(parseSaveProjectArg(argv)).toBeNull()
    expect(hasExportArg(argv)).toBe(true)
    expect(parseExportArg(argv)).toBe('job.json')
  })

  it('keeps --save-project without a value visible to callers', () => {
    const argv = ['electron', '.', '--export', 'job.json', '--save-project']

    expect(hasSaveProjectArg(argv)).toBe(true)
    expect(parseSaveProjectArg(argv)).toBeNull()
  })
})
