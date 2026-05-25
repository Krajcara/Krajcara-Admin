import { useState, useEffect, useCallback } from 'react'
import { Server, Cpu, HardDrive, RefreshCw, Power, RotateCcw, Square, Play, Settings, Database, ChevronDown, ChevronUp, CheckCircle, XCircle } from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Modal, AlertBox, Spinner, Badge } from '../components/shared/UI'
import { cn } from '../lib/utils'

function fmtUptime(secs) {
  if (!secs) return null
  const d = Math.floor(secs/86400), h = Math.floor((secs%86400)/3600), m = Math.floor((secs%3600)/60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function UsageBar({ pct, color = 'bg-brand' }) {
  const v = Math.min(Math.max(pct || 0, 0), 100)
  const c = v > 90 ? 'bg-red-500' : v > 75 ? 'bg-yellow-500' : color
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', c)} style={{ width: `${v}%` }} />
      </div>
      <span className="text-xs font-mono w-8 text-right text-gray-500">{v}%</span>
    </div>
  )
}

const STATUS_DOT  = { running: 'bg-green-500', stopped: 'bg-gray-400', paused: 'bg-yellow-400' }
const STATUS_BADGE = { running: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300', stopped: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400', paused: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' }

function VmRow({ vm, node, onAction, canManage }) {
  const [confirming, setConfirming] = useState(null)
  const [loading, setLoading] = useState(false)

  const doAction = async (action) => {
    setLoading(true)
    try { await onAction(node, vm.type, vm.vmid, action) }
    finally { setLoading(false); setConfirming(null) }
  }

  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className={cn('w-2 h-2 rounded-full flex-shrink-0', STATUS_DOT[vm.status] || 'bg-gray-300')} />
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-gray-900 dark:text-white">{vm.name}</p>
              <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium',
                vm.type === 'lxc'
                  ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                  : 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
              )}>
                {vm.type === 'lxc' ? 'LXC' : 'VM'}
              </span>
            </div>
            <p className="text-xs text-gray-400">#{vm.vmid}</p>
          </div>
        </div>
      </td>
      <td className="px-4 py-2.5">
        <Badge className={cn('text-xs', STATUS_BADGE[vm.status] || 'bg-gray-100 text-gray-600')}>{vm.status}</Badge>
      </td>
      <td className="px-4 py-2.5 text-xs text-gray-500">{vm.os || '—'}</td>
      <td className="px-4 py-2.5 text-xs font-mono text-gray-500">{vm.ip || '—'}</td>
      <td className="px-4 py-2.5 min-w-[100px]">
        {vm.status === 'running' ? <UsageBar pct={vm.cpu_usage} color="bg-brand" /> : <span className="text-xs text-gray-300">—</span>}
      </td>
      <td className="px-4 py-2.5 min-w-[100px]">
        {vm.status === 'running'
          ? <><UsageBar pct={vm.mem_usage} color="bg-purple-500" /><p className="text-xs text-gray-400 mt-0.5">{vm.mem_used_gb} / {vm.mem_max_gb} GB</p></>
          : <span className="text-xs text-gray-300">—</span>}
      </td>
      <td className="px-4 py-2.5 text-xs text-gray-500">{vm.uptime_s ? fmtUptime(vm.uptime_s) : '—'}</td>
      {canManage && (
        <td className="px-4 py-2.5">
          {confirming ? (
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-500">{confirming}?</span>
              <button onClick={() => doAction(confirming)} disabled={loading} className="text-xs text-red-500 hover:underline">{loading ? '...' : 'Yes'}</button>
              <button onClick={() => setConfirming(null)} className="text-xs text-gray-400 hover:underline">No</button>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              {vm.status !== 'running' && <button onClick={() => doAction('start')} className="p-1 text-green-500 hover:text-green-700 rounded" title="Start"><Play className="w-3.5 h-3.5" /></button>}
              {vm.status === 'running' && <button onClick={() => setConfirming('shutdown')} className="p-1 text-gray-400 hover:text-gray-600 rounded" title="Shutdown"><Square className="w-3.5 h-3.5" /></button>}
              {vm.status === 'running' && <button onClick={() => setConfirming('reboot')} className="p-1 text-gray-400 hover:text-gray-600 rounded" title="Reboot"><RotateCcw className="w-3.5 h-3.5" /></button>}
              {vm.status === 'running' && <button onClick={() => setConfirming('stop')} className="p-1 text-red-400 hover:text-red-600 rounded" title="Stop (force)"><Power className="w-3.5 h-3.5" /></button>}
            </div>
          )}
        </td>
      )}
    </tr>
  )
}

