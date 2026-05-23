import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Trash2, Pencil, Network, Globe, RefreshCw,
  Search, Import, ChevronDown, ChevronUp, Wifi, WifiOff, Download
} from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { Card, Button, Modal, Input, Select, Textarea, Table, Th, Td, Badge, Empty, Spinner, AlertBox } from '../components/shared/UI'
import { cn, formatDate } from '../lib/utils'

const PURPOSES_VLAN = ['production', 'management', 'dmz', 'guest', 'iot', 'storage', 'other']
const PURPOSES_IP   = ['server', 'workstation', 'printer', 'camera', 'network', 'iot', 'other']
const VLAN_COLORS   = ['#6366f1','#3b82f6','#22c55e','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#ec4899','#14b8a6']

function purposeBadge(p) {
  const colors = {
    production:'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    management:'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
    dmz:       'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
    guest:     'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    iot:       'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
    storage:   'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
    server:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    workstation:'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
    other:     'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  }
  return colors[p] || colors.other
}

// ── VLAN form ─────────────────────────────────────────────────────────────────
function VlanForm({ initial, routers, onSave, onCancel }) {
  const isEdit = !!initial?.id
  const [form, setForm] = useState(initial || { vlan_id: '', name: '', description: '', subnet: '', gateway: '', dhcp_start: '', dhcp_end: '', purpose: 'production', color: '#6366f1', router_id: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      isEdit ? await api.put(`/ipspace/vlans/${initial.id}`, form) : await api.post('/ipspace/vlans', form)
      onSave()
    } catch (err) { setError(err.response?.data?.error || 'Error saving VLAN') }
    finally { setLoading(false) }
  }

  return (
    <form onSubmit={submit} autoComplete="off" className="space-y-4">
      {error && <AlertBox type="error">{error}</AlertBox>}
      <div className="grid grid-cols-2 gap-4">
        <Input label="VLAN ID *" type="number" min="1" max="4094" autoComplete="off" value={form.vlan_id} onChange={f('vlan_id')} disabled={isEdit} required />
        <Input label="Name *" autoComplete="off" value={form.name} onChange={f('name')} required />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Select label="Purpose" value={form.purpose} onChange={f('purpose')}>
          {PURPOSES_VLAN.map(p => <option key={p} value={p}>{p}</option>)}
        </Select>
        <Select label="Router (optional)" value={form.router_id || ''} onChange={f('router_id')}>
          <option value="">— None —</option>
          {routers.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
        </Select>
      </div>
      <Input label="Subnet" autoComplete="off" value={form.subnet || ''} onChange={f('subnet')} placeholder="192.168.10.0/24" />
      <div className="grid grid-cols-2 gap-4">
        <Input label="Gateway" autoComplete="off" value={form.gateway || ''} onChange={f('gateway')} placeholder="192.168.10.1" />
        <div className="space-y-1">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Color</label>
          <div className="flex gap-2 flex-wrap">
            {VLAN_COLORS.map(c => (
              <button key={c} type="button" onClick={() => setForm(p => ({ ...p, color: c }))}
                className={cn('w-6 h-6 rounded-full transition-transform', form.color === c && 'ring-2 ring-offset-2 ring-gray-400 scale-125')}
                style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Input label="DHCP start" autoComplete="off" value={form.dhcp_start || ''} onChange={f('dhcp_start')} placeholder="192.168.10.100" />
        <Input label="DHCP end" autoComplete="off" value={form.dhcp_end || ''} onChange={f('dhcp_end')} placeholder="192.168.10.200" />
      </div>
      <Textarea label="Description" autoComplete="off" rows={2} value={form.description || ''} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={loading}>{isEdit ? 'Save changes' : 'Add VLAN'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

// ── IP form ───────────────────────────────────────────────────────────────────
function IpForm({ initial, vlans, onSave, onCancel }) {
  const isEdit = !!initial?.id
  const [form, setForm] = useState(initial || { ip_address: '', hostname: '', mac_address: '', vlan_id: '', purpose: 'other', description: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      isEdit ? await api.put(`/ipspace/ips/${initial.id}`, form) : await api.post('/ipspace/ips', form)
      onSave()
    } catch (err) { setError(err.response?.data?.error || 'Error saving IP') }
    finally { setLoading(false) }
  }

  return (
    <form onSubmit={submit} autoComplete="off" className="space-y-4">
      {error && <AlertBox type="error">{error}</AlertBox>}
      <Input label="IP address *" autoComplete="off" value={form.ip_address} onChange={f('ip_address')} placeholder="192.168.10.50" disabled={isEdit} required />
      <div className="grid grid-cols-2 gap-4">
        <Input label="Hostname" autoComplete="off" value={form.hostname || ''} onChange={f('hostname')} placeholder="server01" />
        <Input label="MAC address" autoComplete="off" value={form.mac_address || ''} onChange={f('mac_address')} placeholder="AA:BB:CC:DD:EE:FF" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Select label="VLAN" value={form.vlan_id || ''} onChange={f('vlan_id')}>
          <option value="">— None —</option>
          {vlans.map(v => <option key={v.id} value={v.id}>VLAN {v.vlan_id} — {v.name}</option>)}
        </Select>
        <Select label="Purpose" value={form.purpose} onChange={f('purpose')}>
          {PURPOSES_IP.map(p => <option key={p} value={p}>{p}</option>)}
        </Select>
      </div>
      <Textarea label="Description" autoComplete="off" rows={2} value={form.description || ''} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={loading}>{isEdit ? 'Save changes' : 'Add IP'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

// ── Import from scan modal ────────────────────────────────────────────────────
function ImportModal({ vlans, onImport, onClose }) {
  const [scans,    setScans]    = useState([])
  const [scanId,   setScanId]   = useState('')
  const [vlanId,   setVlanId]   = useState('')
  const [results,  setResults]  = useState([])
  const [selected, setSelected] = useState([])
  const [loading,  setLoading]  = useState(false)
  const [importing,setImporting]= useState(false)
  const [error,    setError]    = useState('')

  useEffect(() => {
    api.get('/scanner/scans?limit=20').then(r => setScans(r.data.scans || [])).catch(() => {})
  }, [])

  const loadScan = async () => {
    if (!scanId) return
    setLoading(true); setResults([]); setSelected([])
    try {
      const r = await api.get(`/scanner/scans/${scanId}`)
      const items = (r.data.results || []).map(h => ({
        ip_address:  h.ip_address,
        hostname:    h.hostname,
        mac_address: h.mac_address,
        purpose:     'other',
      }))
      setResults(items)
      setSelected(items.map((_,i) => i))
    } catch { setError('Failed to load scan') }
    finally { setLoading(false) }
  }

  const doImport = async () => {
    const items = selected.map(i => results[i])
    setImporting(true)
    try {
      const r = await api.post('/ipspace/import', { scan_id: parseInt(scanId), vlan_id: vlanId || null, items })
      onImport(r.data)
    } catch (err) { setError(err.response?.data?.error || 'Import failed') }
    finally { setImporting(false) }
  }

  const toggleAll = () => setSelected(s => s.length === results.length ? [] : results.map((_,i) => i))
  const toggle    = (i) => setSelected(s => s.includes(i) ? s.filter(x => x !== i) : [...s, i])

  return (
    <Modal open onClose={onClose} title="Import from Network Scanner" size="md">
      <div className="space-y-4">
        {error && <AlertBox type="error">{error}</AlertBox>}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Select scan</label>
            <select value={scanId} onChange={e => setScanId(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand">
              <option value="">-- Select scan --</option>
              {scans.filter(s => s.status === 'done').map(s => (
                <option key={s.id} value={s.id}>#{s.id} — {s.host_label} ({s.host_target})</option>
              ))}
            </select>
          </div>
          <Select label="Assign to VLAN (optional)" value={vlanId} onChange={e => setVlanId(e.target.value)}>
            <option value="">— None —</option>
            {vlans.map(v => <option key={v.id} value={v.id}>VLAN {v.vlan_id} — {v.name}</option>)}
          </Select>
        </div>
        <Button variant="secondary" onClick={loadScan} loading={loading} disabled={!scanId}>
          Load hosts
        </Button>

        {results.length > 0 && (
          <>
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">{selected.length} / {results.length} selected</p>
              <button onClick={toggleAll} className="text-xs text-brand hover:underline">
                {selected.length === results.length ? 'Deselect all' : 'Select all'}
              </button>
            </div>
            <div className="max-h-48 overflow-y-auto space-y-1 border border-gray-200 dark:border-gray-700 rounded-lg p-2">
              {results.map((r, i) => (
                <label key={i} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer">
                  <input type="checkbox" checked={selected.includes(i)} onChange={() => toggle(i)} />
                  <span className="font-mono text-sm">{r.ip_address}</span>
                  {r.hostname && <span className="text-xs text-gray-400">({r.hostname})</span>}
                </label>
              ))}
            </div>
            <div className="flex gap-3">
              <Button loading={importing} disabled={selected.length === 0} onClick={doImport}>
                <Download className="w-4 h-4" />Import {selected.length} host{selected.length !== 1 ? 's' : ''}
              </Button>
              <Button variant="secondary" onClick={onClose}>Cancel</Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function IPSpacePage() {
  const [tab,       setTab]       = useState('vlans')
  const [vlans,     setVlans]     = useState([])
  const [ips,       setIps]       = useState([])
  const [routers,   setRouters]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [modal,     setModal]     = useState(null)
  const [delTarget, setDelTarget] = useState(null)
  const [search,    setSearch]    = useState('')
  const [vlanFilter,setVlanFilter]= useState('')
  const [pinging,   setPinging]   = useState({})
  const [pingRes,   setPingRes]   = useState({})
  const [showImport,setShowImport]= useState(false)
  const { user } = useAuthStore()
  const canEdit = ['superadmin','admin','operator'].includes(user?.role)

  const loadVlans = useCallback(() => {
    api.get('/ipspace/vlans').then(r => setVlans(r.data)).catch(() => {})
  }, [])

  const loadIps = useCallback(() => {
    setLoading(true)
    const q = new URLSearchParams()
    if (search)     q.set('search', search)
    if (vlanFilter) q.set('vlan_id', vlanFilter)
    api.get(`/ipspace/ips?${q}`).then(r => setIps(r.data)).catch(() => {}).finally(() => setLoading(false))
  }, [search, vlanFilter])

  useEffect(() => {
    api.get('/routers').then(r => setRouters(r.data)).catch(() => {})
    loadVlans()
  }, [loadVlans])

  useEffect(() => { if (tab === 'ips') loadIps() }, [tab, loadIps])
  useEffect(() => { if (tab === 'vlans') setLoading(false) }, [tab])

  const ping = async (ip) => {
    setPinging(p => ({ ...p, [ip.id]: true }))
    try {
      const r = await api.post(`/ipspace/ips/ping/${ip.id}`)
      setPingRes(p => ({ ...p, [ip.id]: r.data }))
    } catch { setPingRes(p => ({ ...p, [ip.id]: { online: false } })) }
    finally { setPinging(p => ({ ...p, [ip.id]: false })) }
  }

  const handleDelete = async () => {
    if (!delTarget) return
    try {
      if (delTarget.type === 'vlan') { await api.delete(`/ipspace/vlans/${delTarget.id}`); loadVlans() }
      else                           { await api.delete(`/ipspace/ips/${delTarget.id}`);   loadIps() }
    } finally { setDelTarget(null) }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">IP Space</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">VLANs and IP address management</p>
        </div>
        <div className="flex gap-2">
          {canEdit && tab === 'ips' && (
            <Button variant="secondary" onClick={() => setShowImport(true)}>
              <Download className="w-4 h-4" />Import from scanner
            </Button>
          )}
          {canEdit && tab === 'vlans' && <Button onClick={() => setModal('add-vlan')}><Plus className="w-4 h-4" />Add VLAN</Button>}
          {canEdit && tab === 'ips'   && <Button onClick={() => setModal('add-ip')}><Plus className="w-4 h-4" />Add IP</Button>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700">
        {[
          { key: 'vlans', label: `VLANs (${vlans.length})`,          icon: Network },
          { key: 'ips',   label: `IP Addresses (${ips.length})`,      icon: Globe  },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn('flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.key ? 'border-brand text-brand dark:text-brand-light' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300')}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>

      {/* ── VLANs tab ── */}
      {tab === 'vlans' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {vlans.length === 0 && (
            <div className="col-span-full">
              <Card><Empty icon={Network} title="No VLANs" description="Add your first VLAN"
                action={canEdit ? <Button onClick={() => setModal('add-vlan')}><Plus className="w-4 h-4" />Add VLAN</Button> : null} /></Card>
            </div>
          )}
          {vlans.map(v => (
            <Card key={v.id} className="overflow-hidden">
              <div className="h-1.5" style={{ backgroundColor: v.color }} />
              <div className="p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-bold px-1.5 py-0.5 rounded text-white" style={{ backgroundColor: v.color }}>
                        VLAN {v.vlan_id}
                      </span>
                      <span className="font-semibold text-gray-900 dark:text-white">{v.name}</span>
                    </div>
                    {v.description && <p className="text-xs text-gray-400 mt-1">{v.description}</p>}
                  </div>
                  <Badge className={cn('text-xs', purposeBadge(v.purpose))}>{v.purpose}</Badge>
                </div>
                <div className="space-y-1 text-xs text-gray-500">
                  {v.subnet  && <p><span className="text-gray-400">Subnet:</span> <span className="font-mono">{v.subnet}</span></p>}
                  {v.gateway && <p><span className="text-gray-400">Gateway:</span> <span className="font-mono">{v.gateway}</span></p>}
                  {v.dhcp_start && v.dhcp_end && <p><span className="text-gray-400">DHCP:</span> <span className="font-mono">{v.dhcp_start} — {v.dhcp_end}</span></p>}
                  {v.router_name && <p><span className="text-gray-400">Router:</span> {v.router_name}</p>}
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
                  <span className="text-xs text-gray-400">{v.ip_count} IP{v.ip_count !== 1 ? 's' : ''}</span>
                  {canEdit && (
                    <div className="flex gap-1">
                      <button onClick={() => setModal({ type: 'edit-vlan', data: v })} className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => setDelTarget({ type: 'vlan', id: v.id, name: `VLAN ${v.vlan_id} — ${v.name}` })} className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* ── IPs tab ── */}
      {tab === 'ips' && (
        <>
          <div className="flex gap-3 flex-wrap">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input autoComplete="off" placeholder="Search IP, hostname..."
                value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
            <select value={vlanFilter} onChange={e => setVlanFilter(e.target.value)}
              className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand">
              <option value="">All VLANs</option>
              {vlans.map(v => <option key={v.id} value={v.id}>VLAN {v.vlan_id} — {v.name}</option>)}
            </select>
            <span className="text-sm text-gray-400 self-center ml-auto">{ips.length} address{ips.length !== 1 ? 'es' : ''}</span>
          </div>

          <Card>
            {loading ? <div className="flex justify-center py-12"><Spinner className="w-6 h-6" /></div>
              : ips.length === 0 ? <Empty icon={Globe} title="No IP addresses" description="Add manually or import from Network Scanner"
                  action={canEdit ? <Button onClick={() => setModal('add-ip')}><Plus className="w-4 h-4" />Add IP</Button> : null} />
              : (
                <Table>
                  <thead><tr>
                    <Th>IP Address</Th><Th>Hostname</Th><Th>MAC</Th><Th>VLAN</Th><Th>Purpose</Th><Th>Last seen</Th><Th>Status</Th><Th />
                  </tr></thead>
                  <tbody>
                    {ips.map(ip => {
                      const pr = pingRes[ip.id]
                      return (
                        <tr key={ip.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <Td><span className="font-mono font-medium text-gray-900 dark:text-white">{ip.ip_address}</span></Td>
                          <Td className="text-gray-600 dark:text-gray-400">{ip.hostname || '—'}</Td>
                          <Td><span className="font-mono text-xs text-gray-500">{ip.mac_address || '—'}</span></Td>
                          <Td>
                            {ip.vlan_name ? (
                              <span className="flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: ip.vlan_color }} />
                                <span className="text-xs">VLAN {ip.vlan_number} — {ip.vlan_name}</span>
                              </span>
                            ) : <span className="text-gray-300">—</span>}
                          </Td>
                          <Td><Badge className={cn('text-xs', purposeBadge(ip.purpose))}>{ip.purpose}</Badge></Td>
                          <Td className="text-xs text-gray-400">{ip.last_seen ? formatDate(ip.last_seen) : '—'}</Td>
                          <Td>
                            {pr !== undefined ? (
                              <div className="flex items-center gap-1.5">
                                {pr.online
                                  ? <><span className="w-2 h-2 rounded-full bg-green-500" /><span className="text-xs text-green-600">{pr.latency_ms}ms</span></>
                                  : <><span className="w-2 h-2 rounded-full bg-red-500" /><span className="text-xs text-red-500">offline</span></>
                                }
                              </div>
                            ) : (
                              <span className="text-xs text-gray-300">{ip.last_status !== 'unknown' ? ip.last_status : '—'}</span>
                            )}
                          </Td>
                          <Td>
                            <div className="flex items-center justify-end gap-1">
                              <button onClick={() => ping(ip)} disabled={pinging[ip.id]}
                                className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors" title="Ping">
                                <RefreshCw className={cn('w-3.5 h-3.5', pinging[ip.id] && 'animate-spin')} />
                              </button>
                              {canEdit && <>
                                <button onClick={() => setModal({ type: 'edit-ip', data: ip })} className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                                <button onClick={() => setDelTarget({ type: 'ip', id: ip.id, name: ip.ip_address })} className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                              </>}
                            </div>
                          </Td>
                        </tr>
                      )
                    })}
                  </tbody>
                </Table>
              )
            }
          </Card>
        </>
      )}

      {/* Modals */}
      <Modal open={modal === 'add-vlan'} onClose={() => setModal(null)} title="Add VLAN" size="md">
        <VlanForm routers={routers} onSave={() => { setModal(null); loadVlans() }} onCancel={() => setModal(null)} />
      </Modal>
      {modal?.type === 'edit-vlan' && (
        <Modal open onClose={() => setModal(null)} title={`Edit — VLAN ${modal.data.vlan_id}`} size="md">
          <VlanForm initial={modal.data} routers={routers} onSave={() => { setModal(null); loadVlans() }} onCancel={() => setModal(null)} />
        </Modal>
      )}
      <Modal open={modal === 'add-ip'} onClose={() => setModal(null)} title="Add IP address">
        <IpForm vlans={vlans} onSave={() => { setModal(null); loadIps() }} onCancel={() => setModal(null)} />
      </Modal>
      {modal?.type === 'edit-ip' && (
        <Modal open onClose={() => setModal(null)} title={`Edit — ${modal.data.ip_address}`}>
          <IpForm initial={modal.data} vlans={vlans} onSave={() => { setModal(null); loadIps() }} onCancel={() => setModal(null)} />
        </Modal>
      )}
      <Modal open={!!delTarget} onClose={() => setDelTarget(null)} title="Delete" size="sm">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Delete <strong>{delTarget?.name}</strong>? This cannot be undone.</p>
        <div className="flex gap-3">
          <Button variant="danger" onClick={handleDelete}>Delete</Button>
          <Button variant="secondary" onClick={() => setDelTarget(null)}>Cancel</Button>
        </div>
      </Modal>
      {showImport && (
        <ImportModal vlans={vlans} onImport={(result) => { setShowImport(false); loadIps(); alert(`Imported ${result.imported}, skipped ${result.skipped}`) }} onClose={() => setShowImport(false)} />
      )}
    </div>
  )
}
