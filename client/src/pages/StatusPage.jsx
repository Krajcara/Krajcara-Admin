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
  useEffect(() => {
    const i = setInterval(() => setT(new Date()), 1000)
    return () => clearInterval(i)
  }, [])
  return (
    <div className="text-right">
      <div className="text-3xl font-bold font-mono leading-none" style={{ color: '#e6edf3' }}>
        {t.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </div>
      <div className="text-xs font-mono mt-1" style={{ color: '#484f58' }}>
        {t.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
      </div>
    </div>
  )
}

function Dot({ status }) {
  const c = status === 'ok' ? '#3fb950' : status === 'degraded' ? '#d29922' : status === 'down' ? '#f85149' : '#484f58'
  return (
    <span style={{
      width: 8, height: 8, borderRadius: '50%', background: c,
      flexShrink: 0, display: 'inline-block',
      animation: status === 'down' ? 'pulse 1.5s infinite' : 'none',
    }} />
  )
}

function Badge({ status, label }) {
  const styles = {
    ok:      { background: '#0f2a1a', color: '#3fb950' },
    degraded:{ background: '#2d1f0a', color: '#d29922' },
    down:    { background: '#2d0a0a', color: '#f85149' },
    unknown: { background: '#161b22', color: '#484f58' },
  }
  const s = styles[status] || styles.unknown
  return (
    <span style={{ ...s, fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 20 }}>
      {label}
    </span>
  )
}

function MiniBar({ pct, color }) {
  const barColor = pct >= 90 ? '#f85149' : pct >= 70 ? '#d29922' : color
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <div style={{ width: 60, height: 3, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, pct || 0)}%`, height: '100%', background: barColor, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 11, fontFamily: 'monospace', color: pct >= 90 ? '#f85149' : pct >= 70 ? '#d29922' : '#6e7681', minWidth: 28 }}>
        {pct}%
      </span>
    </div>
  )
}

const S = {
  page:    { background: '#0d1117', padding: '24px 20px', minHeight: '100vh' },
  inner:   { maxWidth: 760, margin: '0 auto' },
  section: { background: '#161b22', border: '1px solid #21262d', borderRadius: 10, overflow: 'hidden', marginBottom: 10 },
  secHdr:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 14px', background: '#0d1117', borderBottom: '1px solid #21262d' },
  secTitle:{ fontSize: 10, fontWeight: 600, color: '#6e7681', letterSpacing: '0.08em', textTransform: 'uppercase' },
  secCount:{ fontSize: 11, color: '#484f58' },
  row:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #21262d' },
  rowLast: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px' },
  rl:      { display: 'flex', alignItems: 'center', gap: 10 },
  rr:      { display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 },
  rname:   { fontSize: 13, fontWeight: 500, color: '#e6edf3' },
  rsub:    { fontSize: 11, color: '#484f58', marginTop: 1 },
}

export default function StatusPage() {
  const [monitors,   setMonitors]   = useState([])
  const [routers,    setRouters]    = useState([])
  const [routerPings,setRouterPings]= useState({})
  const [dns,        setDns]        = useState([])
  const [domains,    setDomains]    = useState([])
  const [speed,      setSpeed]      = useState(null)
  const [proxmox,    setProxmox]    = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [lastUpdate, setLastUpdate] = useState(null)
  const ref = useRef(null)

  const load = async () => {
    const [mon, rtr, dnsData, domData, spd, prx] = await Promise.allSettled([
      fp('/api/monitors/public').catch(() => []),
      fp('/api/routers/public').catch(() => []),
      fp('/api/dns/servers/public').catch(() => []),
      fp('/api/dns/domains/public').catch(() => []),
      fp('/api/netspeed/public').catch(() => null),
      fp('/api/proxmox/public').catch(() => null),
    ])
    const rtrVal = rtr.status === 'fulfilled' ? (rtr.value || []) : []
    if (mon.status    === 'fulfilled') setMonitors(mon.value || [])
    if (rtr.status    === 'fulfilled') setRouters(rtrVal)
    if (dnsData.status=== 'fulfilled') setDns(dnsData.value || [])
    if (domData.status=== 'fulfilled') setDomains(domData.value || { domains:[], summary:{total:0,ok:0,issues:0} })
    if (spd.status    === 'fulfilled') setSpeed(spd.value)
    if (prx.status    === 'fulfilled') setProxmox(prx.value)
    setLastUpdate(new Date())
    setLoading(false)

    // Ping each router
    for (const r of rtrVal) {
      fp(`/api/routers/${r.id}/ping/public`)
        .then(p => setRouterPings(prev => ({ ...prev, [r.id]: p.alive })))
        .catch(() => setRouterPings(prev => ({ ...prev, [r.id]: false })))
    }
  }

  useEffect(() => {
    load()
    ref.current = setInterval(load, REFRESH_MS)
    return () => clearInterval(ref.current)
  }, [])

  // ── Stats ───────────────────────────────────────────────────────────────────
  const monUp       = monitors.filter(m => m.last_status === 'up').length
  const monDown     = monitors.filter(m => m.last_status === 'down').length
  const monDegraded = monitors.filter(m => m.last_status === 'degraded').length
  const monStatus   = monDown > 0 ? 'down' : monDegraded > 0 ? 'degraded' : monitors.length > 0 ? 'ok' : 'unknown'

  const rtrOnline   = routers.filter(r => routerPings[r.id] !== false).length
  const dnsOnline   = dns.filter(d => d.is_online).length

  const pxNodes     = proxmox?.configured ? (proxmox.nodes || []) : []
  const pxOnline    = pxNodes.filter(n => n.status === 'online').length
  const pxVMs       = pxNodes.reduce((a, n) => a + (n.vm_count || 0), 0)
  const pxRunning   = pxNodes.reduce((a, n) => a + (n.running || 0), 0)

  const allDown     = monDown + routers.filter(r => routerPings[r.id] === false).length +
                      dns.filter(d => !d.is_online).length +
                      pxNodes.filter(n => n.status !== 'online').length
  const allDegraded = monDegraded

  // Last speed test
  const lastTest    = speed?.tests?.[0] || null

  return (
    <div style={S.page}>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
      <div style={S.inner}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 500, color: '#e6edf3' }}>System status</h1>
            <p style={{ fontSize: 12, color: '#484f58', marginTop: 3 }}>
              {lastUpdate
                ? `Updated ${lastUpdate.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · auto-refresh every 30s`
                : 'Loading...'}
            </p>
          </div>
          <Clock />
        </div>

        {loading ? (
          <p style={{ color: '#484f58', textAlign: 'center', paddingTop: 60 }}>Loading...</p>
        ) : (
          <>
            {/* Overall banner */}
            {allDown === 0 && allDegraded === 0 ? (
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'#0f2a1a', border:'1px solid #1a4731', borderRadius:10, marginBottom:16, fontSize:13, color:'#3fb950', fontWeight:500 }}>
                <span style={{ width:8, height:8, borderRadius:'50%', background:'#3fb950', flexShrink:0, display:'inline-block' }} />
                All systems operational
              </div>
            ) : allDown > 0 ? (
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'#2d0a0a', border:'1px solid #5c1010', borderRadius:10, marginBottom:16, fontSize:13, color:'#f85149', fontWeight:500 }}>
                <span style={{ width:8, height:8, borderRadius:'50%', background:'#f85149', flexShrink:0, display:'inline-block', animation:'pulse 1.5s infinite' }} />
                {allDown} service{allDown !== 1 ? 's' : ''} down{allDegraded > 0 ? `, ${allDegraded} degraded` : ''}
              </div>
            ) : (
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'#2d1f0a', border:'1px solid #5c3d10', borderRadius:10, marginBottom:16, fontSize:13, color:'#d29922', fontWeight:500 }}>
                <span style={{ width:8, height:8, borderRadius:'50%', background:'#d29922', flexShrink:0, display:'inline-block' }} />
                {allDegraded} service{allDegraded !== 1 ? 's' : ''} degraded
              </div>
            )}

            {/* Summary stat boxes */}
            <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:10, marginBottom:16 }}>
              {[
                { n: monitors.filter(m=>m.last_status==='up').length + rtrOnline + dnsOnline + pxOnline, l:'Operational', c:'#3fb950' },
                { n: allDegraded, l:'Degraded', c: allDegraded > 0 ? '#d29922' : '#484f58' },
                { n: allDown,     l:'Down',     c: allDown > 0 ? '#f85149' : '#484f58' },
                { n: monitors.length + routers.length + dns.length + pxNodes.length, l:'Total', c:'#e6edf3' },
              ].map(s => (
                <div key={s.l} style={{ background:'#161b22', border:'1px solid #21262d', borderRadius:10, padding:'12px 14px', textAlign:'center' }}>
                  <div style={{ fontSize:22, fontWeight:500, color:s.c }}>{s.n}</div>
                  <div style={{ fontSize:11, color:'#6e7681', marginTop:3 }}>{s.l}</div>
                </div>
              ))}
            </div>

            {/* 1. Uptime monitors */}
            {monitors.length > 0 && (
              <div style={S.section}>
                <div style={S.secHdr}>
                  <span style={S.secTitle}>Uptime monitors</span>
                  <span style={S.secCount}>{monitors.length} monitors</span>
                </div>
                <div style={S.rowLast}>
                  <div style={S.rl}>
                    <Dot status={monStatus} />
                    <div>
                      <div style={S.rname}>{monUp} / {monitors.length} online</div>
                      <div style={S.rsub}>
                        {monDown > 0 ? `${monDown} down` : monDegraded > 0 ? `${monDegraded} degraded` : 'all operational'}
                        {monDown > 0 && monDegraded > 0 ? `, ${monDegraded} degraded` : ''}
                      </div>
                    </div>
                  </div>
                  <Badge status={monStatus} label={monStatus === 'ok' ? 'All up' : monStatus === 'degraded' ? `${monDegraded} Degraded` : `${monDown} Down`} />
                </div>
              </div>
            )}

            {/* 2. Routers */}
            {routers.length > 0 && (
              <div style={S.section}>
                <div style={S.secHdr}>
                  <span style={S.secTitle}>Routers</span>
                  <span style={S.secCount}>{routers.length} router{routers.length !== 1 ? 's' : ''}</span>
                </div>
                {routers.map((r, i) => {
                  const alive  = routerPings[r.id] !== false
                  const isLast = i === routers.length - 1
                  return (
                    <div key={r.id} style={isLast ? S.rowLast : S.row}>
                      <div style={S.rl}>
                        <Dot status={alive ? 'ok' : 'down'} />
                        <div>
                          <div style={S.rname}>{r.name}</div>
                          <div style={S.rsub}>{r.brand || 'Router'} · {r.ip_address}</div>
                        </div>
                      </div>
                      <Badge status={alive ? 'ok' : 'down'} label={alive ? 'Online' : 'Offline'} />
                    </div>
                  )
                })}
              </div>
            )}

            {/* 3. DNS servers */}
            {dns.length > 0 && (
              <div style={S.section}>
                <div style={S.secHdr}>
                  <span style={S.secTitle}>DNS servers</span>
                  <span style={S.secCount}>{dns.length} servers</span>
                </div>
                {dns.map((d, i) => {
                  const isLast = i === dns.length - 1
                  return (
                    <div key={d.id} style={isLast ? S.rowLast : S.row}>
                      <div style={S.rl}>
                        <Dot status={d.is_online ? 'ok' : 'down'} />
                        <div>
                          <div style={S.rname}>
                            {d.name}
                            {d.role && <span style={{ fontSize:10, color: d.role==='primary'?'#58a6ff':'#6e7681', marginLeft:6, fontWeight:400 }}>{d.role.toUpperCase()}</span>}
                          </div>
                          <div style={S.rsub}>{d.type || 'DNS'} · {d.ip_address}</div>
                        </div>
                      </div>
                      <Badge status={d.is_online ? 'ok' : 'down'} label={d.is_online ? 'Online' : 'Offline'} />
                    </div>
                  )
                })}
              </div>
            )}

            {/* 3c. External domains summary */}
            {domains?.summary?.total > 0 && (
              <div style={S.section}>
                <div style={S.secHdr}>
                  <span style={S.secTitle}>External domains</span>
                  <span style={S.secCount}>{domains.summary.total} domains</span>
                </div>
                <div style={S.rowLast}>
                  <div style={S.rl}>
                    <Dot status={domains.summary.issues > 0 ? 'degraded' : 'ok'} />
                    <div>
                      <div style={S.rname}>
                        {domains.summary.ok}/{domains.summary.total} fully configured
                      </div>
                      <div style={S.rsub}>
                        {domains.summary.issues > 0
                          ? `${domains.summary.issues} domain${domains.summary.issues!==1?'s':''} with missing SPF/DKIM/DMARC/MX`
                          : 'SPF · DKIM · DMARC · MX — all OK'}
                      </div>
                    </div>
                  </div>
                  <Badge
                    status={domains.summary.issues > 0 ? 'degraded' : 'ok'}
                    label={domains.summary.issues > 0 ? `${domains.summary.issues} Issues` : 'All OK'} />
                </div>
              </div>
            )}

            {/* 4. Net speed */}
            {lastTest && (
              <div style={S.section}>
                <div style={S.secHdr}>
                  <span style={S.secTitle}>Internet speed</span>
                  <span style={S.secCount}>
                    {new Date(lastTest.created_at + 'Z').toLocaleString('en', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' })}
                  </span>
                </div>
                <div style={S.rowLast}>
                  <div style={{ display:'flex', alignItems:'center', gap:24 }}>
                    {[
                      { label:'↓ Download', value: parseFloat(lastTest.download).toFixed(1), unit:'Mbps', color:'#58a6ff' },
                      { label:'↑ Upload',   value: parseFloat(lastTest.upload).toFixed(1),   unit:'Mbps', color:'#3fb950' },
                      { label:'Ping',       value: Math.round(lastTest.ping),                 unit:'ms',   color:'#bc8cff' },
                    ].map(s => (
                      <div key={s.label} style={{ textAlign:'center' }}>
                        <div style={{ fontSize:11, color:'#484f58', marginBottom:2 }}>{s.label}</div>
                        <div style={{ fontSize:22, fontWeight:500, color:s.color, lineHeight:1 }}>{s.value}</div>
                        <div style={{ fontSize:10, color:'#484f58', marginTop:2 }}>{s.unit}</div>
                      </div>
                    ))}
                  </div>
                  <Badge status="ok" label="Active" />
                </div>
              </div>
            )}

            {/* 5. Proxmox */}
            {proxmox?.configured && pxNodes.length > 0 && (
              <div style={S.section}>
                <div style={S.secHdr}>
                  <span style={S.secTitle}>Proxmox infrastructure</span>
                  <span style={S.secCount}>{pxNodes.length} nodes · {pxVMs} VMs/LXC</span>
                </div>
                {pxNodes.map((n, i) => {
                  const isLast = i === pxNodes.length - 1
                  const online = n.status === 'online'
                  return (
                    <div key={n.node} style={isLast ? S.rowLast : S.row}>
                      <div style={S.rl}>
                        <Dot status={online ? 'ok' : 'down'} />
                        <div>
                          <div style={S.rname}>{n.node}</div>
                          <div style={S.rsub}>
                            {n.vm_count} VMs · {n.running} running · {n.status}
                          </div>
                        </div>
                      </div>
                      <div style={S.rr}>
                        {online && <>
                          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                              <span style={{ fontSize:10, color:'#6e7681' }}>CPU</span>
                              <MiniBar pct={n.cpu_usage} color="#58a6ff" />
                            </div>
                            <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                              <span style={{ fontSize:10, color:'#6e7681' }}>RAM</span>
                              <MiniBar pct={n.mem_usage} color="#bc8cff" />
                            </div>
                          </div>
                        </>}
                        <Badge status={online ? 'ok' : 'down'} label={online ? 'Online' : 'Offline'} />
                      </div>
                    </div>
                  )
                })}
                {/* VMs summary row */}
                <div style={{ padding:'8px 14px', borderTop:'1px solid #21262d', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                  <div style={S.rl}>
                    <Dot status={pxRunning < pxVMs ? 'degraded' : 'ok'} />
                    <div>
                      <span style={{ fontSize:12, color:'#6e7681' }}>
                        VMs/LXC: <span style={{ color:'#3fb950', fontWeight:500 }}>{pxRunning} running</span>
                        {' · '}
                        <span style={{ color: pxVMs - pxRunning > 0 ? '#d29922' : '#484f58' }}>
                          {pxVMs - pxRunning} stopped
                        </span>
                        {' · '}
                        <span style={{ color:'#484f58' }}>{pxVMs} total</span>
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </>
        )}
      </div>
    </div>
  )
}
