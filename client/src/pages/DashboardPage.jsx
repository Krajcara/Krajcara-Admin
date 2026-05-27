import { useState, useEffect, useCallback } from 'react'
import {
  Activity, Server, KeyRound, AppWindow,
  RefreshCw, Wifi, WifiOff, Download, Upload, CheckCircle, Globe,
  AlertCircle, AlertTriangle, Info, Bell
} from 'lucide-react'
import { Card, CardHeader, CardTitle, Spinner, Badge } from '../components/shared/UI'
import { cn } from '../lib/utils'
import api from '../lib/api'
import { useSocket } from '../hooks/useSocket'

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtVal(v, d = 1) {
  if (v == null) return '—'
  return Number(v).toFixed(d)
}
function fmtUptime(secs) {
  if (!secs) return null
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600)
  if (d > 0) return `${d}d ${h}h`
  return `${h}h ${Math.floor((secs % 3600) / 60)}m`
}
function UsageBar({ pct, color = 'bg-brand' }) {
  const v = Math.min(Math.max(pct || 0, 0), 100)
  const c = v > 90 ? 'bg-red-500' : v > 75 ? 'bg-yellow-500' : color
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', c)} style={{ width: `${v}%` }} />
      </div>
      <span className="text-xs text-gray-400 w-7 text-right">{v}%</span>
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function DashCard({ label, icon: Icon, color, children, sub }) {
  const colors = {
    blue:   'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    green:  'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    red:    'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
    yellow: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400',
  }
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{label}</p>
          <div className="mt-2">{children}</div>
          {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
        </div>
        <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 ml-3', colors[color])}>
          <Icon className="w-4 h-4" />
        </div>
      </div>
    </Card>
  )
}

// ── Row 1: Stat cards ─────────────────────────────────────────────────────────
function StatsRow({ monitors, proxmox, licences, entraApps }) {
  // Monitor color based on worst status
  const monDown     = monitors.filter(m => m.last_status === 'down').length
  const monDegraded = monitors.filter(m => m.last_status === 'degraded').length
  const monUp       = monitors.filter(m => m.last_status === 'up').length
  const monColor    = monDown > 0 ? 'red' : monDegraded > 0 ? 'yellow' : 'green'

  // Proxmox total — count from vms+lxc arrays
  const totalVMs = proxmox?.nodes?.reduce((a, n) => a + (n.vms?.length || 0) + (n.lxc?.length || 0), 0) || 0
  const totalRun = proxmox?.nodes?.reduce((a, n) => {
    const allVms = [...(n.vms || []), ...(n.lxc || [])]
    return a + allVms.filter(v => v.status === 'running').length
  }, 0) || 0

  // Entra expiring
  const entraNow   = new Date()
  const entraExp   = entraApps.filter(a => {
    if (!a.secret_expiry) return false
    const days = Math.ceil((new Date(a.secret_expiry) - entraNow) / 86400000)
    return days <= 30
  }).length

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {/* Monitors */}
      <DashCard label="Uptime Monitor" icon={Activity} color={monColor}
        sub={monitors.length === 0 ? 'No monitors' : null}>
        {monitors.length === 0 ? (
          <p className="text-lg font-bold text-gray-400">—</p>
        ) : (
          <div className="flex items-center gap-3">
            {monUp       > 0 && <span className="flex items-center gap-1 text-green-600 dark:text-green-400 font-semibold"><span className="w-2 h-2 rounded-full bg-green-500" />{monUp} up</span>}
            {monDegraded > 0 && <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400 font-semibold"><span className="w-2 h-2 rounded-full bg-yellow-400" />{monDegraded}</span>}
            {monDown     > 0 && <span className="flex items-center gap-1 text-red-600 dark:text-red-400 font-semibold"><span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />{monDown} down</span>}
          </div>
        )}
      </DashCard>

      {/* Proxmox */}
      <DashCard label="Proxmox" icon={Server} color="blue"
        sub={proxmox?.nodes ? `${proxmox.nodes.length} node${proxmox.nodes.length !== 1 ? 's' : ''}` : null}>
        {!proxmox?.configured ? (
          <p className="text-lg font-bold text-gray-400">—</p>
        ) : (
          <div>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{totalRun}<span className="text-sm font-normal text-gray-400 ml-1">/ {totalVMs} running</span></p>
          </div>
        )}
      </DashCard>

      {/* Licences */}
      <DashCard label="Licences" icon={KeyRound} color="purple"
        sub={`${licences.length} licence${licences.length !== 1 ? 's' : ''}`}>
        <p className="text-2xl font-bold text-gray-900 dark:text-white">{licences.length}</p>
      </DashCard>

      {/* Entra ID Apps */}
      <DashCard label="Entra ID Apps" icon={AppWindow} color={entraExp > 0 ? 'red' : 'blue'}
        sub={entraExp > 0 ? `${entraExp} secret${entraExp > 1 ? 's' : ''} expiring soon` : 'All secrets OK'}>
        <p className="text-2xl font-bold text-gray-900 dark:text-white">{entraApps.length}</p>
      </DashCard>
    </div>
  )
}

// ── Row 2: Proxmox nodes ──────────────────────────────────────────────────────
function ProxmoxRow({ proxmox }) {
  if (!proxmox?.configured || !proxmox?.nodes?.length) return null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Proxmox nodes</CardTitle>
          <span className="text-xs text-gray-400">{proxmox.nodes.length} node{proxmox.nodes.length > 1 ? 's' : ''}</span>
        </div>
      </CardHeader>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {proxmox.nodes.map(node => (
          <div key={node.node} className="px-5 py-4">
            {/* Node header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className={cn('w-2.5 h-2.5 rounded-full', node.status === 'online' ? 'bg-green-500' : 'bg-red-500 animate-pulse')} />
                <span className="font-semibold text-gray-900 dark:text-white">{node.node}</span>
                <span className="text-xs text-gray-400">{node.status}</span>
                {node.uptime && <span className="text-xs text-gray-400">· {fmtUptime(node.uptime)}</span>}
              </div>
              <div className="flex items-center gap-1 text-xs text-gray-500">
                <span className="font-semibold text-gray-900 dark:text-white">
                  {[...(node.vms || []), ...(node.lxc || [])].filter(v => v.status === 'running').length}
                </span>
                <span>/ {(node.vms?.length || 0) + (node.lxc?.length || 0)} running</span>
              </div>
            </div>

            {/* Node resource bars */}
            {node.status === 'online' && (
              <div className="grid grid-cols-3 gap-4 mb-3">
                <div>
                  <p className="text-xs text-gray-400 mb-1">CPU {node.maxcpu ? `(${node.maxcpu}c)` : ''}</p>
                  <UsageBar pct={node.cpu_usage} color="bg-brand" />
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">RAM {node.mem_used_gb}/{node.mem_max_gb} GB</p>
                  <UsageBar pct={node.mem_usage} color="bg-purple-500" />
                </div>
                <div>
                  <p className="text-xs text-gray-400 mb-1">Disk</p>
                  <UsageBar pct={node.disk_usage} color="bg-orange-500" />
                </div>
              </div>
            )}

            {/* VM / LXC list */}
            {node.vms?.length > 0 || node.lxc?.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-1.5">
                {[...(node.vms || []), ...(node.lxc || [])]
                  .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
                  .map(vm => (
                    <div key={`${vm.type}-${vm.vmid}`}
                      className={cn('flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs',
                        vm.status === 'running'
                          ? 'bg-green-50 dark:bg-green-900/20'
                          : 'bg-gray-50 dark:bg-gray-800/50')}>
                      <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0',
                        vm.status === 'running' ? 'bg-green-500' : 'bg-gray-400')} />
                      <span className={cn('truncate font-medium', vm.status === 'running' ? 'text-gray-900 dark:text-white' : 'text-gray-400')}>
                        {vm.name}
                      </span>
                      <span className="text-gray-400 flex-shrink-0 font-mono text-xs">{vm.type?.toUpperCase()}</span>
                    </div>
                  ))
                }
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </Card>
  )
}


// ── DNS Row ───────────────────────────────────────────────────────────────────
function DnsRow({ dnsServers }) {
  const [statuses, setStatuses] = useState({})

  useEffect(() => {
    if (!dnsServers?.length) return
    dnsServers.forEach(s => {
      api.get(`/dns/local/${s.id}/status`)
        .then(r => setStatuses(p => ({ ...p, [s.id]: r.data })))
        .catch(() => setStatuses(p => ({ ...p, [s.id]: { online: false } })))
    })
  }, [dnsServers])

  if (!dnsServers?.length) return null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Local DNS</CardTitle>
          <span className="text-xs text-gray-400">{dnsServers.length} server{dnsServers.length !== 1 ? 's' : ''}</span>
        </div>
      </CardHeader>
      <div className="px-5 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
        {dnsServers.map(s => {
          const st = statuses[s.id]
          const online = st?.online
          return (
            <div key={s.id} className="flex items-center gap-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg px-4 py-3">
              <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0',
                st === undefined ? 'bg-gray-300 dark:bg-gray-600' : online ? 'bg-green-500' : 'bg-red-500 animate-pulse')} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {s.label || s.type} <span className={cn('text-xs font-semibold uppercase ml-1',
                    s.role === 'primary' ? 'text-brand' : 'text-gray-400')}>{s.role}</span>
                </p>
                <p className="text-xs text-gray-400 font-mono">{s.ip}</p>
              </div>
              <div className="flex-shrink-0">
                {st === undefined ? (
                  <span className="text-xs text-gray-400">Checking...</span>
                ) : online ? (
                  <span className="text-xs font-medium text-green-600 dark:text-green-400">Online</span>
                ) : (
                  <span className="text-xs font-medium text-red-500">Offline</span>
                )}
                {st?.stats && (
                  <p className="text-xs text-gray-400 text-right">{st.stats.totalQueries?.toLocaleString()} q/h</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ── Row 3: Net Speed + Monitors ───────────────────────────────────────────────
function BottomRow({ lastSpeed, monitors, monitorStatuses }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Last speed test */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Last speed test</CardTitle>
            {lastSpeed && (
              <span className="text-xs text-gray-400">
                {new Date(lastSpeed.created_at).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </CardHeader>
        <div className="px-5 pb-5">
          {!lastSpeed ? (
            <p className="text-sm text-gray-400 text-center py-4">No speed tests yet</p>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Download', value: lastSpeed.download, unit: 'Mbps', color: 'text-blue-600 dark:text-blue-400', icon: Download, bg: 'bg-blue-50 dark:bg-blue-900/20' },
                { label: 'Upload',   value: lastSpeed.upload,   unit: 'Mbps', color: 'text-green-600 dark:text-green-400', icon: Upload,   bg: 'bg-green-50 dark:bg-green-900/20' },
                { label: 'Ping',     value: lastSpeed.ping,     unit: 'ms',   color: 'text-purple-600 dark:text-purple-400', icon: Activity, bg: 'bg-purple-50 dark:bg-purple-900/20' },
              ].map(s => (
                <div key={s.label} className={cn('rounded-xl p-4 text-center', s.bg)}>
                  <s.icon className={cn('w-4 h-4 mx-auto mb-2', s.color)} />
                  <p className={cn('text-2xl font-bold', s.color)}>
                    {fmtVal(s.value, s.unit === 'ms' ? 0 : 1)}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{s.unit}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      {/* Uptime monitors list */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Uptime Monitor</CardTitle>
            <span className="text-xs text-gray-400">{monitors.length} monitor{monitors.length !== 1 ? 's' : ''}</span>
          </div>
        </CardHeader>
        <div className="px-5 pb-4">
          {monitors.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-4">No monitors configured</p>
          ) : (
            <div className="space-y-1.5">
              {[...monitors]
                .sort((a, b) => {
                  // Down first, then degraded, then up
                  const order = { down: 0, degraded: 1, unknown: 2, up: 3 }
                  const as = monitorStatuses[a.id] || a.last_status || 'unknown'
                  const bs = monitorStatuses[b.id] || b.last_status || 'unknown'
                  if (order[as] !== order[bs]) return order[as] - order[bs]
                  return a.label.localeCompare(b.label)
                })
                .map(m => {
                  const status = monitorStatuses[m.id] || m.last_status || 'unknown'
                  const dot = { up: 'bg-green-500', down: 'bg-red-500 animate-pulse', degraded: 'bg-yellow-400 animate-pulse', unknown: 'bg-gray-400' }[status]
                  const badge = { up: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300', down: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', degraded: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300', unknown: 'bg-gray-100 text-gray-500 dark:bg-gray-800' }[status]
                  return (
                    <div key={m.id} className="flex items-center gap-2.5 py-1.5">
                      <span className={cn('w-2 h-2 rounded-full flex-shrink-0', dot)} />
                      <span className="flex-1 text-sm text-gray-900 dark:text-white truncate">{m.label}</span>
                      {m.last_latency_ms != null && <span className="text-xs text-gray-400 font-mono">{m.last_latency_ms}ms</span>}
                      <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0', badge)}>
                        {status}
                      </span>
                    </div>
                  )
                })
              }
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}


// ── Notifications panel ───────────────────────────────────────────────────────
function NotificationsPanel({ notifications }) {
  const TYPE_ICON = {
    error:   <AlertCircle   className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />,
    warning: <AlertTriangle className="w-3.5 h-3.5 text-yellow-500 flex-shrink-0 mt-0.5" />,
    success: <CheckCircle   className="w-3.5 h-3.5 text-green-500 flex-shrink-0 mt-0.5" />,
    info:    <Info          className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />,
  }
  const TYPE_BG = {
    error:   'border-l-red-500 bg-red-50 dark:bg-red-900/10',
    warning: 'border-l-yellow-500 bg-yellow-50 dark:bg-yellow-900/10',
    success: 'border-l-green-500 bg-green-50 dark:bg-green-900/10',
    info:    'border-l-blue-500 bg-blue-50 dark:bg-blue-900/10',
  }
  const unread = notifications.filter(n => !n.read).length

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CardTitle>Notifications</CardTitle>
            {unread > 0 && (
              <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 font-bold">{unread}</span>
            )}
          </div>
          <a href="/notification-log" className="text-xs text-brand hover:underline">View all</a>
        </div>
      </CardHeader>
      <div className="pb-3">
        {notifications.length === 0 ? (
          <div className="text-center py-6">
            <CheckCircle className="w-8 h-8 text-green-400 mx-auto mb-1" />
            <p className="text-sm text-gray-400">No notifications</p>
          </div>
        ) : (
          <div className="space-y-1 px-4">
            {notifications.map(n => (
              <div key={n.id} className={cn(
                'flex items-start gap-2.5 px-3 py-2 rounded-r-lg border-l-2 transition-colors',
                TYPE_BG[n.type] || 'border-l-gray-300',
                n.read && 'opacity-60'
              )}>
                {TYPE_ICON[n.type] || TYPE_ICON.info}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white leading-tight truncate">{n.title}</p>
                  {n.message && <p className="text-xs text-gray-500 mt-0.5 truncate">{n.message}</p>}
                </div>
                <p className="text-xs text-gray-400 flex-shrink-0">{timeAgo(n.created_at)}</p>
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const [monitors,         setMonitors]         = useState([])
  const [monitorStatuses,  setMonitorStatuses]   = useState({})
  const [proxmox,          setProxmox]           = useState(null)
  const [licences,         setLicences]          = useState([])
  const [entraApps,        setEntraApps]         = useState([])
  const [lastSpeed,        setLastSpeed]         = useState(null)
  const [dns,              setDns]               = useState(null)
  const [notifications,    setNotifications]     = useState([])
  const [loading,          setLoading]           = useState(true)
  const [lastRefresh,      setLastRefresh]       = useState(null)

  // Real-time monitor status updates
  useSocket({
    'monitor:status': ({ monitorId, status }) => {
      setMonitorStatuses(prev => ({ ...prev, [monitorId]: status }))
    }
  })

  const loadAll = useCallback(async () => {
    try {
      const [monitorsRes, proxmoxRes, licencesRes, entraRes, speedRes, dnsRes, notifRes] = await Promise.allSettled([
        api.get('/monitors'),
        api.get('/proxmox/nodes'),
        api.get('/licences'),
        api.get('/licences/entra-apps'),
        api.get('/netspeed/tests?limit=1'),
        api.get('/dns/local'),
        api.get('/notifications?limit=8'),
      ])

      if (monitorsRes.status === 'fulfilled') {
        const mons = monitorsRes.value.data || []
        setMonitors(mons)
        // Seed statuses from loaded data
        const statuses = {}
        mons.forEach(m => { statuses[m.id] = m.last_status || 'unknown' })
        setMonitorStatuses(statuses)
      }
      if (proxmoxRes.status  === 'fulfilled') setProxmox(proxmoxRes.value.data)
      if (licencesRes.status === 'fulfilled') setLicences(licencesRes.value.data?.licences || [])
      if (entraRes.status    === 'fulfilled') setEntraApps(entraRes.value.data || [])
      if (speedRes.status    === 'fulfilled') {
        const tests = speedRes.value.data || []
        setLastSpeed(tests.find(t => t.status === 'done') || null)
      }
      if (dnsRes.status      === 'fulfilled') setDns(dnsRes.value.data || [])
      if (notifRes.status    === 'fulfilled') setNotifications(notifRes.value.data?.notifications || [])
      setLastRefresh(new Date())
    } catch {}
    finally { setLoading(false) }
  }, [])

  useEffect(() => {
    loadAll()
    const interval = setInterval(loadAll, 60000)
    return () => clearInterval(interval)
  }, [loadAll])

  if (loading) return <div className="flex justify-center py-20"><Spinner className="w-8 h-8" /></div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {lastRefresh && `Updated ${lastRefresh.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}`}
          </p>
        </div>
        <button onClick={loadAll} className="p-2 text-gray-400 hover:text-brand rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" title="Refresh">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <StatsRow
        monitors={monitors.map(m => ({ ...m, last_status: monitorStatuses[m.id] || m.last_status }))}
        proxmox={proxmox}
        licences={licences}
        entraApps={entraApps}
      />

      <ProxmoxRow proxmox={proxmox} />

      <DnsRow dnsServers={dns} />

      <NotificationsPanel notifications={notifications} />

      <BottomRow
        lastSpeed={lastSpeed}
        monitors={monitors}
        monitorStatuses={monitorStatuses}
      />
    </div>
  )
}
