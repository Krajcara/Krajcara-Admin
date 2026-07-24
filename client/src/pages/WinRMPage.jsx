import { useState, useEffect, useCallback } from 'react'
import {
  Monitor, Plus, Edit2, Trash2, Play, RefreshCw,
  CheckCircle, XCircle, Loader, Lock, ChevronDown,
  Cpu, MemoryStick, HardDrive, Clock, Activity, Search
} from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { cn, timeAgo, fmtUptime } from '../lib/utils'
import { Card, CardHeader, CardTitle, CardContent, Button, Spinner, AlertBox, Badge, Input, Modal } from '../components/shared/UI'

// ── Helpers ───────────────────────────────────────────────────────────────────
const usageColor = pct =>
  pct >= 90 ? 'text-red-600 dark:text-red-400' :
  pct >= 70 ? 'text-orange-500 dark:text-orange-400' :
  'text-green-600 dark:text-green-400'

const UsageBar = ({ pct, color }) => (
  <div className="w-full h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
    <div className={cn('h-full rounded-full transition-all', color)}
      style={{ width: `${Math.min(100, pct || 0)}%` }} />
  </div>
)

// ── Server form ───────────────────────────────────────────────────────────────
const EMPTY = { name:'', ip_address:'', winrm_port:5985, winrm_https:false, winrm_user:'', winrm_password:'', description:'', group_name:'' }

function ServerForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({ ...EMPTY, ...initial, winrm_https: !!initial?.winrm_https })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const save = async () => {
    setSaving(true); setError('')
    try {
      if (initial?.id) await api.put(`/winrm/${initial.id}`, form)
      else await api.post('/winrm', form)
      onSave()
    } catch (e) { setError(e.response?.data?.error || 'Save failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-3">
      {error && <AlertBox type="error">{error}</AlertBox>}
      <div className="grid grid-cols-2 gap-3">
        <Input label="Name *" value={form.name} onChange={f('name')} autoComplete="off" />
        <Input label="IP Address *" value={form.ip_address} onChange={f('ip_address')} autoComplete="off" />
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Input label="WinRM Port" type="number" value={form.winrm_port} onChange={f('winrm_port')} />
        <Input label="Username *" value={form.winrm_user} onChange={f('winrm_user')} autoComplete="off" placeholder="Administrator" />
        <Input label={`Password${initial?.has_password ? ' (blank = keep)' : ' *'}`} type="password"
          value={form.winrm_password} onChange={f('winrm_password')} autoComplete="new-password" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Group" value={form.group_name} onChange={f('group_name')} placeholder="e.g. Domain Controllers" />
        <Input label="Description" value={form.description} onChange={f('description')} />
      </div>
      <label className="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" checked={form.winrm_https} onChange={e => setForm(p => ({ ...p, winrm_https: e.target.checked }))} className="w-4 h-4 rounded text-brand" />
        <span className="text-sm text-gray-700 dark:text-gray-300">Use HTTPS (port 5986)</span>
      </label>
      <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-xs text-blue-700 dark:text-blue-300">
        <strong>Windows setup required</strong> — run on each Windows server as Administrator:<br />
        <code className="font-mono bg-blue-100 dark:bg-blue-900/40 px-1 rounded mt-1 block">
          Enable-PSRemoting -Force; Set-Item WSMan:\localhost\Service\Auth\Basic $true; Set-Item WSMan:\localhost\Service\AllowUnencrypted $true
        </code>
      </div>
      <div className="flex gap-3 pt-1">
        <Button loading={saving} onClick={save}>{initial?.id ? 'Update' : 'Add server'}</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

// ── Server card ───────────────────────────────────────────────────────────────
function ServerCard({ srv, onEdit, onDelete, onViewDetails, canManage }) {
  const [testing,    setTesting]    = useState(false)
  const [testResult, setTestResult] = useState(null)
  const [metrics,    setMetrics]    = useState(null)
  const [loadingM,   setLoadingM]   = useState(false)

  const test = async () => {
    setTesting(true); setTestResult(null)
    try { const r = await api.post(`/winrm/${srv.id}/test`); setTestResult(r.data) }
    catch { setTestResult({ ok: false, error: 'Request failed' }) }
    finally { setTesting(false) }
  }

  const loadMetrics = async () => {
    setLoadingM(true)
    try { const r = await api.get(`/winrm/${srv.id}/metrics/live`); setMetrics(r.data) }
    catch (e) { setMetrics({ error: e.response?.data?.error || 'Failed' }) }
    finally { setLoadingM(false) }
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center flex-shrink-0">
            <Monitor className="w-4 h-4 text-blue-600" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 dark:text-white truncate">{srv.name}</p>
            <p className="text-xs text-gray-500 font-mono">{srv.ip_address}:{srv.winrm_port}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={test} disabled={testing} title="Test connection" className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors">
            {testing ? <Loader className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          </button>
          <button onClick={loadMetrics} disabled={loadingM} title="Get live metrics" className="p-1.5 text-gray-400 hover:text-green-600 rounded transition-colors">
            {loadingM ? <Loader className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
          </button>
          {canManage && <>
            <button onClick={() => onEdit(srv)} className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors"><Edit2 className="w-4 h-4" /></button>
            <button onClick={() => onDelete(srv)} className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"><Trash2 className="w-4 h-4" /></button>
          </>}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap mb-3">
        <Badge className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">Windows</Badge>
        <Badge className="text-xs bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
          <Lock className="w-3 h-3 inline mr-0.5" />WinRM {srv.winrm_https ? 'HTTPS' : 'HTTP'}
        </Badge>
        {srv.group_name && <Badge className="text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">{srv.group_name}</Badge>}
        {srv.last_seen && <span className="text-xs text-gray-400">last seen {timeAgo(srv.last_seen)}</span>}
      </div>

      {testResult && (
        <div className={cn('flex items-center gap-1.5 text-xs px-2 py-1.5 rounded mb-2',
          testResult.ok ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
                        : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300')}>
          {testResult.ok ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
          {testResult.ok ? `Connected — ${testResult.hostname || 'ok'} (${testResult.durationMs}ms)` : testResult.error}
        </div>
      )}

      {/* Live metrics */}
      {metrics && !metrics.error && (
        <div className="border-t border-gray-100 dark:border-gray-800 pt-3 space-y-2">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Live metrics — {metrics.os_name}</p>
          {[
            { label: 'CPU',  pct: metrics.cpu_pct,  color: 'bg-blue-500' },
            { label: 'RAM',  pct: metrics.mem_pct,  color: 'bg-purple-500' },
            { label: 'Disk', pct: metrics.disk_pct, color: 'bg-orange-500' },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-8">{s.label}</span>
              <UsageBar pct={s.pct} color={s.color} />
              <span className={cn('text-xs font-semibold w-8 text-right', usageColor(s.pct))}>{s.pct}%</span>
            </div>
          ))}
          <div className="flex items-center gap-4 text-xs text-gray-400 pt-1">
            <span><Clock className="w-3 h-3 inline mr-0.5" />{fmtUptime(metrics.uptime_s)}</span>
            <span>{metrics.process_count} processes</span>
            {metrics.disks?.length > 1 && (
              <span>{metrics.disks.map(d => `${d.name} ${d.percent}%`).join(' · ')}</span>
            )}
          </div>
        </div>
      )}
      {metrics?.error && (
        <div className="text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded px-2 py-1.5">{metrics.error}</div>
      )}
    </Card>
  )
}

// ── Scripts tab ───────────────────────────────────────────────────────────────
function ScriptsTab({ canManage, servers }) {
  const [scripts,  setScripts]  = useState([])
  const [execs,    setExecs]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [modal,    setModal]    = useState(null)
  const [runModal, setRunModal] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([api.get('/winrm/scripts'), api.get('/winrm/executions')])
      .then(([s, e]) => { setScripts(s.data); setExecs(e.data) })
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{scripts.length} PowerShell script{scripts.length !== 1 ? 's' : ''}</p>
        {canManage && <Button onClick={() => setModal('add')}><Plus className="w-4 h-4" />New script</Button>}
      </div>

      {loading ? <div className="flex justify-center py-8"><Spinner className="w-5 h-5" /></div>
      : !scripts.length ? (
        <Card className="p-10 text-center">
          <Play className="w-10 h-10 mx-auto mb-2 text-gray-300 dark:text-gray-700" />
          <p className="text-gray-500">No PowerShell scripts yet</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {scripts.map(s => (
            <Card key={s.id} className="p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white">{s.name}</p>
                  {s.description && <p className="text-xs text-gray-500 mt-0.5">{s.description}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">PowerShell</Badge>
                  {canManage && <>
                    <button onClick={() => setRunModal(s)}
                      className="flex items-center gap-1 text-xs px-2 py-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 rounded hover:bg-green-200 transition-colors">
                      <Play className="w-3 h-3" />Run
                    </button>
                    <button onClick={() => setModal(s)} className="p-1.5 text-gray-400 hover:text-brand rounded"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={async () => { await api.delete(`/winrm/scripts/${s.id}`); load(); }} className="p-1.5 text-gray-400 hover:text-red-500 rounded"><Trash2 className="w-4 h-4" /></button>
                  </>}
                </div>
              </div>
              <pre className="mt-2 text-xs bg-gray-100 dark:bg-gray-900 rounded p-2 overflow-x-auto max-h-20 text-gray-600 dark:text-gray-400 font-mono">
                {s.content.slice(0, 250)}{s.content.length > 250 ? '...' : ''}
              </pre>
            </Card>
          ))}
        </div>
      )}

      {execs.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Recent executions</p>
          <div className="space-y-2">
            {execs.slice(0, 10).map(e => (
              <div key={e.id} className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
                <div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{e.script_name}</span>
                  <span className="text-xs text-gray-400 ml-2">by {e.started_by_name || 'system'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={cn('text-xs', e.status === 'done' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300')}>
                    {e.status}
                  </Badge>
                  <span className="text-xs text-gray-400">{timeAgo(e.started_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal === 'add' ? 'New PowerShell script' : `Edit — ${modal?.name}`} size="lg">
        {modal && <ScriptForm initial={modal==='add'?null:modal} onSave={()=>{setModal(null);load();}} onCancel={()=>setModal(null)} />}
      </Modal>

      <Modal open={!!runModal} onClose={() => setRunModal(null)} title={`Run — ${runModal?.name}`} size="md">
        {runModal && <RunModal script={runModal} servers={servers} onDone={()=>{setRunModal(null);load();}} />}
      </Modal>
    </div>
  )
}

function ScriptForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({ name:'', description:'', content:'', ...initial })
  const [saving, setSaving] = useState(false)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))
  const save = async () => {
    setSaving(true)
    try {
      if (initial?.id) await api.put(`/winrm/scripts/${initial.id}`, form)
      else await api.post('/winrm/scripts', form)
      onSave()
    } catch {} finally { setSaving(false) }
  }
  return (
    <div className="space-y-3">
      <Input label="Script name *" value={form.name} onChange={f('name')} />
      <Input label="Description" value={form.description} onChange={f('description')} />
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">PowerShell script *</label>
        <textarea rows={12} value={form.content} onChange={f('content')}
          placeholder={"$ErrorActionPreference='Stop'\nWrite-Output 'Hello from PowerShell'"}
          className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand resize-none" />
      </div>
      <div className="flex gap-3">
        <Button loading={saving} onClick={save}>{initial?.id ? 'Update' : 'Create'}</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

function RunModal({ script, servers, onDone }) {
  const [selected, setSelected] = useState([])
  const [running,  setRunning]  = useState(false)
  const [outputs,  setOutputs]  = useState({})
  const toggle = id => setSelected(p => p.includes(id) ? p.filter(x=>x!==id) : [...p, id])

  const run = async () => {
    if (!selected.length) return
    setRunning(true)
    try {
      const r = await api.post('/winrm/run', { serverIds: selected, scriptId: script.id })
      // Poll for results
      const poll = setInterval(async () => {
        try {
          const res = await api.get(`/winrm/executions`)
          const exec = res.data.find(e => e.id === r.data.executionId)
          if (exec?.result) {
            const parsed = typeof exec.result === 'string' ? JSON.parse(exec.result) : exec.result
            setOutputs(parsed)
          }
          if (exec?.status === 'done' || exec?.status === 'error') {
            clearInterval(poll); setRunning(false)
          }
        } catch {}
      }, 2000)
    } catch { setRunning(false) }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Select Windows servers</p>
        <div className="space-y-1.5 max-h-40 overflow-y-auto">
          {servers.map(s => (
            <label key={s.id} className="flex items-center gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
              <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} className="w-4 h-4 rounded text-brand" />
              <span className="text-sm font-medium text-gray-900 dark:text-white">{s.name}</span>
              <span className="text-xs text-gray-400 font-mono">{s.ip_address}</span>
            </label>
          ))}
          {!servers.length && <p className="text-sm text-gray-400">No Windows servers configured</p>}
        </div>
      </div>
      {!Object.keys(outputs).length && (
        <Button loading={running} disabled={!selected.length} onClick={run}>
          <Play className="w-4 h-4" />Run on {selected.length} server{selected.length!==1?'s':''}
        </Button>
      )}
      {Object.entries(outputs).map(([sid, r]) => {
        const srv = servers.find(s => s.id === parseInt(sid))
        return (
          <div key={sid}>
            <p className="text-xs font-bold text-gray-500 mb-1">{srv?.name} — <span className={r.status==='success'?'text-green-600':'text-red-600'}>{r.status}</span></p>
            <pre className="text-xs bg-gray-900 text-green-400 rounded-lg p-3 overflow-x-auto max-h-40 font-mono whitespace-pre-wrap">{r.output||'No output'}</pre>
          </div>
        )
      })}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function WinRMPage() {
  const [servers,   setServers]   = useState([])
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [modal,     setModal]     = useState(null)
  const [delTarget, setDelTarget] = useState(null)
  const [deleting,  setDeleting]  = useState(false)
  const [activeTab, setActiveTab] = useState('servers')
  const { user } = useAuthStore()
  const canManage = ['superadmin', 'admin'].includes(user?.role)

  const load = useCallback(() => {
    setLoading(true)
    api.get('/winrm').then(r => setServers(r.data)).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const filtered = servers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.ip_address.includes(search) ||
    (s.group_name||'').toLowerCase().includes(search.toLowerCase())
  )
  const groups = {}
  for (const s of filtered) { const g = s.group_name||'Ungrouped'; if(!groups[g]) groups[g]=[]; groups[g].push(s) }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Windows Servers</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">WinRM management — {servers.length} server{servers.length!==1?'s':''} configured</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {['servers','scripts'].map(t => (
              <button key={t} onClick={() => setActiveTab(t)}
                className={cn('px-3 py-1.5 text-sm font-medium rounded-lg transition-colors capitalize',
                  activeTab===t?'bg-brand text-white':'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400')}>
                {t}
              </button>
            ))}
          </div>
          {canManage && activeTab==='servers' && (
            <Button onClick={() => setModal('add')}><Plus className="w-4 h-4" />Add server</Button>
          )}
        </div>
      </div>

      {activeTab === 'servers' && (
        <>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search servers..."
            className="max-w-xs w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />

          {loading ? <div className="flex justify-center py-12"><Spinner className="w-6 h-6" /></div>
          : !servers.length ? (
            <Card className="p-12 text-center">
              <Monitor className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-700" />
              <p className="text-gray-500">No Windows servers configured</p>
              {canManage && <Button className="mt-4" onClick={() => setModal('add')}><Plus className="w-4 h-4" />Add first server</Button>}
            </Card>
          ) : (
            <div className="space-y-6">
              {Object.entries(groups).map(([group, srvs]) => (
                <div key={group}>
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">{group} ({srvs.length})</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {srvs.map(srv => (
                      <ServerCard key={srv.id} srv={srv}
                        onEdit={() => setModal(srv)} onDelete={() => setDelTarget(srv)}
                        onViewDetails={() => {}} canManage={canManage} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'scripts' && <ScriptsTab canManage={canManage} servers={servers} />}

      <Modal open={!!modal} onClose={() => setModal(null)} title={modal==='add'?'Add Windows server':`Edit — ${modal?.name}`} size="lg">
        {modal && <ServerForm initial={modal==='add'?null:modal} onSave={()=>{setModal(null);load();}} onCancel={()=>setModal(null)} />}
      </Modal>

      <Modal open={!!delTarget} onClose={() => setDelTarget(null)} title="Delete server" size="sm">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Delete <strong>{delTarget?.name}</strong>?</p>
        <div className="flex gap-3">
          <Button variant="danger" loading={deleting} onClick={async () => {
            setDeleting(true)
            try { await api.delete(`/winrm/${delTarget.id}`); load(); setDelTarget(null) } catch {}
            finally { setDeleting(false) }
          }}>Delete</Button>
          <Button variant="secondary" onClick={() => setDelTarget(null)}>Cancel</Button>
        </div>
      </Modal>
    </div>
  )
}
