import { existsSync } from 'fs'
import staticFfmpegPath from 'ffmpeg-static'
import { resolveFfmpegExecutable } from './ffmpegPathCore'

/** Filesystem path safe to pass to child_process.spawn in dev and packaged apps. */
export const ffmpegPath = resolveFfmpegExecutable(
  staticFfmpegPath,
  process.resourcesPath,
  process.platform,
  existsSync
)
