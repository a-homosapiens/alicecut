import { posix, win32 } from 'path'

type Exists = (path: string) => boolean
type JsonRecord = Record<string, unknown>

function object(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function pathApi(platform: NodeJS.Platform): typeof win32 | typeof posix {
  return platform === 'win32' ? win32 : posix
}

function isPortableRelative(path: string): boolean {
  return path.length > 0 && !win32.isAbsolute(path) && !posix.isAbsolute(path)
}

function portableRelativePath(projectFilePath: string, target: unknown, platform: NodeJS.Platform): string | null {
  if (typeof target !== 'string' || !target) return null
  if (isPortableRelative(target)) return target.replace(/\\/g, '/')
  const api = pathApi(platform)
  if (!api.isAbsolute(target)) return null
  const relative = api.relative(api.dirname(projectFilePath), target)
  if (!relative || api.isAbsolute(relative)) return null
  return relative.replace(/\\/g, '/')
}

function resolvedPath(
  projectFilePath: string,
  stored: unknown,
  relative: unknown,
  platform: NodeJS.Platform,
  exists: Exists
): string | null {
  const api = pathApi(platform)
  const storedPath = typeof stored === 'string' && stored ? stored : null
  const relativePath = typeof relative === 'string' && isPortableRelative(relative)
    ? relative
    : storedPath && isPortableRelative(storedPath) ? storedPath : null
  const candidate = relativePath
    ? api.resolve(api.dirname(projectFilePath), relativePath.replace(/[\\/]/g, api.sep))
    : null

  // Prefer the project-relative copy after a folder is moved. If it is absent,
  // retain compatibility with the original absolute location.
  if (candidate && exists(candidate)) return candidate
  if (storedPath && exists(storedPath)) return storedPath
  return candidate ?? storedPath
}

function addRelativeField(
  value: JsonRecord,
  key: string,
  relativeKey: string,
  projectFilePath: string,
  platform: NodeJS.Platform
): JsonRecord {
  const copy = { ...value }
  const relative = portableRelativePath(projectFilePath, value[key], platform)
  if (relative) copy[relativeKey] = relative
  else delete copy[relativeKey]
  return copy
}

function resolveRelativeField(
  value: JsonRecord,
  key: string,
  relativeKey: string,
  projectFilePath: string,
  platform: NodeJS.Platform,
  exists: Exists
): JsonRecord {
  const copy = { ...value }
  const path = resolvedPath(projectFilePath, value[key], value[relativeKey], platform, exists)
  if (path) copy[key] = path
  delete copy[relativeKey]
  return copy
}

/** Add portable path metadata without removing absolute-path fallbacks. */
export function addRelativeProjectPaths(
  value: unknown,
  projectFilePath: string,
  platform: NodeJS.Platform = process.platform
): unknown {
  const source = object(value)
  if (!source) return value
  const root: JsonRecord = { ...source, version: 6 }

  const style = object(source.style)
  if (style) root.style = addRelativeField(style, 'bgImage', 'bgImageRelativePath', projectFilePath, platform)

  if (Array.isArray(source.images)) {
    root.images = source.images.map((item) => {
      const image = object(item)
      return image ? addRelativeField(image, 'path', 'relativePath', projectFilePath, platform) : item
    })
  }

  if (Array.isArray(source.clips)) {
    root.clips = source.clips.map((item) => {
      const clip = object(item)
      if (!clip) return item
      return addRelativeField(
        addRelativeField(clip, 'path', 'relativePath', projectFilePath, platform),
        'sourcePath',
        'relativeSourcePath',
        projectFilePath,
        platform
      )
    })
  }
  return root
}

/** Resolve relative metadata against the selected project file before hydration. */
export function resolveRelativeProjectPaths(
  value: unknown,
  projectFilePath: string,
  exists: Exists,
  platform: NodeJS.Platform = process.platform
): unknown {
  const source = object(value)
  if (!source) return value
  const root: JsonRecord = { ...source }

  const style = object(source.style)
  if (style) {
    root.style = resolveRelativeField(
      style,
      'bgImage',
      'bgImageRelativePath',
      projectFilePath,
      platform,
      exists
    )
  }

  if (Array.isArray(source.images)) {
    root.images = source.images.map((item) => {
      const image = object(item)
      return image
        ? resolveRelativeField(image, 'path', 'relativePath', projectFilePath, platform, exists)
        : item
    })
  }

  if (Array.isArray(source.clips)) {
    root.clips = source.clips.map((item) => {
      const clip = object(item)
      if (!clip) return item
      return resolveRelativeField(
        resolveRelativeField(clip, 'path', 'relativePath', projectFilePath, platform, exists),
        'sourcePath',
        'relativeSourcePath',
        projectFilePath,
        platform,
        exists
      )
    })
  }
  return root
}

export function portableProjectJson(
  json: string,
  projectFilePath: string,
  platform: NodeJS.Platform = process.platform
): string {
  return JSON.stringify(addRelativeProjectPaths(JSON.parse(json), projectFilePath, platform), null, 2)
}

export function resolvedProjectJson(
  json: string,
  projectFilePath: string,
  exists: Exists,
  platform: NodeJS.Platform = process.platform
): string {
  return JSON.stringify(resolveRelativeProjectPaths(JSON.parse(json), projectFilePath, exists, platform), null, 2)
}
