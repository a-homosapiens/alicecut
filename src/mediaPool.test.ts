import { describe, expect, it } from 'vitest'
import { mediaUrl } from './mediaPool'

describe('mediaUrl', () => {
  it('creates a standard hosted URL for Windows paths and Unicode filenames', () => {
    expect(mediaUrl('D:\\media\\拟古 (Add Vocal).mp3')).toBe(
      'media://local/D%3A/media/%E6%8B%9F%E5%8F%A4%20(Add%20Vocal).mp3'
    )
  })
})
