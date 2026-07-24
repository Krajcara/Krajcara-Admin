import { useState, useEffect, useCallback } from 'react'
import {
  Server, Plus, Edit2, Trash2, Terminal, Play, CheckCircle,
  XCircle, Loader, Key, Lock, RefreshCw, Search, Tag, ChevronDown
} from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { cn, timeAgo } from '../lib/utils'
import { Card, CardHeader, CardTitle, Button, Spinner, AlertBox, Badge, Input, Modal } from '../components/shared/UI'

// ── Server form ───────────────────────────────────────────────────────────────
const EMPTY_SERVER = {
  name: '', ip_address: '', ssh_port: 22, ssh_user: '',
  ssh_auth: 'password', ssh_password: '', ssh_key: '',
  os_type: 'linux', description: '', group_name: '', enabled: 1,
}

function ServerForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({ ...EMPTY_SERVER, ...initial })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const save = async () => {
    setSaving(true); setError('')
    try {
      if (initial?.id) await api.put(`/servers/${initial.id}`, form)
      else await api.post('/servers', form)
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
        <Input label="SSH Port" type="number" value={form.ssh_port} onChange={f('ssh_port')} />
        <Input label="SSH User *" value={form.ssh_user} onChange={f('ssh_user')} autoComplete="off" />
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Auth type</label>
          <select value={form.ssh_auth} onChange={f('ssh_auth')}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand">
            <option value="password">Password</option>
            <option value="key">SSH Key</option>
            <option value="key_and_password">Key + Password</option>
          </select>
        </div>
      </div>

      {(form.ssh_auth === 'password' || form.ssh_auth === 'key_and_password') && (
        <Input label={`SSH Password${initial?.has_password ? ' (leave blank to keep)' : ' *'}`}
          type="password" value={form.ssh_password} onChange={f('ssh_password')} autoComplete="new-password" />
      )}
      {(form.ssh_auth === 'key' || form.ssh_auth === 'key_and_password') && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Private key (PEM){initial?.has_key ? ' — leave blank to keep' : ' *'}
          </label>
          <textarea rows={4} value={form.ssh_key} onChange={f('ssh_key')} autoComplete="off"
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
            className="w-full px-3 py-2 text-xs font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">OS Type</label>
          <select value={form.os_type} onChange={f('os_type')}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand">
            <option value="linux">Linux</option>
            <option value="windows">Windows</option>
          </select>
        </div>
        <Input label="Group" value={form.group_name} onChange={f('group_name')} placeholder="e.g. Web servers" />
      </div>
      <Input label="Description" value={form.description} onChange={f('description')} />

      <div className="flex gap-3 pt-2">
        <Button loading={saving} onClick={save}>{initial?.id ? 'Update' : 'Add server'}</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

// ── Server card ───────────────────────────────────────────────────────────────
function ServerCard({ srv, onEdit, onDelete, onTerminal, onTest, canManage }) {
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState(null)

  const test = async () => {
    setTesting(true); setTestResult(null)
    try {
      const r = await api.post(`/servers/${srv.id}/test`)
      setTestResult(r.data)
    } catch { setTestResult({ ok: false, error: 'Request failed' }) }
    finally { setTesting(false) }
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn('w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
            srv.os_type === 'windows' ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-green-100 dark:bg-green-900/30')}>
            <Server className={cn('w-4 h-4', srv.os_type === 'windows' ? 'text-blue-600' : 'text-green-600')} />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 dark:text-white truncate">{srv.name}</p>
            <p className="text-xs text-gray-500 font-mono">{srv.ip_address}:{srv.ssh_port || 22}</p>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {canManage && <>
            <button onClick={test} disabled={testing} title="Test connection"
              className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors">
              {testing ? <Loader className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            </button>
            <button onClick={() => onTerminal(srv)} title="Open terminal"
              className="p-1.5 text-gray-400 hover:text-green-600 rounded transition-colors">
              <Terminal className="w-4 h-4" />
            </button>
            <button onClick={() => onEdit(srv)} className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors">
              <Edit2 className="w-4 h-4" />
            </button>
            <button onClick={() => onDelete(srv)} className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          </>}
          {!canManage && (
            <button onClick={() => onTerminal(srv)} title="Open terminal"
              className="p-1.5 text-gray-400 hover:text-green-600 rounded transition-colors">
              <Terminal className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        <Badge className={cn('text-xs', srv.os_type === 'windows' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300')}>
          {srv.os_type}
        </Badge>
        <Badge className="text-xs bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">
          {srv.ssh_auth === 'key' ? <><Key className="w-3 h-3 inline mr-0.5" />key</> : <><Lock className="w-3 h-3 inline mr-0.5" />password</>}
        </Badge>
        {srv.group_name && <Badge className="text-xs bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">{srv.group_name}</Badge>}
        {srv.last_seen && <span className="text-xs text-gray-400">last seen {timeAgo(srv.last_seen)}</span>}
      </div>

      {testResult && (
        <div className={cn('mt-2 flex items-center gap-1.5 text-xs px-2 py-1 rounded',
          testResult.ok ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-300'
                        : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-300')}>
          {testResult.ok ? <CheckCircle className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
          {testResult.ok ? testResult.message : testResult.error}
        </div>
      )}
    </Card>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function ServersPage() {
  const [servers,  setServers]  = useState([])
  const [loading,  setLoading]  = useState(true)
  const [search,   setSearch]   = useState('')
  const [modal,    setModal]    = useState(null) // null | 'add' | server obj
  const [delTarget,setDelTarget]= useState(null)
  const [deleting, setDeleting] = useState(false)
  const [activeTab,setActiveTab]= useState('servers') // servers | scripts
  const { user } = useAuthStore()
  const canManage = ['superadmin', 'admin'].includes(user?.role)

  const load = useCallback(() => {
    setLoading(true)
    api.get('/servers').then(r => setServers(r.data)).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const openTerminal = (srv) => {
    window.open(`/terminal/${srv.id}`, '_blank', 'width=1000,height=650,menubar=no,toolbar=no')
  }

  const confirmDelete = async () => {
    setDeleting(true)
    try { await api.delete(`/servers/${delTarget.id}`); load(); setDelTarget(null) } catch {}
    finally { setDeleting(false) }
  }

  const filtered = servers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.ip_address.includes(search) ||
    (s.group_name || '').toLowerCase().includes(search.toLowerCase())
  )

  // Group by group_name
  const groups = {}
  for (const s of filtered) {
    const g = s.group_name || 'Ungrouped'
    if (!groups[g]) groups[g] = []
    groups[g].push(s)
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Servers</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{servers.length} server{servers.length !== 1 ? 's' : ''} configured</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {['servers', 'scripts'].map(t => (
              <button key={t} onClick={() => setActiveTab(t)}
                className={cn('px-3 py-1.5 text-sm font-medium rounded-lg transition-colors capitalize',
                  activeTab === t ? 'bg-brand text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400')}>
                {t}
              </button>
            ))}
          </div>
          {canManage && activeTab === 'servers' && (
            <Button onClick={() => setModal('add')}><Plus className="w-4 h-4" />Add server</Button>
          )}
        </div>
      </div>

      {activeTab === 'servers' && (
        <>
          <div className="relative max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search servers..."
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
          </div>

          {loading ? <div className="flex justify-center py-12"><Spinner className="w-6 h-6" /></div>
          : !servers.length ? (
            <Card className="p-12 text-center">
              <Server className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-700" />
              <p className="text-gray-500">No servers configured yet</p>
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
                        onEdit={() => setModal(srv)}
                        onDelete={() => setDelTarget(srv)}
                        onTerminal={openTerminal}
                        onTest={() => {}}
                        canManage={canManage}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {activeTab === 'scripts' && <ScriptsTab canManage={canManage} servers={servers} />}

      {/* Add/Edit modal */}
      <Modal open={!!modal} onClose={() => setModal(null)}
        title={modal === 'add' ? 'Add server' : `Edit — ${modal?.name}`} size="lg">
        {modal && (
          <ServerForm
            initial={modal === 'add' ? null : modal}
            onSave={() => { setModal(null); load(); }}
            onCancel={() => setModal(null)}
          />
        )}
      </Modal>

      {/* Delete modal */}
      <Modal open={!!delTarget} onClose={() => setDelTarget(null)} title="Delete server" size="sm">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Delete <strong>{delTarget?.name}</strong>? This cannot be undone.
        </p>
        <div className="flex gap-3">
          <Button variant="danger" loading={deleting} onClick={confirmDelete}>Delete</Button>
          <Button variant="secondary" onClick={() => setDelTarget(null)}>Cancel</Button>
        </div>
      </Modal>
    </div>
  )
}

// ── Scripts tab ───────────────────────────────────────────────────────────────
const EMPTY_SCRIPT = { name: '', description: '', os_type: 'linux', content: '' }

function ScriptsTab({ canManage, servers }) {
  const [scripts,   setScripts]   = useState([])
  const [execs,     setExecs]     = useState([])
  const [loading,   setLoading]   = useState(true)
  const [modal,     setModal]     = useState(null)
  const [runModal,  setRunModal]  = useState(null)
  const [execModal, setExecModal] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([api.get('/servers/scripts'), api.get('/servers/executions')])
      .then(([s, e]) => { setScripts(s.data); setExecs(e.data) })
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{scripts.length} script{scripts.length !== 1 ? 's' : ''} saved</p>
        {canManage && <Button onClick={() => setModal('add')}><Plus className="w-4 h-4" />New script</Button>}
      </div>

      {loading ? <div className="flex justify-center py-12"><Spinner className="w-6 h-6" /></div>
      : !scripts.length ? (
        <Card className="p-12 text-center">
          <Play className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-700" />
          <p className="text-gray-500">No scripts yet</p>
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
                  <Badge className={cn('text-xs', s.os_type === 'windows' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300')}>
                    {s.os_type}
                  </Badge>
                  {canManage && <>
                    <button onClick={() => setRunModal(s)} className="flex items-center gap-1 text-xs px-2 py-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 rounded hover:bg-green-200 transition-colors">
                      <Play className="w-3 h-3" />Run
                    </button>
                    <button onClick={() => setModal(s)} className="p-1.5 text-gray-400 hover:text-brand rounded"><Edit2 className="w-4 h-4" /></button>
                    <button onClick={async () => { await api.delete(`/servers/scripts/${s.id}`); load(); }} className="p-1.5 text-gray-400 hover:text-red-500 rounded"><Trash2 className="w-4 h-4" /></button>
                  </>}
                </div>
              </div>
              <pre className="mt-2 text-xs bg-gray-100 dark:bg-gray-900 rounded p-2 overflow-x-auto max-h-24 text-gray-600 dark:text-gray-400">{s.content.slice(0, 300)}{s.content.length > 300 ? '...' : ''}</pre>
            </Card>
          ))}
        </div>
      )}

      {/* Recent executions */}
      {execs.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Recent executions</p>
          <div className="space-y-2">
            {execs.slice(0, 10).map(e => (
              <div key={e.id} className="flex items-center justify-between px-4 py-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
                onClick={() => setExecModal(e)}>
                <div>
                  <span className="text-sm font-medium text-gray-900 dark:text-white">{e.script_name}</span>
                  <span className="text-xs text-gray-400 ml-2">by {e.started_by_name || 'system'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className={cn('text-xs', e.status === 'done' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : e.status === 'error' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300')}>
                    {e.status}
                  </Badge>
                  <span className="text-xs text-gray-400">{timeAgo(e.started_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Script edit modal */}
      <Modal open={!!modal} onClose={() => setModal(null)} title={modal === 'add' ? 'New script' : `Edit — ${modal?.name}`} size="lg">
        {modal && <ScriptForm initial={modal === 'add' ? null : modal} onSave={() => { setModal(null); load(); }} onCancel={() => setModal(null)} />}
      </Modal>

      {/* Run modal */}
      <Modal open={!!runModal} onClose={() => setRunModal(null)} title={`Run — ${runModal?.name}`} size="md">
        {runModal && <RunScriptModal script={runModal} servers={servers} onDone={() => { setRunModal(null); load(); }} />}
      </Modal>

      {/* Exec result modal */}
      <Modal open={!!execModal} onClose={() => setExecModal(null)} title="Execution details" size="lg">
        {execModal && <ExecDetails exec={execModal} />}
      </Modal>
    </div>
  )
}

function ScriptForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState({ ...EMPTY_SCRIPT, ...initial })
  const [saving, setSaving] = useState(false)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const save = async () => {
    setSaving(true)
    try {
      if (initial?.id) await api.put(`/servers/scripts/${initial.id}`, form)
      else await api.post('/servers/scripts', form)
      onSave()
    } catch { } finally { setSaving(false) }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Input label="Script name *" value={form.name} onChange={f('name')} />
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">OS Type</label>
          <select value={form.os_type} onChange={f('os_type')}
            className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand">
            <option value="linux">Linux (Bash)</option>
            <option value="windows">Windows (PowerShell)</option>
          </select>
        </div>
      </div>
      <Input label="Description" value={form.description} onChange={f('description')} />
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Script content *</label>
        <textarea rows={12} value={form.content} onChange={f('content')}
          placeholder={form.os_type === 'linux' ? '#!/bin/bash\n\necho "Hello"' : "Write-Output 'Hello'"}
          className="w-full px-3 py-2 text-sm font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand resize-none" />
      </div>
      <div className="flex gap-3">
        <Button loading={saving} onClick={save}>{initial?.id ? 'Update' : 'Create'}</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

function RunScriptModal({ script, servers, onDone }) {
  const [selected, setSelected] = useState([])
  const [running,  setRunning]  = useState(false)
  const [execId,   setExecId]   = useState(null)
  const [output,   setOutput]   = useState({}) // serverId -> [{type, data}]

  const compatible = servers.filter(s => s.os_type === script.os_type || script.os_type === 'any')

  const toggle = id => setSelected(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])

  const run = async () => {
    if (!selected.length) return
    setRunning(true)
    try {
      const r = await api.post('/servers/run', { serverIds: selected, scriptId: script.id })
      setExecId(r.data.executionId)

      // Listen via socket
      const io = (await import('../lib/api')).default
      // Poll for results every 2s
      const poll = setInterval(async () => {
        try {
          const res = await api.get(`/servers/executions/${r.data.executionId}`)
          if (res.data.status === 'done' || res.data.status === 'error') {
            clearInterval(poll)
            setRunning(false)
          }
          if (res.data.result) {
            const parsed = typeof res.data.result === 'string' ? JSON.parse(res.data.result) : res.data.result
            const out = {}
            for (const [sid, v] of Object.entries(parsed)) {
              out[sid] = [{ type: v.status === 'success' ? 'stdout' : 'stderr', data: v.output || v.error || '' }]
            }
            setOutput(out)
          }
        } catch {}
      }, 2000)
    } catch { setRunning(false) }
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Select servers ({compatible.length} compatible)</p>
        <div className="space-y-1.5 max-h-48 overflow-y-auto">
          {compatible.map(s => (
            <label key={s.id} className="flex items-center gap-2.5 cursor-pointer p-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800">
              <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} className="w-4 h-4 rounded text-brand" />
              <span className="text-sm font-medium text-gray-900 dark:text-white">{s.name}</span>
              <span className="text-xs text-gray-400 font-mono">{s.ip_address}</span>
            </label>
          ))}
          {!compatible.length && <p className="text-sm text-gray-400 py-2">No compatible servers for {script.os_type}</p>}
        </div>
      </div>

      {!execId && (
        <Button loading={running} disabled={!selected.length} onClick={run}>
          <Play className="w-4 h-4" />Run on {selected.length} server{selected.length !== 1 ? 's' : ''}
        </Button>
      )}

      {Object.keys(output).length > 0 && (
        <div className="space-y-3">
          {selected.map(sid => {
            const srv  = compatible.find(s => s.id === sid)
            const out  = output[sid]
            return (
              <div key={sid}>
                <p className="text-xs font-bold text-gray-500 mb-1">{srv?.name}</p>
                <pre className="text-xs bg-gray-900 text-green-400 rounded-lg p-3 overflow-x-auto max-h-40 font-mono whitespace-pre-wrap">
                  {out?.map(o => o.data).join('') || 'Running...'}
                </pre>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ExecDetails({ exec }) {
  const result = exec.result ? (typeof exec.result === 'string' ? JSON.parse(exec.result) : exec.result) : {}
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div><span className="text-gray-500">Script:</span> <strong>{exec.script_name}</strong></div>
        <div><span className="text-gray-500">Status:</span> <Badge className={cn('text-xs ml-1', exec.status === 'done' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700')}>{exec.status}</Badge></div>
        <div><span className="text-gray-500">Started:</span> {new Date(exec.started_at + 'Z').toLocaleString()}</div>
        {exec.finished_at && <div><span className="text-gray-500">Finished:</span> {new Date(exec.finished_at + 'Z').toLocaleString()}</div>}
      </div>
      {Object.entries(result).map(([sid, r]) => (
        <div key={sid}>
          <p className="text-xs font-bold text-gray-500 mb-1">Server ID {sid} — <span className={r.status === 'success' ? 'text-green-600' : 'text-red-600'}>{r.status}</span></p>
          <pre className="text-xs bg-gray-900 text-green-400 rounded-lg p-3 overflow-x-auto max-h-40 font-mono whitespace-pre-wrap">{r.output || r.error || '—'}</pre>
        </div>
      ))}
    </div>
  )
}
