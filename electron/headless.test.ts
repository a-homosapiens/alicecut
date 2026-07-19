import { describe, expect, it } from 'vitest'
import {
  hasExportArg,
  hasSaveProjectArg,
  jobRequestsGpu,
  parseExportArg,
  parseGpuPreference,
  parseSaveProjectArg
} from './headless'

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

  it('keeps GPU disabled when a job cannot be read', () => {
    expect(jobRequestsGpu('Z:\\definitely-missing\\job.json')).toBe(false)
  })

  it('only enables headless GPU acceleration by explicit job opt-in', () => {
    expect(parseGpuPreference('{"gpu":true}')).toBe(true)
    expect(parseGpuPreference('{"gpu":false}')).toBe(false)
    expect(parseGpuPreference('{}')).toBe(false)
    expect(parseGpuPreference('not json')).toBe(false)
  })
})
