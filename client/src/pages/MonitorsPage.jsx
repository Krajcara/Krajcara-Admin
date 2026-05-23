import { useState, useEffect } from 'react'
import { Plus, Trash2, Pencil, Activity } from 'lucide-react'
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts'
import api from '../lib/api'
import { useSocket } from '../hooks/useSocket'
import { useAuthStore } from '../store/authStore'
import { Card, Button, Modal, Input, Select, Badge, Empty, Spinner, AlertBox } from '../components/shared/UI'
import { cn, timeAgo } from '../lib/utils'

const STATUS_DOT = {
  up:       'bg-green-500',
  down:     'bg-red-500 animate-pulse',
  degraded: 'bg-yellow-400 animate-pulse',
  unknown:  'bg-gray-400'
}
const STATUS_COLOR = {
  up:       'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  down:     'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  degraded: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  unknown:  'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
}
const MONITOR_TYPES = ['http', 'https', 'tcp', 'icmp', 'dns']
const INTERVALS = [
  { label: '30 seconds', value: 30 },
  { label: '1 minute',   value: 60 },
  { label: '5 minutes',  value: 300 },
  { label: '10 minutes', value: 600 },
  { label: '30 minutes', value: 1800 },
]

function MonitorForm({ initial, onSave, onCancel }) {
  const isEdit = !!initial?.id
  const [form, setForm] = useState(initial || { label: '', type: 'http', target: '', port: '', interval_s: 60, keyword: '', expected_status: 200 })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      const payload = { ...form, interval_s: parseInt(form.interval_s) || 60, timeout_s: 10, expected_status: parseInt(form.expected_status) || 200, port: form.port ? parseInt(form.port) : undefined }
      isEdit ? await api.put(`/monitors/${initial.id}`, payload) : await api.post('/monitors', payload)
      onSave()
    } catch (err) { setError(err.response?.data?.error || 'Error saving monitor') }
    finally { setLoading(false) }
  }

  return (
    <form onSubmit={submit} autoComplete="off" className="space-y-4">
      {error && <AlertBox type="error">{error}</AlertBox>}
      <Input label="Name *" autoComplete="off" value={form.label} onChange={f('label')} required />
      <Select label="Type" value={form.type} onChange={f('type')}>
        {MONITOR_TYPES.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
      </Select>
      <Input label={form.type === 'icmp' ? 'IP or hostname' : form.type === 'dns' ? 'Domain' : 'URL or IP'}
        autoComplete="off" value={form.target} onChange={f('target')}
        placeholder={form.type === 'http' ? 'https://example.com' : form.type === 'icmp' ? '192.168.1.1' : 'example.com'} required />
      {form.type === 'tcp' && <Input label="Port *" type="number" autoComplete="off" value={form.port} onChange={f('port')} required />}
      <Select label="Check interval" value={form.interval_s} onChange={f('interval_s')}>
        {INTERVALS.map(i => <option key={i.value} value={i.value}>{i.label}</option>)}
      </Select>
      {['http','https'].includes(form.type) && <>
        <Input label="Keyword check (optional)" autoComplete="off" value={form.keyword || ''} onChange={f('keyword')} placeholder="Text that must appear in response" />
        <Input label="Expected HTTP status" type="number" autoComplete="off" value={form.expected_status || 200} onChange={f('expected_status')} />
      </>}
      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={loading}>{isEdit ? 'Save changes' : 'Add monitor'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

function MonitorCard({ monitor, onEdit, onDelete, canEdit }) {
  const [checks,  setChecks]  = useState([])
  const [status,  setStatus]  = useState(monitor.last_status || 'unknown')
  const [latency, setLatency] = useState(monitor.last_latency_ms)

  // Load check history on mount
  useEffect(() => {
    api.get(`/monitors/${monitor.id}/checks?hours=3`)
      .then(r => setChecks(r.data.map(c => ({ t: new Date(c.checked_at).getTime(), v: c.latency_ms || 0 }))))
      .catch(() => {})
  }, [monitor.id])

  // Real-time updates via socket
  useSocket({
    'monitor:status': ({ monitorId, status: s, latency_ms, checked_at }) => {
      if (monitorId !== monitor.id) return
      setStatus(s)
      setLatency(latency_ms)
      if (latency_ms != null) {
        setChecks(prev => [...prev, { t: checked_at ? new Date(checked_at).getTime() : Date.now(), v: latency_ms }].slice(-120))
      }
    }
  })

  const lineColor = status === 'down' ? '#ef4444' : status === 'degraded' ? '#eab308' : '#22c55e'

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', STATUS_DOT[status])} />
          <div>
            <p className="font-medium text-gray-900 dark:text-white text-sm">{monitor.label}</p>
            <p className="text-xs text-gray-400 font-mono truncate max-w-48">{monitor.target}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Badge className={cn('text-xs', STATUS_COLOR[status])}>{status}</Badge>
          {canEdit && <>
            <button onClick={() => onEdit(monitor)} className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors"><Pencil className="w-3 h-3" /></button>
            <button onClick={() => onDelete(monitor.id)} className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"><Trash2 className="w-3 h-3" /></button>
          </>}
        </div>
      </div>

      {/* Chart — only shown when there's data */}
      {checks.length > 0 && (
        <div className="h-10 mb-3">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={checks}>
              <Line type="monotone" dataKey="v" stroke={lineColor} dot={false} strokeWidth={1.5} isAnimationActive={false} />
              <Tooltip
                contentStyle={{ fontSize: 11, padding: '2px 6px', borderRadius: 6, border: 'none', background: '#111827', color: '#f9fafb' }}
                formatter={v => [`${v}ms`, 'Latency']}
                labelFormatter={() => ''}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>{latency != null ? `${latency}ms` : '—'}</span>
        <span className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded font-mono">{monitor.type.toUpperCase()}</span>
        <span>{monitor.last_checked_at ? timeAgo(monitor.last_checked_at) : 'Not checked yet'}</span>
      </div>
    </Card>
  )
}

export default function MonitorsPage() {
  const [monitors, setMonitors] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [modal,    setModal]    = useState(null)
  const [deleteId, setDeleteId] = useState(null)
  const { user } = useAuthStore()
  const canEdit = ['superadmin', 'admin', 'operator'].includes(user?.role)

  const load = () => {
    setLoading(true)
    api.get('/monitors')
      .then(r => setMonitors([...(r.data || [])].sort((a, b) => a.label.localeCompare(b.label))))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const handleDelete = async () => {
    await api.delete(`/monitors/${deleteId}`).catch(() => {})
    setDeleteId(null); load()
  }

  const stats = {
    up:       monitors.filter(m => m.last_status === 'up').length,
    down:     monitors.filter(m => m.last_status === 'down').length,
    degraded: monitors.filter(m => m.last_status === 'degraded').length,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Uptime Monitor</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{monitors.length} monitor{monitors.length !== 1 ? 's' : ''}</p>
        </div>
        {canEdit && <Button onClick={() => setModal('add')}><Plus className="w-4 h-4" />Add monitor</Button>}
      </div>

      {monitors.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          {[
            { label: 'Up',       count: stats.up,       cls: 'text-green-600 dark:text-green-400' },
            { label: 'Down',     count: stats.down,     cls: 'text-red-600 dark:text-red-400' },
            { label: 'Degraded', count: stats.degraded, cls: 'text-yellow-600 dark:text-yellow-400' },
          ].map(s => (
            <div key={s.label} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-lg px-4 py-2.5 text-sm">
              <span className="text-gray-500 dark:text-gray-400">{s.label}: </span>
              <span className={cn('font-semibold', s.cls)}>{s.count}</span>
            </div>
          ))}
        </div>
      )}

      {loading
        ? <div className="flex justify-center py-12"><Spinner className="w-6 h-6" /></div>
        : monitors.length === 0
          ? <Card><Empty icon={Activity} title="No monitors" description="Add an HTTP, TCP, ICMP or DNS monitor"
              action={canEdit ? <Button onClick={() => setModal('add')}><Plus className="w-4 h-4" />Add monitor</Button> : null} /></Card>
          : <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {monitors.map(m => <MonitorCard key={m.id} monitor={m} canEdit={canEdit} onEdit={setModal} onDelete={setDeleteId} />)}
            </div>
      }

      <Modal open={modal === 'add'} onClose={() => setModal(null)} title="Add monitor">
        <MonitorForm onSave={() => { setModal(null); load() }} onCancel={() => setModal(null)} />
      </Modal>
      {modal && modal !== 'add' && (
        <Modal open onClose={() => setModal(null)} title={`Edit — ${modal.label}`}>
          <MonitorForm initial={modal} onSave={() => { setModal(null); load() }} onCancel={() => setModal(null)} />
        </Modal>
      )}
      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete monitor" size="sm">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">This will also delete all check history.</p>
        <div className="flex gap-3">
          <Button variant="danger" onClick={handleDelete}>Delete</Button>
          <Button variant="secondary" onClick={() => setDeleteId(null)}>Cancel</Button>
        </div>
      </Modal>
    </div>
  )
}