function NodeCard({ node, onAction, canManage }) {
  const [expanded, setExpanded] = useState(true)
  const total = node.vm_count + node.lxc_count
  const running = [...(node.vms||[]), ...(node.lxc||[])].filter(v => v.status === 'running').length

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800 cursor-pointer" onClick={() => setExpanded(s => !s)}>
        <div className="flex items-center gap-3">
          <div className={cn('w-3 h-3 rounded-full', node.status === 'online' ? 'bg-green-500' : 'bg-red-500')} />
          <div>
            <p className="font-semibold text-gray-900 dark:text-white">{node.node}</p>
            <p className="text-xs text-gray-400">{total} VM{total !== 1 ? 's' : ''} · {running} running · {node.status}</p>
          </div>
        </div>
        <div className="flex items-center gap-6 mr-4">
          <div className="text-right hidden sm:block">
            <p className="text-xs text-gray-400 mb-1">CPU ({node.maxcpu} cores)</p>
            <UsageBar pct={node.cpu_usage} color="bg-brand" />
          </div>
          <div className="text-right hidden sm:block">
            <p className="text-xs text-gray-400 mb-1">RAM {node.mem_used_gb}/{node.mem_max_gb} GB</p>
            <UsageBar pct={node.mem_usage} color="bg-purple-500" />
          </div>
          <div className="text-right hidden md:block">
            <p className="text-xs text-gray-400 mb-1">Disk</p>
            <UsageBar pct={node.disk_usage} color="bg-orange-500" />
          </div>
          {node.uptime && <p className="text-xs text-gray-400 hidden lg:block">{fmtUptime(node.uptime)}</p>}
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {expanded && (
        <div>
          {/* Storage */}
          {node.storages?.length > 0 && (
            <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800">
              <p className="text-xs font-semibold text-gray-400 uppercase mb-2 flex items-center gap-1"><Database className="w-3.5 h-3.5" />Storage</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {node.storages.map(s => (
                  <div key={s.storage} className="bg-gray-50 dark:bg-gray-800/50 rounded-lg px-3 py-2">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-xs font-medium text-gray-700 dark:text-gray-300 truncate">{s.storage}</p>
                      <span className="text-xs text-gray-400">{s.type}</span>
                    </div>
                    {s.usage_pct != null && <UsageBar pct={s.usage_pct} color="bg-orange-500" />}
                    <p className="text-xs text-gray-400 mt-1">{s.used_gb} / {s.total_gb} GB</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* VMs + LXC table */}
          {total > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">OS</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">IP</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-28">CPU</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase w-32">Memory</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Uptime</th>
                    {canManage && <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {[...(node.vms||[]), ...(node.lxc||[])].sort((a, b) =>
                    (a.name || '').localeCompare(b.name || '')
                  ).map(vm => <VmRow key={`${vm.type}-${vm.vmid}`} vm={vm} node={node.node} onAction={onAction} canManage={canManage} />)}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-400 text-center py-6">No VMs or containers</p>
          )}
        </div>
      )}
    </Card>
  )
}

function ConfigModal({ config, onSave, onClose }) {
  const [form, setForm] = useState({ url: config?.url || '', user: config?.user || 'root@pam', token_id: config?.tokenId || '', api_token: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true)
    try { await api.post('/proxmox/config', form); onSave() }
    catch (err) { setError(err.response?.data?.error || 'Error saving config') }
    finally { setLoading(false) }
  }

  return (
    <Modal open onClose={onClose} title="Proxmox configuration" size="md">
      <form onSubmit={submit} autoComplete="off" className="space-y-4">
        {error && <AlertBox type="error">{error}</AlertBox>}
        <AlertBox type="info">
          Create an API token in Proxmox: Datacenter → Permissions → API Tokens. The token needs VM.Audit, Datastore.Audit (and VM.PowerMgmt for actions).
        </AlertBox>
        <Input label="Proxmox URL" autoComplete="off" value={form.url} onChange={f('url')} placeholder="https://192.168.1.10:8006" required />
        <Input label="User" autoComplete="off" value={form.user} onChange={f('user')} placeholder="root@pam" />
        <Input label="Token ID" autoComplete="off" value={form.token_id} onChange={f('token_id')} placeholder="krajcara-admin" />
        <Input label={config?.hasSecret ? 'API Token Secret (blank = keep current)' : 'API Token Secret'} type="password" autoComplete="new-password" value={form.api_token} onChange={f('api_token')} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
        <p className="text-xs text-gray-400">Token format will be built as: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">{form.user}!{form.token_id || 'tokenId'}=secret</code></p>
        <div className="flex gap-3 pt-2">
          <Button type="submit" loading={loading}>Save</Button>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  )
}

export default function ProxmoxPage() {
  const [data,        setData]        = useState(null)
  const [config,      setConfig]      = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState(null)
  const [showConfig,  setShowConfig]  = useState(false)
  const [actionMsg,   setActionMsg]   = useState(null)
  const { user } = useAuthStore()
  const canManage = ['superadmin','admin'].includes(user?.role)

  const loadConfig = useCallback(() => {
    api.get('/proxmox/config').then(r => setConfig(r.data)).catch(() => {})
  }, [])

  const load = useCallback(() => {
    setLoading(true); setError(null)
    api.get('/proxmox/nodes')
      .then(r => { setData(r.data); if (!r.data.configured) setError(null) })
      .catch(e => setError(e.response?.data?.error || 'Failed to connect to Proxmox'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadConfig(); load() }, [loadConfig, load])

  const handleAction = async (node, type, vmid, action) => {
    try {
      await api.post(`/proxmox/${node}/${type}/${vmid}/${action}`)
      setActionMsg({ type: 'success', text: `${action} sent to ${vmid}` })
      setTimeout(load, 2000)
    } catch (err) {
      setActionMsg({ type: 'error', text: err.response?.data?.error || 'Action failed' })
    }
    setTimeout(() => setActionMsg(null), 4000)
  }

  const totalVMs  = data?.nodes?.reduce((a, n) => a + n.vm_count + n.lxc_count, 0) || 0
  const totalRun  = data?.nodes?.reduce((a, n) => a + [...(n.vms||[]),...(n.lxc||[])].filter(v => v.status === 'running').length, 0) || 0

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Proxmox</h1>
          {data?.configured && <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{data.nodes?.length || 0} node{data.nodes?.length !== 1 ? 's' : ''} · {totalVMs} VMs · {totalRun} running</p>}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="w-3.5 h-3.5" /></Button>
          {canManage && <Button variant="secondary" size="sm" onClick={() => setShowConfig(true)}><Settings className="w-3.5 h-3.5" />Configure</Button>}
        </div>
      </div>

      {actionMsg && <AlertBox type={actionMsg.type}>{actionMsg.text}</AlertBox>}

      {loading && <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>}

      {!loading && !data?.configured && (
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-12 text-center">
          <Server className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <p className="text-lg font-medium text-gray-600 dark:text-gray-400">Proxmox not configured</p>
          <p className="text-sm text-gray-400 mt-1 mb-4">Add your Proxmox server URL and API token to get started.</p>
          {canManage && <Button onClick={() => setShowConfig(true)}><Settings className="w-4 h-4" />Configure Proxmox</Button>}
        </div>
      )}

      {!loading && error && data?.configured && (
        <AlertBox type="error">{error}</AlertBox>
      )}

      {!loading && data?.configured && data.nodes?.length > 0 && (
        <div className="space-y-4">
          {data.nodes.map(node => <NodeCard key={node.node} node={node} onAction={handleAction} canManage={canManage} />)}
        </div>
      )}

      {showConfig && <ConfigModal config={config} onSave={() => { setShowConfig(false); loadConfig(); load() }} onClose={() => setShowConfig(false)} />}
    </div>
  )
}
