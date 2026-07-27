import { useState, useEffect, useRef } from 'react'
import { cn } from '../lib/utils'

const REFRESH_MS = 30000

async function fetchPublic(path) {
  const r = await fetch(path)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

// ── Status helpers ────────────────────────────────────────────────────────────
const STATUS = {
  ok:       { label: 'Operational', cls: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  degraded: { label: 'Degraded',    cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
  down:     { label: 'Down',        cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  unknown:  { label: 'Unknown',     cls: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' },
}

function StatusBadge({ status }) {
  const s = STATUS[status] || STATUS.unknown
  return <span className={cn('text-xs font-semibold px-2.5 py-0.5 rounded-full', s.cls)}>{s.label}</span>
}

function StatusDot({ status }) {
  const colors = {
    ok:      'bg-green-500',
    degraded:'bg-yellow-500',
    down:    'bg-red-500 animate-pulse',
    unknown: 'bg-gray-400',
  }
  return <span className={cn('w-2 h-2 rounded-full flex-shrink-0', colors[status] || colors.unknown)} />
}

function StatBox({ value, label, color }) {
  const colors = {
    green:  'text-green-600 dark:text-green-400',
    yellow: 'text-yellow-600 dark:text-yellow-400',
    red:    'text-red-600 dark:text-red-400',
    gray:   'text-gray-700 dark:text-gray-300',
  }
  return (
    <div className="bg-gray-100 dark:bg-gray-800/60 rounded-xl px-4 py-3 text-center">
      <p className={cn('text-2xl font-semibold', colors[color] || colors.gray)}>{value}</p>
      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{label}</p>
    </div>
  )
}

function Group({ title, count, children }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-800">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{title}</span>
        <span className="text-xs text-gray-400">{count} {count === 1 ? 'service' : 'services'}</span>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {children}
      </div>
    </div>
  )
}

function ServiceRow({ name, sub, status, right }) {
  return (
    <div className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/30 transition-colors">
      <div className="flex items-center gap-3 min-w-0">
        <StatusDot status={status} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{name}</p>
          {sub && <p className="text-xs text-gray-400 truncate">{sub}</p>}
        </div>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0 ml-4">
        {right}
        <StatusBadge status={status} />
      </div>
    </div>
  )
}

function OverallBanner({ stats }) {
  const { down, degraded, total } = stats
  if (!total) return null
  if (down === 0 && degraded === 0) return (
    <div className="flex items-center gap-2.5 px-4 py-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl text-sm text-green-700 dark:text-green-400">
      <span className="w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0" />
      <span className="font-medium">All systems operational</span>
    </div>
  )
  if (down > 0) return (
    <div className="flex items-center gap-2.5 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-400">
      <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
      <span className="font-medium">{down} service{down !== 1 ? 's' : ''} down{degraded > 0 ? `, ${degraded} degraded` : ''}</span>
    </div>
  )
  return (
    <div className="flex items-center gap-2.5 px-4 py-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl text-sm text-yellow-700 dark:text-yellow-400">
      <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 flex-shrink-0" />
      <span className="font-medium">{degraded} service{degraded !== 1 ? 's' : ''} degraded</span>
    </div>
  )
}

export default function StatusPage() {
  const [monitors,   setMonitors]   = useState([])
  const [routers,    setRouters]    = useState([])
  const [dns,        setDns]        = useState([])
  const [proxmox,    setProxmox]    = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [lastUpdate, setLastUpdate] = useState(null)
  const intervalRef = useRef(null)

  const load = async () => {
    const [mon, rtr, dnsData, prx] = await Promise.allSettled([
      fetchPublic('/api/monitors/public').catch(() => []),
      fetchPublic('/api/routers/public').catch(() => []),
      fetchPublic('/api/dns/servers/public').catch(() => []),
      fetchPublic('/api/proxmox/public').catch(() => null),
    ])
    if (mon.status === 'fulfilled')     setMonitors(mon.value || [])
    if (rtr.status === 'fulfilled')     setRouters(rtr.value || [])
    if (dnsData.status === 'fulfilled') setDns(dnsData.value || [])
    if (prx.status === 'fulfilled')     setProxmox(prx.value)
    setLastUpdate(new Date())
    setLoading(false)
  }

  useEffect(() => {
    load()
    intervalRef.current = setInterval(load, REFRESH_MS)
    return () => clearInterval(intervalRef.current)
  }, [])

  const monitorStatuses  = monitors.map(m => m.last_status === 'up' ? 'ok' : m.last_status === 'degraded' ? 'degraded' : m.last_status === 'down' ? 'down' : 'unknown')
  const routerStatuses   = routers.map(r => r.is_online ? 'ok' : 'down')
  const dnsStatuses      = dns.map(d => d.is_online ? 'ok' : 'down')
  const proxmoxStatuses  = proxmox?.configured ? (proxmox.nodes || []).map(n => n.status === 'online' ? 'ok' : 'down') : []
  const allStatuses      = [...monitorStatuses, ...routerStatuses, ...dnsStatuses, ...proxmoxStatuses]

  const stats = {
    ok:       allStatuses.filter(s => s === 'ok').length,
    degraded: allStatuses.filter(s => s === 'degraded').length,
    down:     allStatuses.filter(s => s === 'down').length,
    total:    allStatuses.length,
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-3xl mx-auto px-4 py-10">

        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">System status</h1>
            <p className="text-sm text-gray-400 mt-1">
              {lastUpdate
                ? `Updated ${lastUpdate.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · auto-refresh every 30s`
                : 'Loading...'}
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <p className="text-gray-400 text-sm">Loading...</p>
          </div>
        ) : (
          <div className="space-y-4">

            <OverallBanner stats={stats} />

            <div className="grid grid-cols-4 gap-3">
              <StatBox value={stats.ok}       label="Operational" color="green" />
              <StatBox value={stats.degraded} label="Degraded"    color={stats.degraded > 0 ? 'yellow' : 'gray'} />
              <StatBox value={stats.down}     label="Down"        color={stats.down > 0 ? 'red' : 'gray'} />
              <StatBox value={stats.total}    label="Total"       color="gray" />
            </div>

            {monitors.length > 0 && (
              <Group title="Uptime monitors" count={monitors.length}>
                {[...monitors].sort((a, b) => a.label.localeCompare(b.label)).map(m => {
                  const status = m.last_status === 'up' ? 'ok' : m.last_status === 'degraded' ? 'degraded' : m.last_status === 'down' ? 'down' : 'unknown'
                  return (
                    <ServiceRow key={m.id} name={m.label}
                      sub={`${(m.type || 'HTTPS').toUpperCase()} · ${m.target}`}
                      status={status}
                      right={m.last_latency_ms != null
                        ? <span className="text-xs font-mono text-gray-400">{m.last_latency_ms} ms</span>
                        : null} />
                  )
                })}
              </Group>
            )}

            {routers.length > 0 && (
              <Group title="Network — routers" count={routers.length}>
                {routers.map(r => (
                  <ServiceRow key={r.id} name={r.name}
                    sub={`Router · ${r.ip_address}`}
                    status={r.is_online ? 'ok' : 'down'} />
                ))}
              </Group>
            )}

            {dns.length > 0 && (
              <Group title="Network — DNS" count={dns.length}>
                {dns.map(d => (
                  <ServiceRow key={d.id} name={d.name}
                    sub={`${d.type || 'DNS'} · ${d.ip_address}`}
                    status={d.is_online ? 'ok' : 'down'} />
                ))}
              </Group>
            )}

            {proxmox?.configured && proxmox.nodes?.length > 0 && (
              <Group title="Infrastructure — Proxmox" count={proxmox.nodes.length}>
                {proxmox.nodes.map(n => (
                  <ServiceRow key={n.node} name={n.node}
                    sub={`Proxmox · ${n.vm_running || 0}/${n.vm_total || 0} VMs/LXC running`}
                    status={n.status === 'online' ? 'ok' : 'down'}
                    right={
                      <div className="flex items-center gap-2 text-xs text-gray-400">
                        <span>CPU {n.cpu_usage}%</span>
                        <span>RAM {n.mem_usage}%</span>
                      </div>
                    } />
                ))}
              </Group>
            )}

            {stats.total === 0 && (
              <p className="text-center py-16 text-gray-400 text-sm">No services configured yet.</p>
            )}

          </div>
        )}
      </div>
    </div>
  )
}
