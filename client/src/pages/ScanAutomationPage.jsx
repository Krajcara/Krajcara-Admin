import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Pencil, CalendarClock, BellRing, Bell, CheckCheck } from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { Card, Button, Modal, Input, Select, Table, Th, Td, Badge, Empty, Spinner, AlertBox, Toggle } from '../components/shared/UI'
import { cn, formatDate, timeAgo } from '../lib/utils'

const CRON_PRESETS = [
  { label: 'Every hour',         value: '0 * * * *'   },
  { label: 'Every day at 3am',   value: '0 3 * * *'   },
  { label: 'Every day at noon',  value: '0 12 * * *'  },
  { label: 'Every Monday 9am',   value: '0 9 * * 1'   },
  { label: 'Custom',             value: 'custom'       },
]
const SCAN_PROFILES = ['quick', 'full', 'service', 'stealth', 'os']
const TRIGGERS = ['any_change', 'new_port', 'closed_port', 'service_change', 'host_up', 'host_down']
const TRIGGER_COLOR = {
  any_change:     'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  new_port:       'bg-green-100  text-green-700  dark:bg-green-900/30  dark:text-green-300',
  closed_port:    'bg-red-100    text-red-700    dark:bg-red-900/30    dark:text-red-300',
  service_change: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  host_up:        'bg-blue-100   text-blue-700   dark:bg-blue-900/30   dark:text-blue-300',
  host_down:      'bg-gray-100   text-gray-600   dark:bg-gray-800      dark:text-gray-400',
}

