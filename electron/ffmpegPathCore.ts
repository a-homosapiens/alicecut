import { posix, win32 } from 'path'

type PathExists = (path: string) => boolean

/**
 * Electron can resolve an unpacked dependency through app.asar even though a
 * native process cannot be spawned from inside the archive. Prefer the real
 * app.asar.unpacked location and keep the development path as a fallback.
 */
export function ffmpegPathCandidates(
  importedPath: string | null,
  resourcesPath: string,
  platform: NodeJS.Platform
): string[] {
  const pathApi = platform === 'win32' ? win32 : posix
  const executable = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const unpackedImportedPath = importedPath?.replace(
    /([\\/])app\.asar([\\/])/,
    '$1app.asar.unpacked$2'
  ) ?? null
  const packagedPath = pathApi.join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    'ffmpeg-static',
    executable
  )

  return [...new Set([unpackedImportedPath, packagedPath, importedPath].filter(
    (candidate): candidate is string => Boolean(candidate)
  ))]
}

export function resolveFfmpegExecutable(
  importedPath: string | null,
  resourcesPath: string,
  platform: NodeJS.Platform,
  exists: PathExists
): string | null {
  return ffmpegPathCandidates(importedPath, resourcesPath, platform).find(exists) ?? null
}
