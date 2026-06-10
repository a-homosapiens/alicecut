import { readFile } from 'fs/promises'

/** 读 LRC 文本：常见 GBK 编码在 UTF-8 解码出现明显乱码时自动回退 */
export async function readLrcText(path: string): Promise<string> {
  const buf = await readFile(path)
  let text = buf.toString('utf-8')
  if ((text.match(/�/g)?.length ?? 0) > 2) {
    text = new TextDecoder('gbk').decode(buf)
  }
  return text
}
