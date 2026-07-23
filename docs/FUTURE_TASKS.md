# Future tasks

## Advanced media relinking and project collection

Project format v6 already stores original absolute paths and paths relative to the `.alicecut.json` file, preferring the portable relative copy when a project folder moves. The remaining work is an industry-style recovery and project-collection workflow for resources that were moved independently, renamed, ambiguous, or not copied with the project.

### Project metadata

For each referenced resource, save enough identity metadata to distinguish the intended file from an unrelated file with the same name:

- original absolute path (implemented in v6);
- path relative to the project file (implemented in v6);
- filename, byte size, media duration, media kind, and relevant stream properties;
- stable content fingerprint or checksum;
- optional asset ID for future media-library or MAM integration;
- last successfully resolved path.

Maintain backward compatibility with existing projects that contain only `path`.

### Resolution order when opening a project

Resolve every media reference in this order:

1. project-relative path;
2. last-known or original absolute path;
3. files beside the project and inside a conventional `Media/` directory;
4. user-configured media search folders;
5. filename, size, duration, and stream-metadata candidates;
6. fingerprint confirmation when a candidate is ambiguous;
7. manual **Locate missing media** dialog.

Locating one missing file should optionally relink other missing resources found in the same folder. Never silently accept an ambiguous or materially different file.

### Missing-media interface

- Clearly mark offline media while keeping timeline edits intact.
- List the original path and identifying metadata.
- Support locating one file, relinking a folder, skipping an item, and retrying.
- Allow editing to continue with available media.
- Preserve both original-media and proxy references when proxy support is added.

### Collect project media

Add **Collect project media** / **Package project**:

- copy every used resource into a portable project directory;
- use predictable folders such as `Media/`, `Images/`, `Fonts/`, and `Proxies/`;
- write a collected copy of the project using relative paths;
- optionally copy only used audio/video ranges with configurable handles;
- leave original source files untouched;
- detect filename collisions and verify copied files;
- produce a manifest of collected, missing, and skipped resources.

### Acceptance criteria

- Moving a complete collected-project folder to another drive or computer does not break its media links.
- Moving loose source files produces a relink workflow rather than silently dropping the clips.
- Relinking one file can recover sibling media from the same directory.
- Files with identical names are distinguished through metadata and fingerprints.
- Existing `.alicecut.json` projects continue to open.
- Saving after relinking records the new resolved locations without altering cuts, source ranges, timing, layers, fades, speed, loops, or transitions.
- Source files are never modified by relinking or collection.
