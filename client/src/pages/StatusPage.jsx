import { useState, useEffect, useRef } from 'react'
import { cn } from '../lib/utils'

const REFRESH_MS = 30000

async function fp(path) {
  const r = await fetch(path)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

function Clock() {
  const [t, setT] = useState(new Date())
  useEffect(() => { const i = setInterval(() => setT(new Date()), 1000); return () => clearInterval(i) }, [])
  return (
    <div className="text-right">
      <div className="text-2xl font-bold font-mono text-gray-900 dark:text-white leading-none">
        {t.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </div>
      <div className="text-xs text-gray-400 font-mono mt-0.5">
        {t.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
      </div>
    </div>
  )
}

function Dot({ status }) {
  return <span className={cn('w-2 h-2 rounded-full flex-shrink-0 inline-block',
    status === 'ok' ? 'bg-green-500' :
    status === 'degraded' ? 'bg-yellow-500' :
    status === 'down' ? 'bg-red-500 animate-pulse' : 'bg-gray-400')} />
}

function Badge({ status, label }) {
  const cls = status === 'ok'
    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
    : status === 'degraded'
    ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
    : status === 'down'
    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
    : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
  return <span className={cn('text-xs font-semibold px-2.5 py-0.5 rounded-full', cls)}>{label}</span>
}

function Section({ title, children }) {
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
      <div className="px-4 py-2.5 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-200 dark:border-gray-800">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{title}</span>
      </div>
      <div className="divide-y divide-gray-100 dark:divide-gray-800">{children}</div>
    </div>
  )
}

function Row({ left, right }) {
  return (
    <div className="flex items-center justify-between px-4 py-3">
      <div className="flex items-center gap-3">{left}</div>
      <div className="flex items-center gap-3 flex-shrink-0">{right}</div>
    </div>
  )
}

export default function StatusPage() {
  const [monitors,   setMonitors]   = useState([])
  const [routers,    setRouters]    = useState([])
  const [dns,        setDns]        = useState([])
  const [speed,      setSpeed]      = useState(null)
  const [proxmox,    setProxmox]    = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [lastUpdate, setLastUpdate] = useState(null)
  const ref = useRef(null)

  const load = async () => {
    const [mon, rtr, dnsData, spd, prx] = await Promise.allSettled([
      fp('/api/monitors/public').catch(() => []),
      fp('/api/routers/public').catch(() => []),
      fp('/api/dns/servers/public').catch(() => []),
      fp('/api/netspeed/public').catch(() => null),
      fp('/api/proxmox/public').catch(() => null),
    ])
    if (mon.status    === 'fulfilled') setMonitors(mon.value || [])
    if (rtr.status    === 'fulfilled') setRouters(rtr.value || [])
    if (dnsData.status=== 'fulfilled') setDns(dnsData.value || [])
    if (spd.status    === 'fulfilled') setSpeed(spd.value)
    if (prx.status    === 'fulfilled') setProxmox(prx.value)
    setLastUpdate(new Date())
    setLoading(false)
  }

  useEffect(() => { load(); ref.current = setInterval(load, REFRESH_MS); return () => clearInterval(ref.current) }, [])

  // ── Monitor summary ───────────────────────────────────────────────────────
  const monUp       = monitors.filter(m => m.last_status === 'up').length
  const monDown     = monitors.filter(m => m.last_status === 'down').length
  const monDegraded = monitors.filter(m => m.last_status === 'degraded').length
  const monStatus   = monDown > 0 ? 'down' : monDegraded > 0 ? 'degraded' : monitors.length > 0 ? 'ok' : 'unknown'

  // ── Overall ───────────────────────────────────────────────────────────────
  const allStatuses = [
    ...monitors.map(m => m.last_status === 'up' ? 'ok' : m.last_status === 'degraded' ? 'degraded' : 'down'),
    ...routers.map(r => r.is_online ? 'ok' : 'down'),
    ...dns.map(d => d.is_online ? 'ok' : 'down'),
    ...(proxmox?.configured ? (proxmox.nodes||[]).map(n => n.status === 'online' ? 'ok' : 'down') : []),
  ]
  const totalDown     = allStatuses.filter(s => s === 'down').length
  const totalDegraded = allStatuses.filter(s => s === 'degraded').length

  // ── Proxmox totals ────────────────────────────────────────────────────────
  const pxNodes   = proxmox?.configured ? (proxmox.nodes || []) : []
  const pxOnline  = pxNodes.filter(n => n.status === 'online').length
  const pxOffline = pxNodes.length - pxOnline
  const pxVMs     = pxNodes.reduce((a, n) => a + (n.vm_total || 0), 0)
  const pxVMsRun  = pxNodes.reduce((a, n) => a + (n.vm_running || 0), 0)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-2xl mx-auto px-4 py-10">

        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">System status</h1>
            <p className="text-sm text-gray-400 mt-1">
              {lastUpdate
                ? `Updated ${lastUpdate.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · auto-refresh 30s`
                : 'Loading...'}
            </p>
          </div>
          <Clock />
        </div>

        {loading ? (
          <div className="flex justify-center py-24"><p className="text-gray-400 text-sm">Loading...</p></div>
        ) : (
          <div className="space-y-4">

            {/* Overall banner */}
            {allStatuses.length > 0 && (
              totalDown === 0 && totalDegraded === 0 ? (
                <div className="flex items-center gap-2.5 px-4 py-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl text-sm text-green-700 dark:text-green-400 font-medium">
                  <span className="w-2.5 h-2.5 rounded-full bg-green-500 flex-shrink-0" />
                  All systems operational
                </div>
              ) : totalDown > 0 ? (
                <div className="flex items-center gap-2.5 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-400 font-medium">
                  <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse flex-shrink-0" />
                  {totalDown} service{totalDown !== 1 ? 's' : ''} down{totalDegraded > 0 ? `, ${totalDegraded} degraded` : ''}
                </div>
              ) : (
                <div className="flex items-center gap-2.5 px-4 py-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl text-sm text-yellow-700 dark:text-yellow-400 font-medium">
                  <span className="w-2.5 h-2.5 rounded-full bg-yellow-500 flex-shrink-0" />
                  {totalDegraded} service{totalDegraded !== 1 ? 's' : ''} degraded
                </div>
              )
            )}

            {/* 1. Uptime monitors — summary only */}
            {monitors.length > 0 && (
              <Section title="Uptime monitors">
                <Row
                  left={<>
                    <Dot status={monStatus} />
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        {monUp}/{monitors.length} online
                      </p>
                      <p className="text-xs text-gray-400">
                        {monDown > 0 ? `${monDown} down` : monDegraded > 0 ? `${monDegraded} degraded` : 'all operational'}
                        {monDown > 0 && monDegraded > 0 ? `, ${monDegraded} degraded` : ''}
                      </p>
                    </div>
                  </>}
                  right={<Badge status={monStatus} label={monStatus === 'ok' ? 'All up' : monStatus === 'degraded' ? 'Degraded' : `${monDown} Down`} />}
                />
              </Section>
            )}

            {/* 2. Routers */}
            {routers.length > 0 && (
              <Section title="Routers">
                {routers.map(r => (
                  <Row key={r.id}
                    left={<>
                      <Dot status={r.is_online ? 'ok' : 'down'} />
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{r.name}</p>
                        <p className="text-xs text-gray-400">{r.ip_address}</p>
                      </div>
                    </>}
                    right={<Badge status={r.is_online ? 'ok' : 'down'} label={r.is_online ? 'Online' : 'Offline'} />}
                  />
                ))}
              </Section>
            )}

            {/* 3. DNS */}
            {dns.length > 0 && (
              <Section title="DNS servers">
                {dns.map(d => (
                  <Row key={d.id}
                    left={<>
                      <Dot status={d.is_online ? 'ok' : 'down'} />
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">{d.name}</p>
                        <p className="text-xs text-gray-400">{d.type || 'DNS'} · {d.ip_address}</p>
                      </div>
                    </>}
                    right={<Badge status={d.is_online ? 'ok' : 'down'} label={d.is_online ? 'Online' : 'Offline'} />}
                  />
                ))}
              </Section>
            )}

            {/* 4. Net speed — last measurement only */}
            {speed?.last && (
              <Section title="Internet speed">
                <Row
                  left={<>
                    <Dot status="ok" />
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        ↓ {parseFloat(speed.last.download).toFixed(1)} Mbps &nbsp;·&nbsp; ↑ {parseFloat(speed.last.upload).toFixed(1)} Mbps &nbsp;·&nbsp; {Math.round(speed.last.ping)} ms ping
                      </p>
                      <p className="text-xs text-gray-400">
                        Last test: {new Date(speed.last.created_at + 'Z').toLocaleString('en', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </>}
                  right={<Badge status="ok" label="Active" />}
                />
              </Section>
            )}

            {/* 5. Proxmox — summary */}
            {proxmox?.configured && pxNodes.length > 0 && (
              <Section title="Proxmox infrastructure">
                {/* Nodes row */}
                <Row
                  left={<>
                    <Dot status={pxOffline > 0 ? 'down' : 'ok'} />
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        Nodes: {pxOnline}/{pxNodes.length} online
                        {pxOffline > 0 && <span className="text-red-500 ml-2">({pxOffline} offline)</span>}
                      </p>
                      <p className="text-xs text-gray-400">
                        {pxNodes.map(n => n.node).join(', ')}
                      </p>
                    </div>
                  </>}
                  right={<Badge status={pxOffline > 0 ? 'down' : 'ok'} label={pxOffline > 0 ? `${pxOffline} Offline` : 'All online'} />}
                />
                {/* VMs/LXC row */}
                <Row
                  left={<>
                    <Dot status={pxVMsRun < pxVMs ? 'degraded' : 'ok'} />
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        VMs/LXC: {pxVMsRun}/{pxVMs} running
                        {(pxVMs - pxVMsRun) > 0 && <span className="text-yellow-500 ml-2">({pxVMs - pxVMsRun} stopped)</span>}
                      </p>
                      <p className="text-xs text-gray-400">
                        across {pxNodes.length} node{pxNodes.length !== 1 ? 's' : ''}
                      </p>
                    </div>
                  </>}
                  right={<Badge status={pxVMsRun === pxVMs ? 'ok' : 'degraded'} label={`${pxVMsRun}/${pxVMs} running`} />}
                />
              </Section>
            )}

            {allStatuses.length === 0 && (
              <p className="text-center py-16 text-gray-400 text-sm">No services configured yet.</p>
            )}

          </div>
        )}
      </div>
    </div>
  )
}
