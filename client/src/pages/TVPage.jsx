import { useState, useEffect, useRef } from 'react'
import { Download, Upload, Activity, Shield, AlertCircle, AlertTriangle, Info, CheckCircle, RefreshCw, Monitor, Server } from 'lucide-react'
import { cn } from '../lib/utils'

const REFRESH_MS = 30000

function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso + (iso.includes('Z') || iso.includes('+') ? '' : 'Z'))
    .toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
}

function timeAgoShort(iso) {
  if (!iso) return ''
  const d = new Date(iso + (iso.includes('Z') || iso.includes('+') ? '' : 'Z'))
  const diff = Math.floor((Date.now() - d) / 1000)
  if (diff < 60)   return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  return `${Math.floor(diff / 3600)}h ago`
}

function fmtUptime(secs) {
  if (!secs) return '—'
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function UsageBar({ pct, color = 'bg-blue-500', height = 'h-1.5' }) {
  const v = Math.min(Math.max(pct || 0, 0), 100)
  const c = v > 90 ? 'bg-red-500' : v > 75 ? 'bg-yellow-500' : color
  return (
    <div className={cn('w-full bg-gray-700 rounded-full overflow-hidden', height)}>
      <div className={cn('h-full rounded-full', c)} style={{ width: `${v}%` }} />
    </div>
  )
}

// ── Overview Tab ──────────────────────────────────────────────────────────────

function MonitorsPanel({ monitors }) {
  const up       = monitors.filter(m => m.last_status === 'up').length
  const down     = monitors.filter(m => m.last_status === 'down').length
  const degraded = monitors.filter(m => m.last_status === 'degraded').length
  const allOk    = down === 0 && degraded === 0

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Uptime Monitor</h2>
        <div className="flex gap-2 text-xs">
          <span className="text-green-400">↑ {up}</span>
          {degraded > 0 && <span className="text-yellow-400">⚡ {degraded}</span>}
          {down     > 0 && <span className="text-red-400 font-bold animate-pulse">↓ {down}</span>}
        </div>
      </div>
      <div className={cn('rounded-lg px-3 py-2 mb-3 text-center text-sm font-semibold',
        allOk ? 'bg-green-900/30 text-green-300 border border-green-800'
          : down > 0 ? 'bg-red-900/30 text-red-300 border border-red-800 animate-pulse'
          : 'bg-yellow-900/30 text-yellow-300 border border-yellow-800')}>
        {allOk ? '✓ All systems operational'
          : down > 0 ? `✗ ${down} monitor${down > 1 ? 's' : ''} down`
          : `⚡ ${degraded} degraded`}
      </div>
      <div className="flex-1 overflow-y-auto space-y-1.5">
        {monitors.map(m => {
          const dot  = { up: 'bg-green-500', down: 'bg-red-500 animate-pulse', degraded: 'bg-yellow-400 animate-pulse', unknown: 'bg-gray-600' }[m.last_status || 'unknown']
          const isDown = m.last_status === 'down'
          return (
            <div key={m.id} className={cn('flex items-center gap-2.5 px-3 py-2 rounded-lg',
              isDown ? 'bg-red-900/20 border border-red-800/50' : 'bg-gray-800/50')}>
              <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', dot)} />
              <span className={cn('flex-1 text-sm font-medium truncate', isDown ? 'text-red-300' : 'text-white')}>{m.label}</span>
              {m.last_latency_ms != null && <span className="text-xs text-gray-500 font-mono">{m.last_latency_ms}ms</span>}
              <span className={cn('text-xs font-bold px-1.5 py-0.5 rounded',
                { up: 'bg-green-900/50 text-green-400', down: 'bg-red-900/50 text-red-400', degraded: 'bg-yellow-900/50 text-yellow-400', unknown: 'bg-gray-700 text-gray-500' }[m.last_status || 'unknown']
              )}>{(m.last_status || 'unknown').toUpperCase()}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ProxmoxOverviewPanel({ proxmox }) {
  if (!proxmox?.configured) return <div className="flex items-center justify-center h-full text-gray-600 text-sm">Proxmox not configured</div>
  return (
    <div className="flex flex-col h-full">
      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Proxmox</h2>
      <div className="flex-1 space-y-3">
        {proxmox.nodes.map(node => (
          <div key={node.node} className="bg-gray-800/50 rounded-lg p-3">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className={cn('w-2.5 h-2.5 rounded-full', node.status === 'online' ? 'bg-green-500' : 'bg-red-500')} />
                <span className="font-bold text-white">{node.node}</span>
              </div>
              <span className="text-sm font-semibold">
                <span className="text-green-400">{node.vm_running}</span>
                <span className="text-gray-500">/{node.vm_total} running</span>
              </span>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-8">CPU</span>
                <UsageBar pct={node.cpu_usage} color="bg-blue-500" />
                <span className="text-xs text-gray-400 w-8 text-right">{node.cpu_usage}%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-8">RAM</span>
                <UsageBar pct={node.mem_usage} color="bg-purple-500" />
                <span className="text-xs text-gray-400 w-8 text-right">{node.mem_usage}%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-8">Disk</span>
                <UsageBar pct={node.disk_usage} color="bg-orange-500" />
                <span className="text-xs text-gray-400 w-8 text-right">{node.disk_usage}%</span>
              </div>
            </div>
            <p className="text-xs text-gray-600 mt-1.5">{node.mem_used_gb}/{node.mem_max_gb} GB · {node.maxcpu} cores</p>
          </div>
        ))}
      </div>
    </div>
  )
}


function NetworkPanel({ routers, dnsServers }) {
  const allOnline = [...(routers||[]), ...(dnsServers||[])].every(r => r.online)
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Network</h2>
        <span className={cn('text-xs font-medium', allOnline ? 'text-green-400' : 'text-red-400')}>
          {allOnline ? '✓ All online' : '✗ Issues'}
        </span>
      </div>
      <div className="space-y-1.5 flex-1">
        {(routers||[]).map(r => (
          <div key={r.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-800/50">
            <span className={cn('w-2 h-2 rounded-full flex-shrink-0', r.online ? 'bg-green-500' : 'bg-red-500 animate-pulse')} />
            <span className="text-xs font-medium text-white flex-1 truncate">{r.name}</span>
            <span className="text-xs text-gray-600 font-mono hidden xl:block">{r.ip}</span>
            <span className={cn('text-xs font-bold', r.online ? 'text-green-400' : 'text-red-400')}>
              {r.online ? 'UP' : 'DOWN'}
            </span>
          </div>
        ))}
        {(dnsServers||[]).length > 0 && (routers||[]).length > 0 && (
          <div className="border-t border-gray-800 my-1" />
        )}
        {(dnsServers||[]).map(s => (
          <div key={s.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-gray-800/50">
            <span className={cn('w-2 h-2 rounded-full flex-shrink-0', s.online ? 'bg-green-500' : 'bg-red-500 animate-pulse')} />
            <span className="text-xs font-medium text-white flex-1 truncate">{s.label}</span>
            <span className={cn('text-xs px-1 py-0.5 rounded font-medium',
              s.role === 'primary' ? 'bg-brand/20 text-brand-light' : 'bg-gray-700 text-gray-400')}>
              {s.role}
            </span>
            <span className={cn('text-xs font-bold', s.online ? 'text-green-400' : 'text-red-400')}>
              {s.online ? 'UP' : 'DOWN'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function NetSpeedPanel({ lastSpeed }) {
  return (
    <div className="flex flex-col h-full">
      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">Internet Speed</h2>
      {!lastSpeed ? <div className="flex items-center justify-center flex-1 text-gray-600 text-sm">No data</div> : (
        <div className="flex-1 space-y-3">
          {[
            { label: 'Download', icon: Download, value: lastSpeed.download, unit: 'Mbps', color: 'text-blue-400',   bg: 'bg-blue-900/20 border-blue-800/40' },
            { label: 'Upload',   icon: Upload,   value: lastSpeed.upload,   unit: 'Mbps', color: 'text-green-400',  bg: 'bg-green-900/20 border-green-800/40' },
            { label: 'Ping',     icon: Activity, value: lastSpeed.ping,     unit: 'ms',   color: 'text-purple-400', bg: 'bg-purple-900/20 border-purple-800/40' },
          ].map(s => (
            <div key={s.label} className={cn('flex items-center gap-3 px-4 py-3 rounded-lg border', s.bg)}>
              <s.icon className={cn('w-5 h-5 flex-shrink-0', s.color)} />
              <span className="text-sm text-gray-400 w-20">{s.label}</span>
              <span className={cn('text-2xl font-bold flex-1', s.color)}>
                {s.value != null ? Math.round(s.value * 10) / 10 : '—'}
              </span>
              <span className="text-xs text-gray-500">{s.unit}</span>
            </div>
          ))}
          <p className="text-xs text-gray-600 text-center">Last test: {fmtTime(lastSpeed.created_at)}</p>
        </div>
      )}
    </div>
  )
}

function NotificationsPanel({ notifications }) {
  const TYPE_ICON = {
    error:   <AlertCircle   className="w-4 h-4 text-red-400 flex-shrink-0" />,
    warning: <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0" />,
    info:    <Info          className="w-4 h-4 text-blue-400 flex-shrink-0" />,
    success: <CheckCircle   className="w-4 h-4 text-green-400 flex-shrink-0" />,
  }
  const TYPE_BG = {
    error:   'border-l-red-500 bg-red-900/10',
    warning: 'border-l-yellow-500 bg-yellow-900/10',
    info:    'border-l-blue-500 bg-blue-900/10',
    success: 'border-l-green-500 bg-green-900/10',
  }
  const unread = notifications.filter(n => !n.read)
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-bold text-gray-400 uppercase tracking-widest">Alerts</h2>
        {unread.length > 0 && <span className="text-xs bg-red-500 text-white rounded-full px-2 py-0.5 font-bold">{unread.length} new</span>}
      </div>
      {notifications.length === 0 ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center"><CheckCircle className="w-8 h-8 text-green-500 mx-auto mb-2" /><p className="text-sm text-gray-500">No alerts</p></div>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-1.5">
          {notifications.map(n => (
            <div key={n.id} className={cn('flex items-start gap-2.5 px-3 py-2.5 rounded-r-lg border-l-2',
              TYPE_BG[n.type] || TYPE_BG.info, n.read && 'opacity-50')}>
              {TYPE_ICON[n.type] || TYPE_ICON.info}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white leading-tight truncate">{n.title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{timeAgoShort(n.created_at)}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function OverviewTab({ data }) {
  return (
    <div className="flex-1 grid grid-cols-3 gap-4 p-4 min-h-0">
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 overflow-hidden flex flex-col">
        <MonitorsPanel monitors={data?.monitors || []} />
      </div>
      <div className="flex flex-col gap-4">
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 flex-1 overflow-hidden flex flex-col">
          <ProxmoxOverviewPanel proxmox={data?.proxmox} />
        </div>
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 flex-shrink-0">
          <NetworkPanel routers={data?.routers || []} dnsServers={data?.dnsServers || []} />
        </div>
        <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 flex-shrink-0">
          <NetSpeedPanel lastSpeed={data?.lastSpeed} />
        </div>
      </div>
      <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 overflow-hidden flex flex-col">
        <NotificationsPanel notifications={data?.notifications || []} />
      </div>
    </div>
  )
}

// ── VM Card ───────────────────────────────────────────────────────────────────
function VMCard({ vm }) {
  const isRunning = vm.status === 'running'
  return (
    <div className={cn('bg-gray-800/60 rounded-xl border p-3 flex flex-col gap-2',
      isRunning ? 'border-gray-700' : 'border-gray-800 opacity-50')}>
      {/* Header */}
      <div className="flex items-center justify-between gap-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className={cn('w-2 h-2 rounded-full flex-shrink-0',
            isRunning ? 'bg-green-500' : 'bg-gray-600')} />
          <span className="text-sm font-semibold text-white truncate">{vm.name}</span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium',
            vm.type === 'lxc' ? 'bg-purple-900/60 text-purple-300' : 'bg-blue-900/60 text-blue-300')}>
            {vm.type === 'lxc' ? 'LXC' : 'VM'}
          </span>
          <span className="text-xs text-gray-600 font-mono">#{vm.vmid}</span>
        </div>
      </div>

      {isRunning ? (
        <>
          {/* Bars */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-600 w-7">CPU</span>
              <UsageBar pct={vm.cpu_usage} color="bg-blue-500" height="h-1" />
              <span className="text-xs text-gray-500 w-7 text-right">{vm.cpu_usage}%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-600 w-7">MEM</span>
              <UsageBar pct={vm.mem_usage} color="bg-purple-500" height="h-1" />
              <span className="text-xs text-gray-500 w-7 text-right">{vm.mem_usage}%</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-600 w-7">DSK</span>
              <UsageBar pct={vm.disk_usage} color="bg-orange-500" height="h-1" />
              <span className="text-xs text-gray-500 w-7 text-right">{vm.disk_usage}%</span>
            </div>
          </div>
          {/* OS + IP */}
          <div className="flex items-center justify-between pt-1 border-t border-gray-700/50">
            <span className="text-xs text-gray-500">{vm.os || '—'}</span>
            <span className="text-xs font-mono text-gray-400">{vm.ip || '—'}</span>
          </div>
        </>
      ) : (
        <div className="text-xs text-gray-600 text-center py-1">stopped</div>
      )}
    </div>
  )
}

// ── Proxmox Tab ───────────────────────────────────────────────────────────────
function ProxmoxTab({ proxmox }) {
  if (!proxmox?.configured) return (
    <div className="flex-1 flex items-center justify-center text-gray-500">Proxmox not configured</div>
  )

  return (
    <div className="flex-1 flex flex-col gap-4 p-4 overflow-y-auto">

      {/* Nodes summary bar */}
      <div className="grid grid-cols-2 gap-3 flex-shrink-0">
        {proxmox.nodes.map(node => (
          <div key={node.node} className="bg-gray-900 rounded-xl border border-gray-800 px-4 py-3 flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className={cn('w-3 h-3 rounded-full', node.status === 'online' ? 'bg-green-500' : 'bg-red-500 animate-pulse')} />
              <span className="font-bold text-white text-base">{node.node}</span>
              <span className="text-xs text-gray-500">{node.status} · {fmtUptime(node.uptime)}</span>
            </div>
            <div className="flex-1 grid grid-cols-3 gap-4">
              {[
                { label: `CPU (${node.maxcpu}c)`, pct: node.cpu_usage,  color: 'bg-blue-500' },
                { label: `RAM ${node.mem_used_gb}/${node.mem_max_gb}GB`, pct: node.mem_usage,  color: 'bg-purple-500' },
                { label: 'Disk', pct: node.disk_usage, color: 'bg-orange-500' },
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

      {/* VM grid per node */}
      {proxmox.nodes.map(node => {
        const all = [...(node.vms || []), ...(node.lxc || [])].sort((a,b) => (a.name||'').localeCompare(b.name||''))
        if (!all.length) return null
        return (
          <div key={node.node}>
            <div className="flex items-center gap-2 mb-2">
              <span className={cn('w-2 h-2 rounded-full', node.status === 'online' ? 'bg-green-500' : 'bg-red-500')} />
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

// ── Main TV page ──────────────────────────────────────────────────────────────
export default function TVPage() {
  const [data,        setData]        = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)
  const [error,       setError]       = useState(null)
  const [activeTab,   setActiveTab]   = useState('overview')
  const intervalRef = useRef(null)

  const load = async () => {
    try {
      const r = await fetch('/api/tv/public')
      const d = await r.json()
      setData(d)
      setLastUpdated(new Date())
      setError(null)
    } catch {
      setError('Connection error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    intervalRef.current = setInterval(load, REFRESH_MS)
    return () => clearInterval(intervalRef.current)
  }, [])

  const TABS = [
    { key: 'overview', label: 'Overview',  icon: Monitor },
    { key: 'proxmox',  label: 'Proxmox',   icon: Server },
  ]

  return (
    <div className="min-h-screen bg-gray-950 text-white flex flex-col" style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-2 bg-gray-900 border-b border-gray-800 flex-shrink-0">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-brand rounded-lg flex items-center justify-center flex-shrink-0">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <span className="font-bold text-lg tracking-tight">Krajcara Admin</span>
          </div>
          {/* Tabs */}
          <div className="flex gap-1 ml-4">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setActiveTab(t.key)}
                className={cn('flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors',
                  activeTab === t.key
                    ? 'bg-brand text-white'
                    : 'text-gray-400 hover:text-white hover:bg-gray-800')}>
                <t.icon className="w-3.5 h-3.5" />{t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          {lastUpdated && (
            <div className="flex items-center gap-1.5">
              <RefreshCw className="w-3 h-3" />
              <span className="text-xs">{lastUpdated.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            </div>
          )}
          <span className="text-white font-mono">
            <Clock />
          </span>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <RefreshCw className="w-10 h-10 text-gray-600 animate-spin" />
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center text-red-400">{error}</div>
      ) : (
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {activeTab === 'overview' && <OverviewTab data={data} />}
          {activeTab === 'proxmox'  && <ProxmoxTab proxmox={data?.proxmox} />}
        </div>
      )}

      <div className="flex-shrink-0 text-center py-1 text-xs text-gray-800 border-t border-gray-900">
        Auto-refresh every 30s · /tv
      </div>
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
