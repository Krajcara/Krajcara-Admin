import { useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Terminal, WifiOff, Loader } from 'lucide-react'
import api from '../lib/api'

export default function TerminalPage() {
  const { serverId } = useParams()
  const termRef   = useRef(null)
  const xtermRef  = useRef(null)
  const wsRef     = useRef(null)
  const fitRef    = useRef(null)
  const [status,  setStatus]  = useState('connecting') // connecting | connected | error | closed
  const [error,   setError]   = useState('')
  const [srvName, setSrvName] = useState('Terminal')

  useEffect(() => {
    let destroyed = false

    const init = async () => {
      // Dynamically import xterm
      const { Terminal: XTerm } = await import('@xterm/xterm')
      const { FitAddon }        = await import('@xterm/addon-fit')
      const { WebLinksAddon }   = await import('@xterm/addon-web-links')
      await import('@xterm/xterm/css/xterm.css')

      if (destroyed || !termRef.current) return

      const term = new XTerm({
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
        fontSize:   14,
        lineHeight: 1.2,
        theme: {
          background:  '#0d1117',
          foreground:  '#e6edf3',
          cursor:      '#58a6ff',
          cursorAccent:'#0d1117',
          black:       '#484f58',
          red:         '#ff7b72',
          green:       '#3fb950',
          yellow:      '#d29922',
          blue:        '#58a6ff',
          magenta:     '#bc8cff',
          cyan:        '#39c5cf',
          white:       '#b1bac4',
          brightBlack: '#6e7681',
          brightRed:   '#ffa198',
          brightGreen: '#56d364',
          brightYellow:'#e3b341',
          brightBlue:  '#79c0ff',
          brightMagenta:'#d2a8ff',
          brightCyan:  '#56d4dd',
          brightWhite: '#f0f6fc',
        },
        cursorBlink:   true,
        allowProposedApi: true,
        scrollback:    5000,
      })

      const fit     = new FitAddon()
      const weblink = new WebLinksAddon()
      term.loadAddon(fit)
      term.loadAddon(weblink)
      term.open(termRef.current)
      fit.fit()

      xtermRef.current = term
      fitRef.current   = fit

      // Get token from backend
      let token, sessionId
      try {
        const r = await api.get(`/terminal/token/${serverId}`)
        token    = r.data.token
        sessionId = r.data.sessionId
        setSrvName(r.data.serverName || `Server ${serverId}`)
        document.title = `Terminal — ${r.data.serverName || serverId}`
      } catch (e) {
        setStatus('error')
        setError('Failed to get terminal token: ' + (e.response?.data?.error || e.message))
        return
      }

      // Connect WebSocket
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
      const host  = window.location.host
      const wsUrl = `${proto}://${host}/ws/terminal?token=${token}&cols=${term.cols}&rows=${term.rows}`
      const ws    = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => setStatus('connecting')

      ws.onmessage = evt => {
        try {
          const msg = JSON.parse(evt.data)
          if (msg.type === 'output')    term.write(atob(msg.data))
          if (msg.type === 'info')      term.write(`\x1b[33m${msg.message}\x1b[0m`)
          if (msg.type === 'connected') setStatus('connected')
          if (msg.type === 'error') {
            setStatus('error')
            setError(msg.message)
            term.write(`\r\n\x1b[31mError: ${msg.message}\x1b[0m\r\n`)
          }
          if (msg.type === 'closed') {
            setStatus('closed')
            term.write('\r\n\x1b[33m[Connection closed]\x1b[0m\r\n')
          }
        } catch {}
      }

      ws.onclose = () => {
        if (!destroyed) {
          setStatus('closed')
          term.write('\r\n\x1b[33m[Disconnected]\x1b[0m\r\n')
        }
      }

      ws.onerror = () => {
        setStatus('error')
        setError('WebSocket connection failed')
      }

      // Input → send to server
      term.onData(data => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'input', data }))
        }
      })

      // Resize handling
      const onResize = () => {
        fit.fit()
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }))
        }
      }
      window.addEventListener('resize', onResize)

      // Keepalive ping every 30s
      const ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }))
      }, 30000)

      return () => {
        window.removeEventListener('resize', onResize)
        clearInterval(ping)
      }
    }

    init().catch(e => { setStatus('error'); setError(e.message) })

    return () => {
      destroyed = true
      wsRef.current?.close()
      xtermRef.current?.dispose()
    }
  }, [serverId])

  const statusColors = {
    connecting: 'text-yellow-400',
    connected:  'text-green-400',
    error:      'text-red-400',
    closed:     'text-gray-400',
  }

  return (
    <div className="flex flex-col h-screen bg-[#0d1117]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-[#30363d] flex-shrink-0">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-[#58a6ff]" />
          <span className="text-sm font-semibold text-[#e6edf3]">{srvName}</span>
          <span className={`text-xs ${statusColors[status]} ml-2`}>
            ● {status}
          </span>
        </div>
        <div className="flex items-center gap-3">
          {status === 'connecting' && <Loader className="w-3.5 h-3.5 text-yellow-400 animate-spin" />}
          {(status === 'error' || status === 'closed') && <WifiOff className="w-3.5 h-3.5 text-red-400" />}
          <button onClick={() => window.close()} className="text-xs text-[#6e7681] hover:text-[#e6edf3] transition-colors">Close ✕</button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="bg-red-900/30 border-b border-red-800 px-4 py-2 text-xs text-red-300">{error}</div>
      )}

      {/* Terminal container */}
      <div className="flex-1 overflow-hidden p-2" ref={termRef} />
    </div>
  )
}
