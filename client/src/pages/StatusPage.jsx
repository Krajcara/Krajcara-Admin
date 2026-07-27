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
    <div style={{ textAlign: 'right' }}>
      <div style={{ fontSize: 28, fontWeight: 700, fontFamily: 'monospace', color: '#e6edf3', lineHeight: 1 }}>
        {t.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </div>
      <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#484f58', marginTop: 3 }}>
        {t.toLocaleDateString('en', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
      </div>
    </div>
  )
}

function Dot({ status }) {
  const c = status === 'ok' ? '#3fb950' : status === 'degraded' ? '#d29922' : status === 'down' ? '#f85149' : '#484f58'
  return <span style={{ width: 7, height: 7, borderRadius: '50%', background: c, flexShrink: 0, display: 'inline-block', animation: status === 'down' ? 'pulse 1.5s infinite' : 'none' }} />
}

function Badge({ status, label }) {
  const s = {
    ok:      { background: '#0f2a1a', color: '#3fb950' },
    degraded:{ background: '#2d1f0a', color: '#d29922' },
    down:    { background: '#2d0a0a', color: '#f85149' },
    unknown: { background: '#161b22', color: '#484f58' },
  }[status] || { background: '#161b22', color: '#484f58' }
  return <span style={{ ...s, fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 20, whiteSpace: 'nowrap' }}>{label}</span>
}

function MiniBar({ pct, color }) {
  const c = pct >= 90 ? '#f85149' : pct >= 70 ? '#d29922' : color
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <div style={{ width: 48, height: 3, background: '#21262d', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, pct || 0)}%`, height: '100%', background: c, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 10, fontFamily: 'monospace', color: pct >= 90 ? '#f85149' : pct >= 70 ? '#d29922' : '#6e7681', minWidth: 26 }}>{pct}%</span>
    </div>
  )
}

const S = {
  sec:    { background: '#161b22', border: '1px solid #21262d', borderRadius: 8, overflow: 'hidden' },
  sh:     { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 12px', background: '#0d1117', borderBottom: '1px solid #21262d' },
  st:     { fontSize: 9, fontWeight: 600, color: '#6e7681', letterSpacing: '0.08em', textTransform: 'uppercase' },
  sc:     { fontSize: 10, color: '#484f58' },
  row:    { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #21262d' },
  rowL:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px' },
  rl:     { display: 'flex', alignItems: 'center', gap: 8 },
  rr:     { display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 },
  rn:     { fontSize: 12, fontWeight: 500, color: '#e6edf3' },
  rs:     { fontSize: 10, color: '#484f58', marginTop: 1 },
}

// M365 service status → ok/degraded/down
function m365Status(s) {
  if (!s) return 'unknown'
  if (s.active_issues > 0) return s.status?.toLowerCase().includes('incident') ? 'down' : 'degraded'
  return 'ok'
}

export default function StatusPage() {
  const [monitors,   setMonitors]   = useState([])
  const [routers,    setRouters]    = useState([])
  const [routerPings,setRouterPings]= useState({})
  const [dns,        setDns]        = useState([])
  const [domains,    setDomains]    = useState(null)
  const [speed,      setSpeed]      = useState(null)
  const [proxmox,    setProxmox]    = useState(null)
  const [m365,       setM365]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [lastUpdate, setLastUpdate] = useState(null)
  const ref = useRef(null)

  const load = async () => {
    const [mon, rtr, dnsData, domData, spd, prx, m3] = await Promise.allSettled([
      fp('/api/monitors/public').catch(() => []),
      fp('/api/routers/public').catch(() => []),
      fp('/api/dns/servers/public').catch(() => []),
      fp('/api/dns/domains/public').catch(() => null),
      fp('/api/netspeed/public').catch(() => null),
      fp('/api/proxmox/public').catch(() => null),
      fp('/api/m365/health/public').catch(() => null),
    ])
    const rtrVal = rtr.status === 'fulfilled' ? (rtr.value || []) : []
    if (mon.status     === 'fulfilled') setMonitors(mon.value || [])
    if (rtr.status     === 'fulfilled') setRouters(rtrVal)
    if (dnsData.status === 'fulfilled') setDns(dnsData.value || [])
    if (domData.status === 'fulfilled') setDomains(domData.value)
    if (spd.status     === 'fulfilled') setSpeed(spd.value)
    if (prx.status     === 'fulfilled') setProxmox(prx.value)
    if (m3.status      === 'fulfilled') setM365(m3.value)
    setLastUpdate(new Date())
    setLoading(false)

    for (const r of rtrVal) {
      fp(`/api/routers/${r.id}/ping/public`)
        .then(p => setRouterPings(prev => ({ ...prev, [r.id]: p.alive })))
        .catch(() => setRouterPings(prev => ({ ...prev, [r.id]: false })))
    }
  }

  useEffect(() => { load(); ref.current = setInterval(load, REFRESH_MS); return () => clearInterval(ref.current) }, [])

  // ── Totals ──────────────────────────────────────────────────────────────────
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

  const M365_FILTER = new Set(['Exchange Online','SharePoint Online','Microsoft Intune','Microsoft OneDrive','Microsoft Teams','Microsoft Entra'])
  const m365Services = m365?.configured ? (m365.services || []).filter(s => M365_FILTER.has(s.service)) : []
  const m365Ok      = m365Services.filter(s => m365Status(s) === 'ok').length
  const m365Issues  = m365Services.filter(s => m365Status(s) !== 'ok').length

  const allStatuses = [
    ...monitors.map(m => m.last_status === 'up' ? 'ok' : m.last_status === 'degraded' ? 'degraded' : 'down'),
    ...routers.map(r => routerPings[r.id] !== false ? 'ok' : 'down'),
    ...dns.map(d => d.is_online ? 'ok' : 'down'),
    ...pxNodes.map(n => n.status === 'online' ? 'ok' : 'down'),
    ...m365Services.map(s => m365Status(s)),
  ]
  const totalOk       = allStatuses.filter(s => s === 'ok').length
  const totalDegraded = allStatuses.filter(s => s === 'degraded').length
  const totalDown     = allStatuses.filter(s => s === 'down').length
  const totalAll      = allStatuses.length

  const lastTest = speed?.tests?.[0] || null

  return (
    <div style={{ background: '#0d1117', padding: '20px 24px', minHeight: '100vh' }}>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}`}</style>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 14 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 500, color: '#e6edf3' }}>System status</h1>
          <p style={{ fontSize: 11, color: '#484f58', marginTop: 3 }}>
            {lastUpdate ? `Updated ${lastUpdate.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · auto-refresh every 30s` : 'Loading...'}
          </p>
        </div>
        <Clock />
      </div>

      {loading ? (
        <p style={{ color: '#484f58', textAlign: 'center', paddingTop: 60 }}>Loading...</p>
      ) : (
        <>
          {/* Banner */}
          {totalAll > 0 && (
            totalDown === 0 && totalDegraded === 0 ? (
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', background:'#0f2a1a', border:'1px solid #1a4731', borderRadius:8, marginBottom:12, fontSize:12, color:'#3fb950', fontWeight:500 }}>
                <span style={{ width:7, height:7, borderRadius:'50%', background:'#3fb950', flexShrink:0, display:'inline-block' }} />All systems operational
              </div>
            ) : totalDown > 0 ? (
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', background:'#2d0a0a', border:'1px solid #5c1010', borderRadius:8, marginBottom:12, fontSize:12, color:'#f85149', fontWeight:500 }}>
                <span style={{ width:7, height:7, borderRadius:'50%', background:'#f85149', flexShrink:0, display:'inline-block', animation:'pulse 1.5s infinite' }} />{totalDown} service{totalDown!==1?'s':''} down{totalDegraded>0?`, ${totalDegraded} degraded`:''}
              </div>
            ) : (
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'8px 12px', background:'#2d1f0a', border:'1px solid #5c3d10', borderRadius:8, marginBottom:12, fontSize:12, color:'#d29922', fontWeight:500 }}>
                <span style={{ width:7, height:7, borderRadius:'50%', background:'#d29922', flexShrink:0, display:'inline-block' }} />{totalDegraded} service{totalDegraded!==1?'s':''} degraded
              </div>
            )
          )}

          {/* Summary boxes */}
          <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, marginBottom:14 }}>
            {[
              { n: totalOk,       l: 'Operational', c: '#3fb950' },
              { n: totalDegraded, l: 'Degraded',    c: totalDegraded > 0 ? '#d29922' : '#484f58' },
              { n: totalDown,     l: 'Down',        c: totalDown > 0 ? '#f85149' : '#484f58' },
              { n: totalAll,      l: 'Total',       c: '#e6edf3' },
            ].map(s => (
              <div key={s.l} style={{ background:'#161b22', border:'1px solid #21262d', borderRadius:8, padding:'10px 12px', textAlign:'center' }}>
                <div style={{ fontSize:20, fontWeight:500, color:s.c }}>{s.n}</div>
                <div style={{ fontSize:10, color:'#6e7681', marginTop:2 }}>{s.l}</div>
              </div>
            ))}
          </div>

          {/* 2-column layout */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, alignItems:'start' }}>

            {/* ── LEFT COLUMN ─────────────────────────────────── */}
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>

              {/* Uptime monitors */}
              {monitors.length > 0 && (
                <div style={S.sec}>
                  <div style={S.sh}><span style={S.st}>Uptime monitors</span><span style={S.sc}>{monitors.length} monitors</span></div>
                  <div style={S.rowL}>
                    <div style={S.rl}><Dot status={monStatus} /><div>
                      <div style={S.rn}>{monUp} / {monitors.length} online</div>
                      <div style={S.rs}>{monDown > 0 ? `${monDown} down` : monDegraded > 0 ? `${monDegraded} degraded` : 'all operational'}{monDown > 0 && monDegraded > 0 ? `, ${monDegraded} degraded` : ''}</div>
                    </div></div>
                    <Badge status={monStatus} label={monStatus==='ok'?'All up':monStatus==='degraded'?`${monDegraded} Degraded`:`${monDown} Down`} />
                  </div>
                </div>
              )}

              {/* Routers */}
              {routers.length > 0 && (
                <div style={S.sec}>
                  <div style={S.sh}><span style={S.st}>Routers</span><span style={S.sc}>{routers.length} router{routers.length!==1?'s':''}</span></div>
                  {routers.map((r, i) => {
                    const alive = routerPings[r.id] !== false
                    return (
                      <div key={r.id} style={i===routers.length-1 ? S.rowL : S.row}>
                        <div style={S.rl}><Dot status={alive?'ok':'down'} /><div>
                          <div style={S.rn}>{r.name}</div>
                          <div style={S.rs}>{r.brand||'Router'} · {r.ip_address}</div>
                        </div></div>
                        <Badge status={alive?'ok':'down'} label={alive?'Online':'Offline'} />
                      </div>
                    )
                  })}
                </div>
              )}

              {/* DNS servers */}
              {dns.length > 0 && (
                <div style={S.sec}>
                  <div style={S.sh}><span style={S.st}>DNS servers</span><span style={S.sc}>{dns.length} servers</span></div>
                  {dns.map((d, i) => (
                    <div key={d.id} style={i===dns.length-1 ? S.rowL : S.row}>
                      <div style={S.rl}><Dot status={d.is_online?'ok':'down'} /><div>
                        <div style={S.rn}>{d.name}{d.role && <span style={{ fontSize:9, color:d.role==='primary'?'#58a6ff':'#6e7681', marginLeft:5 }}>{d.role.toUpperCase()}</span>}</div>
                        <div style={S.rs}>{d.type||'DNS'} · {d.ip_address}</div>
                      </div></div>
                      <Badge status={d.is_online?'ok':'down'} label={d.is_online?'Online':'Offline'} />
                    </div>
                  ))}
                </div>
              )}

              {/* External domains */}
              {domains?.summary?.total > 0 && (
                <div style={S.sec}>
                  <div style={S.sh}><span style={S.st}>External domains</span><span style={S.sc}>{domains.summary.total} domains</span></div>
                  <div style={S.rowL}>
                    <div style={S.rl}><Dot status={domains.summary.issues>0?'degraded':'ok'} /><div>
                      <div style={S.rn}>{domains.summary.ok}/{domains.summary.total} fully configured</div>
                      <div style={S.rs}>{domains.summary.issues>0?`${domains.summary.issues} domain${domains.summary.issues!==1?'s':''} with missing SPF/DKIM/DMARC/MX`:'SPF · DKIM · DMARC · MX — all OK'}</div>
                    </div></div>
                    <Badge status={domains.summary.issues>0?'degraded':'ok'} label={domains.summary.issues>0?`${domains.summary.issues} Issues`:'All OK'} />
                  </div>
                </div>
              )}

            </div>

            {/* ── RIGHT COLUMN ─────────────────────────────────── */}
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>

              {/* Internet speed */}
              {lastTest && (
                <div style={S.sec}>
                  <div style={S.sh}>
                    <span style={S.st}>Internet speed</span>
                    <span style={S.sc}>{new Date(lastTest.created_at+'Z').toLocaleString('en',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span>
                  </div>
                  <div style={S.rowL}>
                    <div style={{ display:'flex', alignItems:'center', gap:20 }}>
                      {[
                        { l:'↓ Download', v:parseFloat(lastTest.download).toFixed(1), u:'Mbps', c:'#58a6ff' },
                        { l:'↑ Upload',   v:parseFloat(lastTest.upload).toFixed(1),   u:'Mbps', c:'#3fb950' },
                        { l:'Ping',       v:Math.round(lastTest.ping),                 u:'ms',   c:'#bc8cff' },
                      ].map(s => (
                        <div key={s.l} style={{ textAlign:'center' }}>
                          <div style={{ fontSize:10, color:'#484f58', marginBottom:2 }}>{s.l}</div>
                          <div style={{ fontSize:18, fontWeight:500, color:s.c, lineHeight:1 }}>{s.v}</div>
                          <div style={{ fontSize:9, color:'#484f58', marginTop:2 }}>{s.u}</div>
                        </div>
                      ))}
                    </div>
                    <Badge status="ok" label="Active" />
                  </div>
                </div>
              )}

              {/* Proxmox */}
              {proxmox?.configured && pxNodes.length > 0 && (
                <div style={S.sec}>
                  <div style={S.sh}><span style={S.st}>Proxmox infrastructure</span><span style={S.sc}>{pxNodes.length} nodes · {pxVMs} VMs/LXC</span></div>
                  {pxNodes.map((n, i) => {
                    const online = n.status === 'online'
                    return (
                      <div key={n.node} style={S.row}>
                        <div style={S.rl}><Dot status={online?'ok':'down'} /><div>
                          <div style={S.rn}>{n.node}</div>
                          <div style={S.rs}>{n.vm_count} VMs · {n.running} running · {n.status}</div>
                        </div></div>
                        <div style={S.rr}>
                          {online && <>
                            <MiniBar pct={n.cpu_usage} color="#58a6ff" />
                            <MiniBar pct={n.mem_usage} color="#bc8cff" />
                          </>}
                          <Badge status={online?'ok':'down'} label={online?'Online':'Offline'} />
                        </div>
                      </div>
                    )
                  })}
                  <div style={{ padding:'6px 12px', borderTop:'1px solid #21262d', display:'flex', alignItems:'center', gap:6 }}>
                    <Dot status={pxRunning < pxVMs ? 'degraded' : 'ok'} />
                    <span style={{ fontSize:11, color:'#6e7681' }}>
                      VMs/LXC: <span style={{ color:'#3fb950', fontWeight:500 }}>{pxRunning} running</span>
                      {' · '}<span style={{ color:pxVMs-pxRunning>0?'#d29922':'#484f58' }}>{pxVMs-pxRunning} stopped</span>
                      {' · '}<span style={{ color:'#484f58' }}>{pxVMs} total</span>
                    </span>
                  </div>
                </div>
              )}

              {/* M365 Service Health */}
              {m365?.configured && m365Services.length > 0 && (
                <div style={S.sec}>
                  <div style={S.sh}>
                    <span style={S.st}>M365 service health</span>
                    <span style={S.sc}>{m365Ok}/{m365Services.length} healthy{m365Issues>0?` · ${m365Issues} issue${m365Issues!==1?'s':''}`:''}</span>
                  </div>
                  {m365Services.map((s, i) => {
                    const st = m365Status(s)
                    const isLast = i === m365Services.length - 1
                    return (
                      <div key={s.service} style={isLast ? S.rowL : S.row}>
                        <div style={S.rl}><Dot status={st} /><div>
                          <div style={S.rn}>{s.service}</div>
                          <div style={S.rs}>{s.active_issues>0?`${s.active_issues} active issue${s.active_issues!==1?'s':''}${s.issues?.[0]?.title?' — '+s.issues[0].title.slice(0,50):''}` : 'No active incidents'}</div>
                        </div></div>
                        <Badge status={st} label={st==='ok'?'Healthy':st==='degraded'?'Degraded':'Incident'} />
                      </div>
                    )
                  })}
                </div>
              )}

            </div>
          </div>
        </>
      )}
    </div>
  )
}