// ── Schedule form ─────────────────────────────────────────────────────────────
function ScheduleForm({ hosts, initial, onSave, onCancel }) {
  const isEdit = !!initial?.id
  const [form,   setForm]   = useState(initial || { host_id: '', cron_expr: '0 3 * * *', label: '', profile: 'quick', nmap_args: '' })
  const [preset, setPreset] = useState('0 3 * * *')
  const [error,  setError]  = useState('')
  const [loading,setLoading]= useState(false)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      isEdit ? await api.put(`/scanner/schedules/${initial.id}`, form) : await api.post('/scanner/schedules', form)
      onSave()
    } catch (err) { setError(err.response?.data?.error || 'Error saving schedule') }
    finally { setLoading(false) }
  }

  return (
    <form onSubmit={submit} autoComplete="off" className="space-y-4">
      {error && <AlertBox type="error">{error}</AlertBox>}
      <Select label="Host" value={form.host_id || ''} onChange={f('host_id')}>
        <option value="">-- Select host --</option>
        {hosts.map(h => <option key={h.id} value={h.id}>{h.label} ({h.target})</option>)}
      </Select>
      <Input label="Label (optional)" autoComplete="off" value={form.label || ''} onChange={f('label')} />
      <Select label="Frequency" value={preset} onChange={e => {
        setPreset(e.target.value)
        if (e.target.value !== 'custom') setForm(p => ({ ...p, cron_expr: e.target.value }))
      }}>
        {CRON_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
      </Select>
      {preset === 'custom' && <Input label="Cron expression" autoComplete="off" value={form.cron_expr} onChange={f('cron_expr')} placeholder="0 * * * *" />}
      <Select label="Scan profile" value={form.profile} onChange={f('profile')}>
        {SCAN_PROFILES.map(p => <option key={p}>{p}</option>)}
      </Select>
      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={loading}>{isEdit ? 'Save changes' : 'Add schedule'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

// ── Alert rule form ───────────────────────────────────────────────────────────
function RuleForm({ hosts, initial, onSave, onCancel }) {
  const isEdit = !!initial?.id
  const [form,   setForm]   = useState(initial ? { ...initial, channels: initial.channels || {} } : { host_id: '', trigger_type: 'any_change', label: '', channels: { email: [], webhook: '' } })
  const [emails, setEmails] = useState((initial?.channels?.email || []).join(', '))
  const [error,  setError]  = useState('')
  const [loading,setLoading]= useState(false)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const payload = { ...form, channels: { ...form.channels, email: emails ? emails.split(',').map(s=>s.trim()).filter(Boolean) : [] } }
      isEdit ? await api.put(`/scanner/alert-rules/${initial.id}`, payload) : await api.post('/scanner/alert-rules', payload)
      onSave()
    } catch (err) { setError(err.response?.data?.error || 'Error saving rule') }
    finally { setLoading(false) }
  }

  return (
    <form onSubmit={submit} autoComplete="off" className="space-y-4">
      {error && <AlertBox type="error">{error}</AlertBox>}
      <Input label="Label (optional)" autoComplete="off" value={form.label || ''} onChange={f('label')} />
      <Select label="Host (empty = all hosts)" value={form.host_id || ''} onChange={f('host_id')}>
        <option value="">-- All hosts --</option>
        {hosts.map(h => <option key={h.id} value={h.id}>{h.label}</option>)}
      </Select>
      <Select label="Trigger" value={form.trigger_type} onChange={f('trigger_type')}>
        {TRIGGERS.map(t => <option key={t}>{t}</option>)}
      </Select>
      <Input label="Email recipients (comma separated)" autoComplete="off" value={emails} onChange={e => setEmails(e.target.value)} placeholder="admin@example.com, ops@example.com" />
      <Input label="Webhook URL (optional)" autoComplete="off" value={form.channels?.webhook || ''} onChange={e => setForm(p => ({ ...p, channels: { ...p.channels, webhook: e.target.value } }))} placeholder="https://hooks.example.com/..." />
      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={loading}>{isEdit ? 'Save changes' : 'Add rule'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ScanAutomationPage() {
  const [tab,       setTab]       = useState('schedules')
  const [schedules, setSchedules] = useState([])
  const [rules,     setRules]     = useState([])
  const [alerts,    setAlerts]    = useState([])
  const [hosts,     setHosts]     = useState([])
  const [alertTotal,setAlertTotal]= useState(0)
  const [loading,   setLoading]   = useState(true)
  const [modal,     setModal]     = useState(null)
  const [alertFilter,setAlertFilter] = useState('all')
  const { user } = useAuthStore()
  const canEdit = ['superadmin','admin','operator'].includes(user?.role)

  const loadAll = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.get('/scanner/hosts'),
      api.get('/scanner/schedules'),
      api.get('/scanner/alert-rules'),
    ]).then(([h, s, r]) => {
      setHosts(h.data)
      setSchedules(s.data)
      setRules(r.data)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const loadAlerts = useCallback(() => {
    const q = alertFilter === 'unread' ? '?acknowledged=false&limit=50' : '?limit=50'
    api.get(`/scanner/alerts${q}`).then(r => { setAlerts(r.data.alerts || []); setAlertTotal(r.data.total || 0) }).catch(() => {})
  }, [alertFilter])

  useEffect(() => { loadAll() }, [loadAll])
  useEffect(() => { if (tab === 'alerts') loadAlerts() }, [tab, loadAlerts])

  const unreadCount = rules.length > 0 ? alertTotal : 0

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Scan Automation</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Scheduled scans, alert rules and alerts log</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700">
        {[
          { key: 'schedules', label: 'Schedules',   icon: CalendarClock },
          { key: 'rules',     label: 'Alert Rules',  icon: BellRing },
          { key: 'alerts',    label: 'Alerts Log',   icon: Bell },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn('flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.key ? 'border-brand text-brand dark:text-brand-light' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300')}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>

      {loading && tab !== 'alerts'
        ? <div className="flex justify-center py-12"><Spinner className="w-6 h-6" /></div>
        : null}

      {/* ── SCHEDULES ── */}
      {tab === 'schedules' && !loading && (
        <>
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">{schedules.length} schedule{schedules.length !== 1 ? 's' : ''}</p>
            {canEdit && <Button onClick={() => setModal('add-schedule')}><Plus className="w-4 h-4" />Add schedule</Button>}
          </div>
          <Card>
            {schedules.length === 0
              ? <Empty icon={CalendarClock} title="No schedules" description="Automate scans with a cron schedule"
                  action={canEdit ? <Button onClick={() => setModal('add-schedule')}><Plus className="w-4 h-4" />Add schedule</Button> : null} />
              : <Table>
                  <thead><tr><Th>Label</Th><Th>Host</Th><Th>Cron</Th><Th>Profile</Th><Th>Last run</Th><Th>Enabled</Th><Th /></tr></thead>
                  <tbody>
                    {schedules.map(s => (
                      <tr key={s.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <Td className="font-medium text-gray-900 dark:text-white">{s.label || '—'}</Td>
                        <Td>{s.host_label || <span className="text-gray-400 italic text-xs">All</span>}</Td>
                        <Td><span className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">{s.cron_expr}</span></Td>
                        <Td><Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 text-xs">{s.profile}</Badge></Td>
                        <Td className="text-xs text-gray-400">{s.last_run ? formatDate(s.last_run) : 'Never'}</Td>
                        <Td><Toggle checked={!!s.enabled} onChange={() => api.put(`/scanner/schedules/${s.id}`, { enabled: !s.enabled }).then(loadAll)} /></Td>
                        <Td>
                          <div className="flex items-center justify-end gap-1">
                            {canEdit && <button onClick={() => setModal({ type: 'edit-schedule', data: s })} className="p-1.5 text-gray-400 hover:text-brand rounded"><Pencil className="w-3.5 h-3.5" /></button>}
                            {user?.role === 'superadmin' && <button onClick={() => api.delete(`/scanner/schedules/${s.id}`).then(loadAll)} className="p-1.5 text-gray-400 hover:text-red-500 rounded"><Trash2 className="w-3.5 h-3.5" /></button>}
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
            }
          </Card>
        </>
      )}

      {/* ── ALERT RULES ── */}
      {tab === 'rules' && !loading && (
        <>
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">{rules.length} rule{rules.length !== 1 ? 's' : ''}</p>
            {canEdit && <Button onClick={() => setModal('add-rule')}><Plus className="w-4 h-4" />Add rule</Button>}
          </div>
          <Card>
            {rules.length === 0
              ? <Empty icon={BellRing} title="No alert rules" description="Add a rule to get notified when changes are detected"
                  action={canEdit ? <Button onClick={() => setModal('add-rule')}><Plus className="w-4 h-4" />Add rule</Button> : null} />
              : <Table>
                  <thead><tr><Th>Label</Th><Th>Trigger</Th><Th>Host</Th><Th>Channels</Th><Th>Enabled</Th><Th /></tr></thead>
                  <tbody>
                    {rules.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <Td className="font-medium">{r.label || '—'}</Td>
                        <Td><Badge className={cn('text-xs', TRIGGER_COLOR[r.trigger_type] || '')}>{r.trigger_type}</Badge></Td>
                        <Td>{r.host_label || <span className="text-gray-400 italic text-xs">All</span>}</Td>
                        <Td>
                          <div className="flex gap-1 flex-wrap">
                            {r.channels?.email?.length > 0 && <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 text-xs">Email</Badge>}
                            {r.channels?.webhook && <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 text-xs">Webhook</Badge>}
                          </div>
                        </Td>
                        <Td><Toggle checked={!!r.enabled} onChange={() => api.put(`/scanner/alert-rules/${r.id}`, { enabled: !r.enabled }).then(loadAll)} /></Td>
                        <Td>
                          <div className="flex items-center justify-end gap-1">
                            {user?.role === 'superadmin' && <button onClick={() => api.delete(`/scanner/alert-rules/${r.id}`).then(loadAll)} className="p-1.5 text-gray-400 hover:text-red-500 rounded"><Trash2 className="w-3.5 h-3.5" /></button>}
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
            }
          </Card>
        </>
      )}

      {/* ── ALERTS LOG ── */}
      {tab === 'alerts' && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">{alertTotal} total</p>
            <div className="flex gap-2">
              {['all','unread'].map(f => (
                <Button key={f} variant={alertFilter === f ? 'primary' : 'outline'} size="sm" onClick={() => setAlertFilter(f)}>
                  {f === 'all' ? 'All' : 'Unread'}
                </Button>
              ))}
            </div>
          </div>
          <Card>
            {alerts.length === 0
              ? <Empty icon={Bell} title="No alerts" description="Alerts appear when scan changes match a rule" />
              : <Table>
                  <thead><tr><Th>Message</Th><Th>Type</Th><Th>Time</Th><Th>Status</Th><Th /></tr></thead>
                  <tbody>
                    {alerts.map(a => (
                      <tr key={a.id} className={cn('hover:bg-gray-50 dark:hover:bg-gray-800/50', !a.acknowledged && 'bg-blue-50/30 dark:bg-blue-900/10')}>
                        <Td className="font-medium text-gray-900 dark:text-white">{a.message || a.type}</Td>
                        <Td><Badge className={cn('text-xs', TRIGGER_COLOR[a.type] || 'bg-gray-100 text-gray-600')}>{a.type}</Badge></Td>
                        <Td className="text-xs text-gray-400">{timeAgo(a.created_at)}</Td>
                        <Td>
                          <Badge className={a.acknowledged ? 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'}>
                            {a.acknowledged ? 'Read' : 'New'}
                          </Badge>
                        </Td>
                        <Td>
                          {!a.acknowledged && (
                            <button onClick={() => api.put(`/scanner/alerts/${a.id}/ack`).then(loadAlerts)}
                              className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors" title="Mark as read">
                              <CheckCheck className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
            }
          </Card>
        </>
      )}

      {/* Modals */}
      <Modal open={modal === 'add-schedule'} onClose={() => setModal(null)} title="New schedule">
        <ScheduleForm hosts={hosts} onSave={() => { setModal(null); loadAll() }} onCancel={() => setModal(null)} />
      </Modal>
      {modal?.type === 'edit-schedule' && (
        <Modal open onClose={() => setModal(null)} title={`Edit — ${modal.data.label || modal.data.cron_expr}`}>
          <ScheduleForm hosts={hosts} initial={modal.data} onSave={() => { setModal(null); loadAll() }} onCancel={() => setModal(null)} />
        </Modal>
      )}
      <Modal open={modal === 'add-rule'} onClose={() => setModal(null)} title="New alert rule">
        <RuleForm hosts={hosts} onSave={() => { setModal(null); loadAll() }} onCancel={() => setModal(null)} />
      </Modal>
    </div>
  )
}
