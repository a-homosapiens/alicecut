export type ProjectSaveMode = 'save' | 'saveAs'

export interface ProjectSaveIo {
  writeProject(json: string, path: string): Promise<void>
  saveProjectAs(json: string, defaultPath: string): Promise<string | null>
}

export interface ProjectSaveResult {
  saved: boolean
  /** The active path after the operation. Unchanged when Save As is cancelled. */
  path: string | null
}

/** Keep Save and Save As semantics independent from React and Electron UI code. */
export async function saveProjectDocument(
  mode: ProjectSaveMode,
  currentPath: string | null,
  json: string,
  defaultName: string,
  io: ProjectSaveIo
): Promise<ProjectSaveResult> {
  if (mode === 'save' && currentPath) {
    await io.writeProject(json, currentPath)
    return { saved: true, path: currentPath }
  }

  const path = await io.saveProjectAs(json, currentPath ?? defaultName)
  return path ? { saved: true, path } : { saved: false, path: currentPath }
}
