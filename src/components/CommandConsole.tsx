import { useRef, useState } from 'react'
import { runConsoleCommand } from '../consoleCommand'
import { useT } from '../i18n'

interface Props {
  open: boolean
}

interface LogEntry {
  kind: 'command' | 'result' | 'error'
  text: string
}

/**
 * 底部命令控制台：始终挂载（回显日志放在自己的 state 里，折叠/展开靠 CSS 显隐，
 * 不靠条件渲染卸载组件），只有 open 控制显隐——折叠后再展开日志还在。
 */
export function CommandConsole({ open }: Props): React.JSX.Element {
  const t = useT()
  const [input, setInput] = useState('')
  const [entries, setEntries] = useState<LogEntry[]>([])
  const [running, setRunning] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = (): void => {
    requestAnimationFrame(() => {
      if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
    })
  }

  const run = async (): Promise<void> => {
    const raw = input.trim()
    if (!raw || running) return
    setRunning(true)
    setEntries((prev) => [...prev, { kind: 'command', text: raw }])
    scrollToBottom()
    const collected: LogEntry[] = []
    await runConsoleCommand(raw, (msg) => collected.push({ kind: msg.startsWith('✗') ? 'error' : 'result', text: msg }))
    setEntries((prev) => [...prev, ...collected])
    setInput('')
    setRunning(false)
    scrollToBottom()
  }

  return (
    <div className={`command-console${open ? '' : ' collapsed'}`}>
      <div className="command-console-log" ref={logRef}>
        {entries.length === 0 ? (
          <p className="hint">{t('console.hint')}</p>
        ) : (
          entries.map((e, i) => (
            <div key={i} className={`console-line console-line-${e.kind}`}>
              {e.kind === 'command' ? '> ' + e.text : e.text}
            </div>
          ))
        )}
      </div>
      <div className="command-console-input">
        <textarea
          value={input}
          placeholder={t('console.placeholder')}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void run()
            }
          }}
        />
        <div className="command-console-actions">
          <button className="btn btn-sm btn-primary" disabled={running || !input.trim()} onClick={() => void run()}>
            {t('console.run')}
          </button>
          <button className="btn btn-sm" disabled={entries.length === 0} onClick={() => setEntries([])}>
            {t('console.clear')}
          </button>
        </div>
      </div>
    </div>
  )
}
