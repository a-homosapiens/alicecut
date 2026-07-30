export const MAX_FONT_FILE_BYTES = 64 * 1024 * 1024

/** Recognize the container signatures supported by FontFace and AliceCut's font picker. */
export function isSupportedFontData(data: ArrayBuffer): boolean {
  if (data.byteLength < 4 || data.byteLength > MAX_FONT_FILE_BYTES) return false
  const bytes = new Uint8Array(data, 0, 4)
  const tag = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])
  return (
    (bytes[0] === 0x00 && bytes[1] === 0x01 && bytes[2] === 0x00 && bytes[3] === 0x00) ||
    tag === 'OTTO' ||
    tag === 'true' ||
    tag === 'typ1' ||
    tag === 'ttcf' ||
    tag === 'wOFF' ||
    tag === 'wOF2'
  )
}
