import { useState, useEffect, useRef } from 'react'
import { RefreshCw } from 'lucide-react'
import { cn } from '../lib/utils'

const REFRESH_MS = 30000

function fmtUptime(secs) {
  if (!secs) return '—'
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function UsageBar({ pct, color, height = 'h-1.5' }) {
  return (
    <div className={cn('w-full bg-gray-700 rounded-full overflow-hidden', height)}>
      <div className={cn('h-full rounded-full transition-all', color)}
        style={{ width: `${Math.min(100, pct || 0)}%` }} />
    </div>
  )
}

function Clock() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return <>{time.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</>
}

function ClockDate() {
  const [time, setTime] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 60000)
    return () => clearInterval(t)
  }, [])
  return <>{time.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</>
}

// ── Table view (A) ────────────────────────────────────────────────────────────
function TableView({ proxmox }) {
  const allVMs = proxmox.nodes.flatMap(n =>
    [...(n.vms||[]), ...(n.lxc||[])].map(v => ({ ...v, nodeName: n.node }))
  ).sort((a,b) => (a.nodeName+a.name).localeCompare(b.nodeName+b.name))

  return (
    <div className="flex-1 flex flex-col gap-3 p-4 overflow-y-auto">
      {/* Node summary */}
      <div className="grid grid-cols-2 gap-3 flex-shrink-0">
        {proxmox.nodes.map(node => (
          <div key={node.node} className="bg-gray-900 rounded-xl border border-gray-800 px-4 py-2 flex items-center gap-4">
            <span className={cn('w-3 h-3 rounded-full flex-shrink-0', node.status==='online'?'bg-green-500':'bg-red-500 animate-pulse')} />
            <span className="font-bold text-white">{node.node}</span>
            <span className="text-xs text-gray-500">{fmtUptime(node.uptime)}</span>
            <div className="flex-1 flex gap-4">
              {[
                {l:`CPU (${node.maxcpu}c)`, p:node.cpu_usage,  c:'bg-blue-500'},
                {l:`RAM ${node.mem_used_gb}/${node.mem_max_gb}GB`, p:node.mem_usage, c:'bg-purple-500'},
              ].map(s => (
                <div key={s.l} className="flex-1">
                  <div className="flex justify-between text-xs text-gray-500 mb-0.5"><span>{s.l}</span><span>{s.p}%</span></div>
                  <UsageBar pct={s.p} color={s.c} height="h-1.5" />
                </div>
              ))}
            </div>
            <span className="text-xs text-green-400 flex-shrink-0">{node.vm_running}/{node.vm_total} running</span>
          </div>
        ))}
      </div>
      {/* Table */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden flex-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800 text-gray-500 uppercase tracking-wider">
              <th className="px-3 py-2 text-left">Node</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Type</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left w-32">CPU</th>
              <th className="px-3 py-2 text-left w-32">RAM</th>
              <th className="px-3 py-2 text-left w-28">Disk</th>
              <th className="px-3 py-2 text-left">OS</th>
              <th className="px-3 py-2 text-left">IP</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {allVMs.map(vm => {
              const isRunning = vm.status === 'running'
              return (
                <tr key={`${vm.type}-${vm.vmid}`} className={cn('hover:bg-gray-800/30', !isRunning && 'opacity-40')}>
                  <td className="px-3 py-1.5 text-gray-500">{vm.nodeName}</td>
                  <td className="px-3 py-1.5 font-medium text-white">{vm.name}</td>
                  <td className="px-3 py-1.5">
                    <span className={cn('px-1.5 py-0.5 rounded text-xs font-medium', vm.type==='lxc'?'bg-purple-900/50 text-purple-300':'bg-blue-900/50 text-blue-300')}>
                      {vm.type==='lxc'?'LXC':'VM'}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    <span className={cn('flex items-center gap-1', isRunning?'text-green-400':'text-gray-600')}>
                      <span className={cn('w-1.5 h-1.5 rounded-full', isRunning?'bg-green-500':'bg-gray-600')} />
                      {vm.status}
                    </span>
                  </td>
                  <td className="px-3 py-1.5">
                    {isRunning ? <div className="flex items-center gap-1.5"><UsageBar pct={vm.cpu_usage} color="bg-blue-500" height="h-1" /><span className="text-gray-400 w-8 text-right">{vm.cpu_usage}%</span></div> : <span className="text-gray-700">—</span>}
                  </td>
                  <td className="px-3 py-1.5">
                    {isRunning ? <div className="flex items-center gap-1.5"><UsageBar pct={vm.mem_usage} color="bg-purple-500" height="h-1" /><span className="text-gray-400 w-8 text-right">{vm.mem_usage}%</span></div> : <span className="text-gray-700">—</span>}
                  </td>
                  <td className="px-3 py-1.5">
                    {vm.disk_used_gb!=null ? <div className="flex items-center gap-1.5"><UsageBar pct={vm.disk_usage} color="bg-orange-500" height="h-1" /><span className="text-gray-400 w-8 text-right">{vm.disk_usage}%</span></div> : <span className="text-gray-700">—</span>}
                  </td>
                  <td className="px-3 py-1.5 text-gray-400">{vm.os||'—'}</td>
                  <td className="px-3 py-1.5 font-mono text-gray-400">{vm.ip||'—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── VMCard (used by Cards and Wallboard views) ────────────────────────────────
function VMCard({ vm, wallboard = false }) {
  const isRunning = vm.status === 'running'
  const maxVal    = Math.max(vm.cpu_usage||0, vm.mem_usage||0)

  const borderCls = wallboard
    ? (!isRunning ? 'border-gray-700 bg-gray-800/30 opacity-50'
      : maxVal >= 90 ? 'border-red-700/60 bg-red-900/20'
      : maxVal >= 70 ? 'border-yellow-700/60 bg-yellow-900/20'
      : 'border-green-700/40 bg-green-900/15')
    : (isRunning ? 'border-gray-700' : 'border-gray-800 opacity-50')

  return (
    <div className={cn('bg-gray-800/60 rounded-xl border p-2.5 flex flex-col gap-1.5', borderCls)}>
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={cn('w-2 h-2 rounded-full flex-shrink-0', isRunning?'bg-green-500':'bg-gray-600')} />
          <span className="text-xs font-semibold text-white truncate">{vm.name}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', vm.type==='lxc'?'bg-purple-900/60 text-purple-300':'bg-blue-900/60 text-blue-300')}>
            {vm.type==='lxc'?'LXC':'VM'}
          </span>
          <span className="text-xs text-gray-600 font-mono">#{vm.vmid}</span>
        </div>
      </div>

      {/* Specs row: CPU cores · RAM GB · Disk GB */}
      <div className="flex items-center gap-2 text-xs text-gray-600 font-mono">
        {vm.maxcpu > 0 && <span>{vm.maxcpu}c</span>}
        {vm.mem_max_gb > 0 && <><span className="text-gray-700">·</span><span>{vm.mem_max_gb}GB</span></>}
        {vm.disk_max_gb > 0 && <><span className="text-gray-700">·</span><span>{vm.disk_max_gb}GB↗</span></>}
      </div>

      {isRunning ? (
        <>
          <div className="space-y-1">
            {[
              {l:'CPU', v:vm.cpu_usage,  c: vm.cpu_usage>=90?'bg-red-500':vm.cpu_usage>=70?'bg-yellow-500':'bg-blue-500'},
              {l:'MEM', v:vm.mem_usage,  c: vm.mem_usage>=90?'bg-red-500':vm.mem_usage>=70?'bg-yellow-500':'bg-purple-500'},
              {l:'DSK', v:vm.disk_usage, c:'bg-orange-500'},
            ].map(s => (
              <div key={s.l} className="flex items-center gap-1.5">
                <span className="text-xs text-gray-600 w-7">{s.l}</span>
                <UsageBar pct={s.v} color={s.c} height="h-1" />
                <span className="text-xs text-gray-500 w-7 text-right">{s.v}%</span>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between pt-1 border-t border-gray-700/50">
            <span className="text-xs text-gray-500">{vm.os||'—'}</span>
            <span className="text-xs font-mono text-gray-400">{vm.ip||'—'}</span>
          </div>
        </>
      ) : (
        <div className="text-xs text-gray-600 text-center py-1">stopped</div>
      )}
    </div>
  )
}

// ── Cards view (B) ────────────────────────────────────────────────────────────
function CardsView({ proxmox }) {
  return (
    <div className="flex-1 flex flex-col gap-4 p-4 overflow-y-auto">
      <div className="grid grid-cols-2 gap-3 flex-shrink-0">
        {proxmox.nodes.map(node => (
          <div key={node.node} className="bg-gray-900 rounded-xl border border-gray-800 px-4 py-3 flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className={cn('w-3 h-3 rounded-full', node.status==='online'?'bg-green-500':'bg-red-500 animate-pulse')} />
              <span className="font-bold text-white text-base">{node.node}</span>
              <span className="text-xs text-gray-500">{node.status} · {fmtUptime(node.uptime)}</span>
            </div>
            <div className="flex-1 grid grid-cols-3 gap-4">
              {[
                {label:`CPU (${node.maxcpu}c)`, pct:node.cpu_usage,  color:'bg-blue-500'},
                {label:`RAM ${node.mem_used_gb}/${node.mem_max_gb}GB`, pct:node.mem_usage, color:'bg-purple-500'},
                {label:'Disk', pct:node.disk_usage, color:'bg-orange-500'},
              ].map(s => (
                <div key={s.label}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-500">{s.label}</span>
                    <span className="text-xs text-gray-400">{s.pct}%</span>
                  </div>
                  <UsageBar pct={s.pct} color={s.color} height="h-1.5" />
                </div>
              ))}
            </div>
            <div className="text-right flex-shrink-0">
              <p className="text-sm font-semibold text-white">
                <span className="text-green-400">{node.vm_running}</span>
                <span className="text-gray-500">/{node.vm_total}</span>
              </p>
              <p className="text-xs text-gray-500">running</p>
            </div>
          </div>
        ))}
      </div>
      {proxmox.nodes.map(node => {
        const all = [...(node.vms||[]),...(node.lxc||[])].sort((a,b)=>(a.name||'').localeCompare(b.name||''))
        if (!all.length) return null
        return (
          <div key={node.node}>
            <div className="flex items-center gap-2 mb-2">
              <span className={cn('w-2 h-2 rounded-full', node.status==='online'?'bg-green-500':'bg-red-500')} />
              <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">{node.node}</span>
              <span className="text-xs text-gray-600">{node.vm_running}/{all.length} running</span>
            </div>
            <div className="grid grid-cols-6 gap-2">
              {all.map(vm => <VMCard key={`${vm.type}-${vm.vmid}`} vm={vm} />)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Wallboard view (D) ────────────────────────────────────────────────────────
function WallboardView({ proxmox }) {
  return (
    <div className="flex-1 flex flex-col gap-4 p-4 overflow-y-auto">
      <div className="grid grid-cols-2 gap-3 flex-shrink-0">
        {proxmox.nodes.map(node => (
          <div key={node.node} className="bg-gray-900 rounded-xl border border-gray-800 px-4 py-2 flex items-center gap-4">
            <span className={cn('w-3 h-3 rounded-full flex-shrink-0', node.status==='online'?'bg-green-500':'bg-red-500 animate-pulse')} />
            <span className="font-bold text-white">{node.node}</span>
            <span className="text-xs text-gray-500">{fmtUptime(node.uptime)}</span>
            <div className="flex-1 flex gap-4">
              {[{l:'CPU',p:node.cpu_usage,c:'bg-blue-500'},{l:'RAM',p:node.mem_usage,c:'bg-purple-500'}].map(s=>(
                <div key={s.l} className="flex-1">
                  <div className="flex justify-between text-xs text-gray-500 mb-0.5"><span>{s.l}</span><span>{s.p}%</span></div>
                  <UsageBar pct={s.p} color={s.c} height="h-1.5" />
                </div>
              ))}
            </div>
            <span className="text-xs text-green-400 flex-shrink-0">{node.vm_running}/{node.vm_total} running</span>
          </div>
        ))}
      </div>
      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500 flex-shrink-0">
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-green-900/60 border border-green-700/50 inline-block" />OK</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-yellow-900/60 border border-yellow-700/50 inline-block" />Upozorenje ≥70%</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-900/60 border border-red-700/50 inline-block" />Kritično ≥90%</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-gray-800 border border-gray-700 inline-block opacity-50" />Stopped</span>
      </div>
      {proxmox.nodes.map(node => {
        const all = [...(node.vms||[]),...(node.lxc||[])].sort((a,b)=>(a.name||'').localeCompare(b.name||''))
        if (!all.length) return null
        return (
          <div key={node.node}>
            <div className="flex items-center gap-2 mb-2">
              <span className={cn('w-2 h-2 rounded-full', node.status==='online'?'bg-green-500':'bg-red-500')} />
              <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">{node.node}</span>
            </div>
            <div className="grid grid-cols-6 gap-2">
              {all.map(vm => <VMCard key={`${vm.type}-${vm.vmid}`} vm={vm} wallboard />)}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Main TV page ──────────────────────────────────────────────────────────────
export default function TVPage() {
  const [proxmox,     setProxmox]     = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [error,       setError]       = useState(null)
  const [viewMode,    setViewMode]    = useState('cards')
  const [textSize,    setTextSize]    = useState('default')
  const intervalRef = useRef(null)

  const load = async () => {
    try {
      // Load view setting
      try {
        const sv = await fetch('/api/settings/app')
        if (sv.ok) {
          const sd = await sv.json()
          if (sd.tv_proxmox_view) setViewMode(sd.tv_proxmox_view)
        if (sd.tv_text_size)     setTextSize(sd.tv_text_size)
        }
      } catch {}

      const r = await fetch('/api/tv/public')
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const d = await r.json()
      setProxmox(d.proxmox)
      setLastUpdated(new Date())
      setError(null)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    intervalRef.current = setInterval(load, REFRESH_MS)
    return () => clearInterval(intervalRef.current)
  }, [])

  return (
    <div className="flex flex-col h-screen bg-gray-950 text-white overflow-hidden"
      style={{ zoom: textSize === 'large' ? 1.25 : textSize === 'medium' ? 1.12 : 1 }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-2.5 bg-gray-900 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-white tracking-wide">PROXMOX</span>
          {proxmox?.nodes && (
            <span className="text-xs text-gray-400">
              {proxmox.nodes.reduce((a,n)=>a+n.vm_running,0)}/
              {proxmox.nodes.reduce((a,n)=>a+n.vm_total,0)} running
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          {lastUpdated && (
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <RefreshCw className="w-3 h-3" />
              {lastUpdated.toLocaleTimeString('en', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}
            </div>
          )}
          <div className="text-right">
            <div className="text-white font-mono text-3xl font-bold leading-none tracking-tight"><Clock /></div>
            <div className="text-gray-500 font-mono text-xs mt-0.5"><ClockDate /></div>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-500 text-sm">Loading...</div>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-red-400 text-sm">{error}</div>
        </div>
      ) : !proxmox?.configured ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-gray-500 text-sm">Proxmox not configured</div>
        </div>
      ) : viewMode === 'table' ? (
        <TableView proxmox={proxmox} />
      ) : viewMode === 'wallboard' ? (
        <WallboardView proxmox={proxmox} />
      ) : (
        <CardsView proxmox={proxmox} />
      )}

      {/* Footer */}
      <div className="flex-shrink-0 text-center py-1 text-xs text-gray-800 border-t border-gray-900">
        Auto-refresh every 30s · /tv
      </div>
    </div>
  )
}
