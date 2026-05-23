import { useState, useEffect, useRef } from 'react'
import { Shield, RefreshCw, Activity, Wifi, WifiOff, Download, Upload, Server } from 'lucide-react'
import { AreaChart, Area, ResponsiveContainer, Tooltip } from 'recharts'
import { cn } from '../lib/utils'

const REFRESH_MS = 30000

// ── Helpers ───────────────────────────────────────────────────────────────────
function statusDot(s) {
  return { up: 'bg-green-500', down: 'bg-red-500 animate-pulse', degraded: 'bg-yellow-400 animate-pulse', unknown: 'bg-gray-400', running: 'bg-green-500', online: 'bg-green-500', offline: 'bg-red-500 animate-pulse' }[s] || 'bg-gray-400'
}
function fmtTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
}
function fmtUptime(secs) {
  if (!secs) return null
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// ── Fetch helper — no auth ────────────────────────────────────────────────────
async function fetchPublic(path) {
  const r = await fetch(path)
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return r.json()
}

// ── Tab 1: Uptime Monitor ─────────────────────────────────────────────────────
const STATUS_COLOR = {
  up:       'bg-green-100 text-green-700',
  down:     'bg-red-100 text-red-700',
  degraded: 'bg-yellow-100 text-yellow-700',
  unknown:  'bg-gray-100 text-gray-500',
}
const STATUS_LABEL = { up: 'Up', down: 'Down', degraded: 'Degraded', unknown: 'Unknown' }

function MonitorCard({ monitor }) {
  const [checks, setChecks] = useState([])

  useEffect(() => {
    fetch(`/api/monitors/${monitor.id}/checks/public?hours=3`)
      .then(r => r.json())
      .then(data => setChecks(data.map(c => ({ v: c.latency_ms || 0 }))))
      .catch(() => {})
  }, [monitor.id])

  const lineColor = monitor.last_status === 'down' ? '#ef4444' : monitor.last_status === 'degraded' ? '#eab308' : '#22c55e'

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', statusDot(monitor.last_status || 'unknown'))} />
          <div>
            <p className="font-medium text-white text-sm">{monitor.label}</p>
            <p className="text-xs text-gray-500 font-mono truncate max-w-48">{monitor.target}</p>
          </div>
        </div>
        <span className={cn('text-xs font-semibold px-2 py-0.5 rounded', STATUS_COLOR[monitor.last_status || 'unknown'])}>
          {STATUS_LABEL[monitor.last_status || 'unknown']}
        </span>
      </div>
      {checks.length > 1 && (
        <div className="h-10 mb-3">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={checks}>
              <defs>
                <linearGradient id={`g${monitor.id}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={lineColor} stopOpacity={0.3} />
                  <stop offset="95%" stopColor={lineColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="v" stroke={lineColor} strokeWidth={1.5} fill={`url(#g${monitor.id})`} dot={false} isAnimationActive={false} />
              <Tooltip contentStyle={{ fontSize: 11, padding: '2px 6px', borderRadius: 6, border: 'none', background: '#111827', color: '#f9fafb' }} formatter={v => [`${v}ms`, 'Latency']} labelFormatter={() => ''} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{monitor.last_latency_ms != null ? `${monitor.last_latency_ms}ms` : '—'}</span>
        <span className="bg-gray-800 px-1.5 py-0.5 rounded font-mono">{monitor.type?.toUpperCase()}</span>
        <span>{monitor.last_checked_at ? fmtTime(monitor.last_checked_at) : '—'}</span>
      </div>
    </div>
  )
}

function UptimeTab() {
  const [monitors, setMonitors] = useState([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    fetchPublic('/api/monitors/public')
      .then(data => setMonitors(data || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const up       = monitors.filter(m => m.last_status === 'up').length
  const down     = monitors.filter(m => m.last_status === 'down').length
  const degraded = monitors.filter(m => m.last_status === 'degraded').length
  const allUp    = monitors.length > 0 && down === 0 && degraded === 0

  return (
    <div className="space-y-5">
      {/* Overall status banner */}
      {!loading && monitors.length > 0 && (
        <div className={cn('rounded-xl border p-4 text-center',
          allUp ? 'bg-green-900/20 border-green-800' : down > 0 ? 'bg-red-900/20 border-red-800' : 'bg-yellow-900/20 border-yellow-800')}>
          <div className="flex items-center justify-center gap-2">
            <span className={cn('w-3 h-3 rounded-full', allUp ? 'bg-green-500' : down > 0 ? 'bg-red-500 animate-pulse' : 'bg-yellow-400 animate-pulse')} />
            <span className={cn('font-semibold', allUp ? 'text-green-300' : down > 0 ? 'text-red-300' : 'text-yellow-300')}>
              {allUp ? 'All systems operational' : down > 0 ? 'Outage detected' : 'Partial outage'}
            </span>
          </div>
          <div className="flex items-center justify-center gap-4 mt-2 text-xs text-gray-400">
            <span className="text-green-400">↑ {up} up</span>
            {degraded > 0 && <span className="text-yellow-400">⚡ {degraded} degraded</span>}
            {down     > 0 && <span className="text-red-400">↓ {down} down</span>}
          </div>
        </div>
      )}

      {loading && <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 text-gray-500 animate-spin" /></div>}
      {!loading && monitors.length === 0 && <p className="text-center text-gray-500 py-12">No monitors configured</p>}
      {!loading && monitors.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...monitors].sort((a,b) => a.label.localeCompare(b.label)).map(m => <MonitorCard key={m.id} monitor={m} />)}
        </div>
      )}
    </div>
  )
}

// ── Tab 2: Network (Routers + Net Speed) ─────────────────────────────────────
function SpeedCard({ label, icon: Icon, stats, unit, color }) {
  const colors = {
    blue:   { border: 'border-blue-700',   bg: 'bg-blue-950/60',   icon: 'text-blue-400',   val: 'text-blue-300' },
    green:  { border: 'border-green-700',  bg: 'bg-green-950/60',  icon: 'text-green-400',  val: 'text-green-300' },
    purple: { border: 'border-purple-700', bg: 'bg-purple-950/60', icon: 'text-purple-400', val: 'text-purple-300' },
  }
  const c = colors[color]
  return (
    <div className={cn('rounded-xl border p-5', c.border, c.bg)}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon className={cn('w-5 h-5', c.icon)} />
          <span className="font-semibold text-white">{label}</span>
        </div>
        <span className="text-xs text-gray-500 font-medium">{unit}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[{ l:'Min', v: stats?.min }, { l:'Avg', v: stats?.avg }, { l:'Max', v: stats?.max }].map(s => (
          <div key={s.l} className="text-center bg-black/30 rounded-lg py-3">
            <p className="text-xs text-gray-500 mb-1">{s.l}</p>
            <p className={cn('text-xl font-bold', c.val)}>{s.v != null ? s.v : '—'}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function NetworkTab() {
  const [routers,  setRouters]  = useState([])
  const [speed,    setSpeed]    = useState(null)
  const [pings,    setPings]    = useState({})
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    Promise.all([
      fetchPublic('/api/routers/public').catch(() => []),
      fetchPublic('/api/netspeed/public').catch(() => null),
    ]).then(([r, s]) => {
      setRouters(r || [])
      setSpeed(s)
      // Ping each router via public endpoint
      ;(r || []).forEach(router => {
        fetch(`/api/routers/${router.id}/ping/public`)
          .then(res => res.json())
          .then(data => setPings(p => ({ ...p, [router.id]: data })))
          .catch(() => setPings(p => ({ ...p, [router.id]: { alive: false } })))
      })
    }).finally(() => setLoading(false))
  }, [])

  const pingChart = speed?.tests
    ? [...speed.tests].reverse().slice(-30).filter(t => t.ping != null).map(t => ({ v: Math.round(t.ping) }))
    : []

  if (loading) return <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 text-gray-500 animate-spin" /></div>

  return (
    <div className="space-y-6">
      {/* Routers */}
      {routers.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Routers</h2>
          <div className="space-y-2">
            {routers.map(r => {
              const ping = pings[r.id]
              return (
                <div key={r.id} className="bg-gray-900 rounded-xl border border-gray-800 px-4 py-3 flex items-center gap-3">
                  <div className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0',
                    ping === undefined ? 'bg-gray-600' : ping?.alive ? 'bg-green-500' : 'bg-red-500 animate-pulse')} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white">{r.name}</p>
                    <p className="text-xs text-gray-500 font-mono">{r.ip_address}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {ping?.alive && <span className="text-xs text-green-400 font-mono">{ping.latency_ms}ms</span>}
                    {ping !== undefined && (
                      ping?.alive
                        ? <Wifi className="w-4 h-4 text-green-500" />
                        : <WifiOff className="w-4 h-4 text-red-500" />
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
      {routers.length === 0 && <p className="text-center text-gray-500 py-4">No routers configured</p>}

      {/* Net Speed */}
      <div>
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">Internet Speed</h2>
        {speed?.stats ? (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <SpeedCard label="Download" icon={Download} stats={speed.stats.download} unit="Mbps" color="blue" />
              <SpeedCard label="Upload"   icon={Upload}   stats={speed.stats.upload}   unit="Mbps" color="green" />
              <SpeedCard label="Ping"     icon={Activity} stats={speed.stats.ping}     unit="ms"   color="purple" />
            </div>
            {pingChart.length > 2 && (
              <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
                <p className="text-xs text-gray-500 mb-3">Ping history (last {pingChart.length} tests)</p>
                <div className="h-16">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={pingChart}>
                      <defs>
                        <linearGradient id="pingG" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor="#a855f7" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <Area type="monotone" dataKey="v" stroke="#a855f7" strokeWidth={2} fill="url(#pingG)" dot={false} isAnimationActive={false} />
                      <Tooltip contentStyle={{ fontSize: 11, padding: '2px 6px', borderRadius: 6, border: 'none', background: '#111827', color: '#f9fafb' }} formatter={v => [`${v}ms`, 'Ping']} labelFormatter={() => ''} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>
        ) : (
          <p className="text-center text-gray-500 py-4">No speed test data</p>
        )}
      </div>
    </div>
  )
}

// ── Tab 3: Proxmox ────────────────────────────────────────────────────────────
function UsageBar({ pct, color }) {
  const v = Math.min(Math.max(pct || 0, 0), 100)
  const c = v > 90 ? 'bg-red-500' : v > 75 ? 'bg-yellow-500' : color
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-700 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', c)} style={{ width: `${v}%` }} />
      </div>
      <span className="text-xs font-mono text-gray-400 w-8 text-right">{v}%</span>
    </div>
  )
}

function ProxmoxTab() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchPublic('/api/proxmox/public')
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 text-gray-500 animate-spin" /></div>
  if (!data?.configured) return <p className="text-center text-gray-500 py-12">Proxmox not configured</p>

  return (
    <div className="space-y-4">
      {data.nodes.map(node => (
        <div key={node.node} className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          {/* Node header */}
          <div className="flex items-center gap-4 px-5 py-4 border-b border-gray-800">
            <div className="flex items-center gap-2 flex-1">
              <span className={cn('w-3 h-3 rounded-full', node.status === 'online' ? 'bg-green-500' : 'bg-red-500')} />
              <div>
                <p className="font-semibold text-white">{node.node}</p>
                <p className="text-xs text-gray-500">
                  {node.vm_count ?? '?'} VMs · {node.running ?? '?'} running · {node.status}
                </p>
              </div>
            </div>
            <div className="hidden sm:flex items-center gap-6">
              <div className="text-right">
                <p className="text-xs text-gray-500 mb-1">CPU {node.maxcpu ? `(${node.maxcpu} cores)` : ''}</p>
                <UsageBar pct={node.cpu_usage} color="bg-blue-500" />
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500 mb-1">RAM {node.mem_used_gb}/{node.mem_max_gb} GB</p>
                <UsageBar pct={node.mem_usage} color="bg-purple-500" />
              </div>
              <div className="text-right">
                <p className="text-xs text-gray-500 mb-1">Disk</p>
                <UsageBar pct={node.disk_usage} color="bg-orange-500" />
              </div>
              {node.uptime && <p className="text-xs text-gray-400">{fmtUptime(node.uptime)}</p>}
            </div>
          </div>

          {/* Mobile bars */}
          <div className="sm:hidden px-5 py-3 grid grid-cols-3 gap-3 border-b border-gray-800">
            {[
              { label: `CPU${node.maxcpu ? ` (${node.maxcpu}c)` : ''}`, pct: node.cpu_usage, color: 'bg-blue-500' },
              { label: `RAM ${node.mem_used_gb}/${node.mem_max_gb}G`, pct: node.mem_usage, color: 'bg-purple-500' },
              { label: 'Disk', pct: node.disk_usage, color: 'bg-orange-500' },
            ].map(s => (
              <div key={s.label}>
                <p className="text-xs text-gray-500 mb-1">{s.label}</p>
                <UsageBar pct={s.pct} color={s.color} />
              </div>
            ))}
          </div>

          {/* Storage */}
          {node.storages?.length > 0 && (
            <div className="px-5 py-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5" />Storage
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {node.storages.map(s => (
                  <div key={s.storage} className="bg-gray-800 rounded-lg px-3 py-2.5">
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-xs font-medium text-white truncate">{s.storage}</p>
                      <span className="text-xs text-gray-500 ml-1">{s.type}</span>
                    </div>
                    {s.usage_pct != null && <UsageBar pct={s.usage_pct} color="bg-orange-500" />}
                    <p className="text-xs text-gray-500 mt-1">{s.used_gb} / {s.total_gb} GB</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}


// ── Tab 4: M365 Service Health ────────────────────────────────────────────────
function M365Tab() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchPublic('/api/m365/health/public')
      .then(d => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex justify-center py-12"><RefreshCw className="w-6 h-6 text-gray-500 animate-spin" /></div>
  if (!data?.configured) return (
    <p className="text-center text-gray-500 py-12">Microsoft 365 not configured</p>
  )

  const STATUS_DOT_M365 = (status) => {
    if (!status || status === 'serviceOperational') return 'bg-green-500'
    if (status.includes('Degraded') || status.includes('Advisory') || status.includes('Warning')) return 'bg-yellow-500'
    return 'bg-red-500 animate-pulse'
  }

  const issueCount = data.services.filter(s => s.active_issues > 0).length
  const allOk      = issueCount === 0

  return (
    <div className="space-y-4">
      {/* Overall banner */}
      <div className={cn('rounded-xl border p-4 text-center',
        allOk ? 'bg-green-900/20 border-green-800' : 'bg-yellow-900/20 border-yellow-800')}>
        <div className="flex items-center justify-center gap-2">
          <span className={cn('w-3 h-3 rounded-full', allOk ? 'bg-green-500' : 'bg-yellow-500')} />
          <span className={cn('font-semibold', allOk ? 'text-green-300' : 'text-yellow-300')}>
            {allOk ? 'All Microsoft 365 services operational' : `${issueCount} service${issueCount > 1 ? 's' : ''} with issues`}
          </span>
        </div>
      </div>

      {/* Services list */}
      <div className="bg-gray-900 rounded-xl border border-gray-800 divide-y divide-gray-800">
        {[...data.services]
          .sort((a, b) => b.active_issues - a.active_issues)
          .map(s => (
            <div key={s.service} className="px-5 py-3">
              <div className="flex items-center gap-3">
                <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', STATUS_DOT_M365(s.status))} />
                <span className="text-sm font-medium text-white flex-1">{s.service}</span>
                {s.active_issues === 0
                  ? <span className="text-xs text-green-400">Operational</span>
                  : <span className="text-xs font-semibold px-2 py-0.5 rounded bg-yellow-900/50 text-yellow-400 border border-yellow-700">
                      {s.active_issues} issue{s.active_issues > 1 ? 's' : ''}
                    </span>
                }
              </div>
              {s.issues?.map((issue, i) => (
                <div key={i} className="mt-2 ml-6 pl-3 border-l-2 border-yellow-700">
                  <p className="text-xs font-medium text-gray-300">{issue.title}</p>
                  {issue.impactDescription && (
                    <p className="text-xs text-gray-500 mt-0.5">{issue.impactDescription}</p>
                  )}
                </div>
              ))}
            </div>
          ))
        }
      </div>
    </div>
  )
}

// ── Main Status Page ──────────────────────────────────────────────────────────
const TABS = [
  { key: 'uptime',  label: 'Uptime Monitor' },
  { key: 'network', label: 'Network' },
  { key: 'proxmox', label: 'Proxmox' },
  { key: 'm365',    label: 'M365 Health' },
]

export default function StatusPage() {
  const [tab,         setTab]         = useState('uptime')
  const [lastUpdated, setLastUpdated] = useState(new Date())
  const intervalRef = useRef(null)

  // Auto-refresh by remounting tabs every 30s
  const [tick, setTick] = useState(0)
  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setLastUpdated(new Date())
      setTick(t => t + 1)
    }, REFRESH_MS)
    return () => clearInterval(intervalRef.current)
  }, [])

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <div className="border-b border-gray-800 bg-gray-900/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4">
          <div className="flex items-center justify-between py-4">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-brand rounded-lg flex items-center justify-center">
                <Shield className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="font-bold text-white">Krajcara Admin</p>
                <p className="text-xs text-gray-500">System Status</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <RefreshCw className="w-3 h-3" />
              <span>Updated {lastUpdated.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-0 -mb-px">
            {TABS.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={cn('px-4 py-2.5 text-sm font-medium border-b-2 transition-colors',
                  tab === t.key
                    ? 'border-brand text-brand'
                    : 'border-transparent text-gray-500 hover:text-gray-300')}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 py-8">
        {tab === 'uptime'  && <UptimeTab  key={`uptime-${tick}`} />}
        {tab === 'network' && <NetworkTab key={`network-${tick}`} />}
        {tab === 'proxmox' && <ProxmoxTab key={`proxmox-${tick}`} />}
        {tab === 'm365'    && <M365Tab    key={`m365-${tick}`} />}
      </div>

      <div className="text-center py-6 text-xs text-gray-600">
        Auto-refresh every 30 seconds
      </div>
    </div>
  )
}
