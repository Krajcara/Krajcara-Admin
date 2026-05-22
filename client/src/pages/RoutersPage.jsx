import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Pencil, Wifi, WifiOff, RefreshCw, Network } from 'lucide-react'
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

const SNMP_VERSIONS  = ['2c', '3']
const SNMP_SEC_LEVEL = ['noAuthNoPriv', 'authNoPriv', 'authPriv']
const SNMP_AUTH_PROT = ['MD5', 'SHA']
const SNMP_PRIV_PROT = ['DES', 'AES']

const BRAND_COLOR = {
  mikrotik:  'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  cisco:     'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-300',
  fortigate: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  ubiquiti:  'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  juniper:   'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  hp:        'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  other:     'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

// ── Router form ───────────────────────────────────────────────────────────────
const EMPTY = {
  name: '', brand: 'other', model: '', ip_address: '', username: '', password: '', notes: '',
  snmp_version: '2c', snmp_community: 'public', snmp_port: 161,
  snmp_username: '', snmp_auth_protocol: 'SHA', snmp_auth_password: '',
  snmp_priv_protocol: 'AES', snmp_priv_password: '', snmp_security_level: 'authPriv',
}

function RouterForm({ initial, onSave, onCancel }) {
  const isEdit = !!initial?.id
  const [form,    setForm]    = useState(isEdit ? { ...EMPTY, ...initial, password: '' } : EMPTY)
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const [tab,     setTab]     = useState('basic') // 'basic' | 'snmp'
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      isEdit ? await api.put(`/routers/${initial.id}`, form) : await api.post('/routers', form)
      onSave()
    } catch (err) {
      setError(err.response?.data?.error || 'Error saving router')
    } finally { setLoading(false) }
  }

  return (
    <form onSubmit={submit} autoComplete="off" className="space-y-4">
      {error && <AlertBox type="error">{error}</AlertBox>}

      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700 -mt-1">
        {[{ key: 'basic', label: 'Basic' }, { key: 'snmp', label: 'SNMP' }].map(t => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={cn('px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.key ? 'border-brand text-brand' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            )}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'basic' && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Name *" autoComplete="off" value={form.name} onChange={f('name')} required />
            <Select label="Brand" value={form.brand} onChange={f('brand')}>
              {BRANDS.map(b => <option key={b.value} value={b.value}>{b.label}</option>)}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Model" autoComplete="off" value={form.model} onChange={f('model')} placeholder="CCR2004, ASA5505..." />
            <Input label="IP address *" autoComplete="off" value={form.ip_address} onChange={f('ip_address')} placeholder="192.168.1.1" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Username" autoComplete="new-password" value={form.username} onChange={f('username')} />
            <Input label={isEdit ? 'Password (blank = keep)' : 'Password'} type="password" autoComplete="new-password" value={form.password} onChange={f('password')} />
          </div>
          <Textarea label="Notes" autoComplete="off" rows={2} value={form.notes || ''} onChange={f('notes')} />
        </>
      )}

      {tab === 'snmp' && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <Select label="SNMP version" value={form.snmp_version} onChange={f('snmp_version')}>
              {SNMP_VERSIONS.map(v => <option key={v} value={v}>v{v}</option>)}
            </Select>
            <Input label="SNMP port" type="number" autoComplete="off" value={form.snmp_port} onChange={f('snmp_port')} />
          </div>

          {form.snmp_version === '2c' && (
            <Input label="Community string" autoComplete="off" value={form.snmp_community} onChange={f('snmp_community')} placeholder="public" />
          )}

          {form.snmp_version === '3' && (
            <>
              <Input label="Username" autoComplete="new-password" value={form.snmp_username} onChange={f('snmp_username')} />
              <Select label="Security level" value={form.snmp_security_level} onChange={f('snmp_security_level')}>
                {SNMP_SEC_LEVEL.map(s => <option key={s}>{s}</option>)}
              </Select>
              {['authNoPriv', 'authPriv'].includes(form.snmp_security_level) && (
                <div className="grid grid-cols-2 gap-4">
                  <Select label="Auth protocol" value={form.snmp_auth_protocol} onChange={f('snmp_auth_protocol')}>
                    {SNMP_AUTH_PROT.map(p => <option key={p}>{p}</option>)}
                  </Select>
                  <Input label="Auth password" type="password" autoComplete="new-password" value={form.snmp_auth_password} onChange={f('snmp_auth_password')} />
                </div>
              )}
              {form.snmp_security_level === 'authPriv' && (
                <div className="grid grid-cols-2 gap-4">
                  <Select label="Priv protocol" value={form.snmp_priv_protocol} onChange={f('snmp_priv_protocol')}>
                    {SNMP_PRIV_PROT.map(p => <option key={p}>{p}</option>)}
                  </Select>
                  <Input label="Priv password" type="password" autoComplete="new-password" value={form.snmp_priv_password} onChange={f('snmp_priv_password')} />
                </div>
              )}
            </>
          )}
        </>
      )}

      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={loading}>{isEdit ? 'Save changes' : 'Add router'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function RoutersPage() {
  const [routers,   setRouters]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [modal,     setModal]     = useState(null)
  const [delTarget, setDelTarget] = useState(null)
  const [pinging,   setPinging]   = useState({})
  const [pingRes,   setPingRes]   = useState({})
  const { user } = useAuthStore()
  const canEdit = ['superadmin', 'admin'].includes(user?.role)

  const load = useCallback(() => {
    setLoading(true)
    api.get('/routers').then(r => setRouters(r.data)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  const handleDelete = async () => {
    await api.delete(`/routers/${delTarget.id}`).catch(() => {})
    setDelTarget(null)
    load()
  }

  const handlePing = async (router) => {
    setPinging(p => ({ ...p, [router.id]: true }))
    try {
      const r = await api.get(`/routers/${router.id}/ping`)
      setPingRes(p => ({ ...p, [router.id]: r.data }))
    } catch {
      setPingRes(p => ({ ...p, [router.id]: { alive: false } }))
    } finally {
      setPinging(p => ({ ...p, [router.id]: false }))
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Routers</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{routers.length} router{routers.length !== 1 ? 's' : ''}</p>
        </div>
        {canEdit && <Button onClick={() => setModal('add')}><Plus className="w-4 h-4" />Add router</Button>}
      </div>

      <Card>
        {loading
          ? <div className="flex justify-center py-12"><Spinner className="w-6 h-6" /></div>
          : routers.length === 0
            ? <Empty icon={Network} title="No routers" description="Add your first router or network device"
                action={canEdit ? <Button onClick={() => setModal('add')}><Plus className="w-4 h-4" />Add router</Button> : null} />
            : (
              <Table>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Brand</Th>
                    <Th>Model</Th>
                    <Th>IP Address</Th>
                    <Th>SNMP</Th>
                    <Th>Status</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {routers.map(r => {
                    const ping = pingRes[r.id]
                    return (
                      <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <Td>
                          <p className="font-medium text-gray-900 dark:text-white">{r.name}</p>
                          {r.notes && <p className="text-xs text-gray-400 truncate max-w-40">{r.notes}</p>}
                        </Td>
                        <Td>
                          <Badge className={cn('text-xs capitalize', BRAND_COLOR[r.brand] || BRAND_COLOR.other)}>
                            {BRANDS.find(b => b.value === r.brand)?.label || r.brand}
                          </Badge>
                        </Td>
                        <Td className="text-gray-500">{r.model || '—'}</Td>
                        <Td><span className="font-mono text-sm">{r.ip_address}</span></Td>
                        <Td>
                          <span className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded font-mono">
                            v{r.snmp_version}
                          </span>
                        </Td>
                        <Td>
                          {ping ? (
                            <div className="flex items-center gap-1.5">
                              {ping.alive
                                ? <><Wifi className="w-4 h-4 text-green-500" /><span className="text-xs text-green-600 dark:text-green-400">{ping.latency_ms}ms</span></>
                                : <><WifiOff className="w-4 h-4 text-red-500" /><span className="text-xs text-red-500">Offline</span></>}
                            </div>
                          ) : (
                            <span className="text-xs text-gray-400">—</span>
                          )}
                        </Td>
                        <Td>
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handlePing(r)}
                              disabled={pinging[r.id]}
                              className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors"
                              title="Ping"
                            >
                              <RefreshCw className={cn('w-3.5 h-3.5', pinging[r.id] && 'animate-spin')} />
                            </button>
                            {canEdit && (
                              <>
                                <button onClick={() => setModal(r)} className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                                <button onClick={() => setDelTarget(r)} className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                              </>
                            )}
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
