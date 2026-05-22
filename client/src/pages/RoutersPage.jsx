import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Trash2, Pencil, RefreshCw, Network, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { Card, Button, Modal, Input, Select, Textarea, Table, Th, Td, Badge, Empty, Spinner, AlertBox } from '../components/shared/UI'
import { cn } from '../lib/utils'

const BRANDS = [
  { value: 'mikrotik',  label: 'MikroTik' },
  { value: 'cisco',     label: 'Cisco' },
  { value: 'fortigate', label: 'FortiGate' },
  { value: 'ubiquiti',  label: 'Ubiquiti' },
  { value: 'juniper',   label: 'Juniper' },
  { value: 'hp',        label: 'HP / Aruba' },
  { value: 'other',     label: 'Other' },
]

const BRAND_COLOR = {
  mikrotik:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  cisco:     'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  fortigate: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  ubiquiti:  'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  juniper:   'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  hp:        'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  other:     'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

const REFRESH_INTERVALS = [
  { label: '30s',  value: 30 },
  { label: '1 min', value: 60 },
  { label: '2 min', value: 120 },
  { label: '5 min', value: 300 },
]

function fmtBytes(b) {
  if (b == null) return '—'
  if (b >= 1e9) return (b/1e9).toFixed(1) + ' GB'
  if (b >= 1e6) return (b/1e6).toFixed(1) + ' MB'
  if (b >= 1e3) return (b/1e3).toFixed(1) + ' KB'
  return b + ' B'
}

function UsageBar({ pct, color = 'bg-brand' }) {
  if (pct == null) return <span className="text-gray-400 text-xs">—</span>
  const c = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : color
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', c)} style={{ width: `${Math.min(pct,100)}%` }} />
      </div>
      <span className="text-xs font-mono w-8 text-right">{pct}%</span>
    </div>
  )
}

// ── SNMP Stats panel ──────────────────────────────────────────────────────────
function StatsPanel({ routerId, refreshInterval }) {
  const [stats,      setStats]      = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [error,      setError]      = useState(null)
  const [showAllIf,  setShowAllIf]  = useState(false)
  const [lastUpdate, setLastUpdate] = useState(null)
  const intervalRef = useRef(null)

  const fetchStats = useCallback(() => {
    api.get(`/routers/${routerId}/stats`)
      .then(r => {
        setStats(r.data)
        setError(r.data.connected === false ? (r.data.error || 'Could not connect via SNMP') : null)
        setLastUpdate(new Date())
      })
      .catch(e => setError(e.response?.data?.error || 'Request failed'))
      .finally(() => setLoading(false))
  }, [routerId])

  useEffect(() => {
    fetchStats()
    // Auto-refresh
    intervalRef.current = setInterval(fetchStats, refreshInterval * 1000)
    return () => clearInterval(intervalRef.current)
  }, [fetchStats, refreshInterval])

  if (loading) return <div className="flex items-center justify-center py-6"><Spinner className="w-5 h-5" /></div>

  if (error) return (
    <div className="flex items-start gap-2 text-sm text-red-500 py-4 px-4">
      <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <span>{error}</span>
    </div>
  )

  if (!stats) return null

  // Prioritize WAN-like interfaces for top display
  const wanKeywords = ['ether1','wan','wan1','wan2','sfp1','sfp-sfpplus1','pppoe','ppp-out']
  const wanIfaces = (stats.interfaces || []).filter(i =>
    i.link && wanKeywords.some(k => i.name?.toLowerCase().startsWith(k.split('-')[0]))
  )
  const topIfaces = wanIfaces.length > 0 ? wanIfaces : (stats.interfaces || []).filter(i => i.link).slice(0, 4)

  return (
    <div className="px-4 pb-4 space-y-4">
      {/* Uptime + model */}
      <div className="grid grid-cols-2 gap-3">
        {stats.uptime && (
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2">
            <p className="text-xs text-gray-400 mb-0.5">Uptime</p>
            <p className="text-sm font-medium font-mono text-gray-900 dark:text-white">{stats.uptime}</p>
          </div>
        )}
        {stats.model && (
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2">
            <p className="text-xs text-gray-400 mb-0.5">Model</p>
            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{stats.model}</p>
          </div>
        )}
      </div>

      {/* CPU + Memory bars */}
      {(stats.cpu_percent != null || stats.memory_percent != null) && (
        <div className="grid grid-cols-2 gap-3">
          {stats.cpu_percent != null && (
            <div>
              <p className="text-xs text-gray-400 mb-1">CPU</p>
              <UsageBar pct={stats.cpu_percent} color="bg-brand" />
            </div>
          )}
          {stats.memory_percent != null && (
            <div>
              <p className="text-xs text-gray-400 mb-1">Memory</p>
              <UsageBar pct={stats.memory_percent} color="bg-purple-500" />
            </div>
          )}
        </div>
      )}

      {/* Top interfaces */}
      {topIfaces.length > 0 && (
        <div>
          <p className="text-xs text-gray-400 mb-2">
            {wanIfaces.length > 0 ? 'WAN interfaces' : 'Active interfaces'}
          </p>
          <div className="space-y-1.5">
            {topIfaces.map(iface => (
              <div key={iface.name} className="flex items-center justify-between text-xs bg-gray-50 dark:bg-gray-800/50 rounded px-3 py-1.5">
                <span className="font-mono font-medium text-gray-700 dark:text-gray-300 truncate max-w-24">{iface.name}</span>
                <div className="flex items-center gap-3 text-gray-500">
                  <span className="text-green-600 dark:text-green-400">↓ {fmtBytes(iface.rx_bytes)}</span>
                  <span className="text-blue-600 dark:text-blue-400">↑ {fmtBytes(iface.tx_bytes)}</span>
                  {iface.speed ? <span className="text-gray-400">{iface.speed >= 1000 ? `${iface.speed/1000}G` : `${iface.speed}M`}</span> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All interfaces toggle */}
      {(stats.interfaces || []).length > 0 && (
        <div>
          <button onClick={() => setShowAllIf(s => !s)} className="text-xs text-gray-400 hover:text-brand flex items-center gap-1 transition-colors">
            {showAllIf ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {showAllIf ? 'Hide' : 'Show all'} interfaces ({stats.interfaces.length})
          </button>
          {showAllIf && (
            <div className="mt-2 space-y-1">
              {stats.interfaces.map(iface => (
                <div key={iface.name} className={cn('flex items-center justify-between text-xs rounded px-3 py-1.5 bg-gray-50 dark:bg-gray-800/50', !iface.link && 'opacity-40')}>
                  <div className="flex items-center gap-2">
                    <span className={cn('w-1.5 h-1.5 rounded-full', iface.link ? 'bg-green-500' : 'bg-gray-400')} />
                    <span className="font-mono font-medium text-gray-700 dark:text-gray-300 truncate max-w-28">{iface.name}</span>
                  </div>
                  {iface.link && (
                    <div className="flex items-center gap-3 text-gray-500">
                      <span className="text-green-600 dark:text-green-400">↓ {fmtBytes(iface.rx_bytes)}</span>
                      <span className="text-blue-600 dark:text-blue-400">↑ {fmtBytes(iface.tx_bytes)}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="flex items-center justify-between">
        {stats.protocol && <p className="text-xs text-gray-400">via {stats.protocol.toUpperCase()}</p>}
        {lastUpdate && (
          <button onClick={fetchStats} className="text-xs text-gray-400 hover:text-brand transition-colors flex items-center gap-1">
            <RefreshCw className="w-3 h-3" />Updated {lastUpdate.toLocaleTimeString('en', { hour:'2-digit', minute:'2-digit', second:'2-digit' })}
          </button>
        )}
      </div>
    </div>
  )
}

// ── Router form ───────────────────────────────────────────────────────────────
const EMPTY = {
  name:'', brand:'other', model:'', ip_address:'', username:'', password:'', notes:'',
  snmp_version:'2c', snmp_community:'public', snmp_port:161, snmp_username:'',
  snmp_auth_protocol:'SHA', snmp_auth_password:'',
  snmp_priv_protocol:'AES', snmp_priv_password:'', snmp_security_level:'authPriv',
}

function RouterForm({ initial, onSave, onCancel }) {
  const isEdit = !!initial?.id
  const [form, setForm] = useState(isEdit ? { ...EMPTY, ...initial, password:'' } : EMPTY)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [tab, setTab] = useState('basic')
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      isEdit ? await api.put(`/routers/${initial.id}`, form) : await api.post('/routers', form)
      onSave()
    } catch (err) { setError(err.response?.data?.error || 'Error saving router') }
    finally { setLoading(false) }
  }

  return (
    <form onSubmit={submit} autoComplete="off" className="space-y-4">
      {error && <AlertBox type="error">{error}</AlertBox>}
      <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700 -mt-1">
        {['basic','snmp'].map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={cn('px-4 py-2 text-sm font-medium border-b-2 -mb-px capitalize transition-colors',
              tab===t ? 'border-brand text-brand' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300')}>
            {t}
          </button>
        ))}
      </div>
      {tab === 'basic' && <>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Name *" autoComplete="off" value={form.name} onChange={f('name')} required />
          <Select label="Brand" value={form.brand} onChange={f('brand')}>
            {BRANDS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Model" autoComplete="off" value={form.model} onChange={f('model')} />
          <Input label="IP address *" autoComplete="off" value={form.ip_address} onChange={f('ip_address')} placeholder="192.168.1.1" required />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Username" autoComplete="new-password" value={form.username} onChange={f('username')} />
          <Input label={isEdit ? 'Password (blank = keep)' : 'Password'} type="password" autoComplete="new-password" value={form.password} onChange={f('password')} />
        </div>
        <Textarea label="Notes" autoComplete="off" rows={2} value={form.notes||''} onChange={f('notes')} />
      </>}
      {tab === 'snmp' && <>
        <div className="grid grid-cols-2 gap-4">
          <Select label="SNMP version" value={form.snmp_version} onChange={f('snmp_version')}>
            <option value="2c">v2c</option><option value="3">v3</option>
          </Select>
          <Input label="SNMP port" type="number" autoComplete="off" value={form.snmp_port} onChange={f('snmp_port')} />
        </div>
        {form.snmp_version === '2c' && <Input label="Community string" autoComplete="off" value={form.snmp_community} onChange={f('snmp_community')} placeholder="public" />}
        {form.snmp_version === '3' && <>
          <Input label="Username" autoComplete="new-password" value={form.snmp_username} onChange={f('snmp_username')} />
          <Select label="Security level" value={form.snmp_security_level} onChange={f('snmp_security_level')}>
            {['noAuthNoPriv','authNoPriv','authPriv'].map(s => <option key={s}>{s}</option>)}
          </Select>
          {['authNoPriv','authPriv'].includes(form.snmp_security_level) && (
            <div className="grid grid-cols-2 gap-4">
              <Select label="Auth protocol" value={form.snmp_auth_protocol} onChange={f('snmp_auth_protocol')}>
                {['SHA','MD5'].map(p => <option key={p}>{p}</option>)}
              </Select>
              <Input label="Auth password" type="password" autoComplete="new-password" value={form.snmp_auth_password} onChange={f('snmp_auth_password')} />
            </div>
          )}
          {form.snmp_security_level === 'authPriv' && (
            <div className="grid grid-cols-2 gap-4">
              <Select label="Priv protocol" value={form.snmp_priv_protocol} onChange={f('snmp_priv_protocol')}>
                {['AES','DES'].map(p => <option key={p}>{p}</option>)}
              </Select>
              <Input label="Priv password" type="password" autoComplete="new-password" value={form.snmp_priv_password} onChange={f('snmp_priv_password')} />
            </div>
          )}
        </>}
      </>}
      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={loading}>{isEdit ? 'Save changes' : 'Add router'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function RoutersPage() {
  const [routers,     setRouters]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [modal,       setModal]       = useState(null)
  const [delTarget,   setDelTarget]   = useState(null)
  const [expanded,    setExpanded]    = useState({})
  const [pingRes,     setPingRes]     = useState({})
  const [refreshSecs, setRefreshSecs] = useState(60)
  const { user } = useAuthStore()
  const canEdit = ['superadmin','admin'].includes(user?.role)

  const load = useCallback(() => {
    setLoading(true)
    api.get('/routers')
      .then(r => {
        setRouters(r.data)
        // Auto-ping all on load
        r.data.forEach(router => {
          api.get(`/routers/${router.id}/ping`)
            .then(res => setPingRes(p => ({ ...p, [router.id]: res.data })))
            .catch(() => setPingRes(p => ({ ...p, [router.id]: { alive: false } })))
        })
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const handleDelete = async () => {
    await api.delete(`/routers/${delTarget.id}`).catch(() => {})
    setDelTarget(null); load()
  }

  const toggleExpand = (id) => setExpanded(p => ({ ...p, [id]: !p[id] }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Routers</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{routers.length} router{routers.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Stats refresh interval selector */}
          <select
            value={refreshSecs}
            onChange={e => setRefreshSecs(parseInt(e.target.value))}
            className="text-xs px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-brand"
          >
            {REFRESH_INTERVALS.map(i => <option key={i.value} value={i.value}>Stats: {i.label}</option>)}
          </select>
          {canEdit && <Button onClick={() => setModal('add')}><Plus className="w-4 h-4" />Add router</Button>}
        </div>
      </div>

      {loading
        ? <div className="flex justify-center py-12"><Spinner className="w-6 h-6" /></div>
        : routers.length === 0
          ? <Card><Empty icon={Network} title="No routers" description="Add your first router or network device"
              action={canEdit ? <Button onClick={() => setModal('add')}><Plus className="w-4 h-4" />Add router</Button> : null} /></Card>
          : (
            <div className="space-y-3">
              {routers.map(r => {
                const ping = pingRes[r.id]
                const open = expanded[r.id]
                return (
                  <Card key={r.id} className="overflow-hidden">
                    <div className="flex items-center gap-3 px-4 py-3">
                      {/* Ping dot */}
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                        style={{ backgroundColor: ping === undefined ? '#d1d5db' : ping?.alive ? '#22c55e' : '#ef4444' }}
                        title={ping === undefined ? 'Checking...' : ping?.alive ? `Online ${ping.latency_ms}ms` : 'Offline'}
                      />

                      {/* Name */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-gray-900 dark:text-white">{r.name}</span>
                          <Badge className={cn('text-xs capitalize', BRAND_COLOR[r.brand] || BRAND_COLOR.other)}>
                            {BRANDS.find(b => b.value === r.brand)?.label || r.brand}
                          </Badge>
                          {r.model && <span className="text-xs text-gray-400">{r.model}</span>}
                        </div>
                        <p className="text-xs font-mono text-gray-400 mt-0.5">{r.ip_address}</p>
                      </div>

                      <span className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded font-mono flex-shrink-0">
                        SNMPv{r.snmp_version}
                      </span>

                      <div className="flex items-center gap-0.5 flex-shrink-0">
                        <button onClick={() => toggleExpand(r.id)}
                          className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors" title="Show stats">
                          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                        </button>
                        {canEdit && <>
                          <button onClick={() => setModal(r)} className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                          <button onClick={() => setDelTarget(r)} className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                        </>}
                      </div>
                    </div>

                    {open && (
                      <div className="border-t border-gray-100 dark:border-gray-800 bg-gray-50/30 dark:bg-gray-800/20 pt-3">
                        <StatsPanel routerId={r.id} refreshInterval={refreshSecs} />
                      </div>
                    )}
                  </Card>
                )
              })}
            </div>
          )
      }

      <Modal open={modal === 'add'} onClose={() => setModal(null)} title="Add router" size="md">
        <RouterForm onSave={() => { setModal(null); load() }} onCancel={() => setModal(null)} />
      </Modal>
      {modal && modal !== 'add' && (
        <Modal open onClose={() => setModal(null)} title={`Edit — ${modal.name}`} size="md">
          <RouterForm initial={modal} onSave={() => { setModal(null); load() }} onCancel={() => setModal(null)} />
        </Modal>
      )}
      <Modal open={!!delTarget} onClose={() => setDelTarget(null)} title="Delete router" size="sm">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Delete <strong>{delTarget?.name}</strong>? This cannot be undone.</p>
        <div className="flex gap-3">
          <Button variant="danger" onClick={handleDelete}>Delete</Button>
          <Button variant="secondary" onClick={() => setDelTarget(null)}>Cancel</Button>
        </div>
      </Modal>
    </div>
  )
}
