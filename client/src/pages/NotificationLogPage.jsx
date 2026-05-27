import { useState, useEffect, useCallback } from 'react'
import { Bell, AlertCircle, AlertTriangle, CheckCircle, Info, Search, RefreshCw, Trash2, Archive } from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { Card, Button, Badge, Spinner, AlertBox } from '../components/shared/UI'
import { cn, timeAgo } from '../lib/utils'

const TYPE_ICON = {
  error:   <AlertCircle   className="w-4 h-4 text-red-500 flex-shrink-0" />,
  warning: <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0" />,
  success: <CheckCircle   className="w-4 h-4 text-green-500 flex-shrink-0" />,
  info:    <Info          className="w-4 h-4 text-blue-500 flex-shrink-0" />,
}
const TYPE_BG = {
  error:   'border-l-red-500',
  warning: 'border-l-yellow-500',
  success: 'border-l-green-500',
  info:    'border-l-blue-500',
}
const TYPE_BADGE = {
  error:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  warning: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  success: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  info:    'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
}

const MODULES = ['monitors','proxmox','routers','dns','entra','licences','backup']

export default function NotificationLogPage() {
  const [data,     setData]     = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [type,     setType]     = useState('')
  const [module,   setModule]   = useState('')
  const [search,   setSearch]   = useState('')
  const [purging,  setPurging]  = useState(false)
  const [msg,      setMsg]      = useState(null)
  const { user } = useAuthStore()
  const canAdmin = ['superadmin', 'admin'].includes(user?.role)

  const load = useCallback(() => {
    setLoading(true)
    const q = new URLSearchParams({ limit: '200' })
    if (type)   q.set('type', type)
    if (module) q.set('module', module)
    if (search) q.set('search', search)
    api.get(`/notifications/log?${q}`)
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [type, module, search])

  useEffect(() => { load() }, [load])

  const purgeArchived = async () => {
    if (!confirm('Permanently delete all archived notifications?')) return
    setPurging(true)
    try {
      const r = await api.delete('/notifications/purge-archived')
      setMsg({ type: 'success', text: `Deleted ${r.data.deleted} archived notifications` })
      load()
    } catch { setMsg({ type: 'error', text: 'Failed to purge' }) }
    finally { setPurging(false) }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Notification Log</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Full history of all notifications</p>
        </div>
        {canAdmin && (
          <Button variant="danger" size="sm" loading={purging} onClick={purgeArchived}>
            <Trash2 className="w-4 h-4" />Purge archived
          </Button>
        )}
      </div>

      {msg && <AlertBox type={msg.type}>{msg.text}</AlertBox>}

      {/* Stats */}
      {data?.stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: 'Total',    value: data.stats.total,    color: 'text-gray-900 dark:text-white' },
            { label: 'Active',   value: data.stats.active,   color: 'text-blue-600 dark:text-blue-400' },
            { label: 'Archived', value: data.stats.archived, color: 'text-gray-400' },
            { label: 'Errors',   value: data.stats.errors,   color: 'text-red-600 dark:text-red-400' },
            { label: 'Warnings', value: data.stats.warnings, color: 'text-yellow-600 dark:text-yellow-400' },
          ].map(s => (
            <Card key={s.label} className="p-3 text-center">
              <p className={cn('text-2xl font-bold', s.color)}>{s.value}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </Card>
          ))}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input autoComplete="off" placeholder="Search..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
        </div>
        <select value={type} onChange={e => setType(e.target.value)}
          className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand">
          <option value="">All types</option>
          {['error','warning','success','info'].map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={module} onChange={e => setModule(e.target.value)}
          className="text-sm px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand">
          <option value="">All modules</option>
          {MODULES.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <button onClick={load} className="p-2 text-gray-400 hover:text-brand rounded-lg transition-colors">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {/* List */}
      <Card>
        {loading ? (
          <div className="flex justify-center py-12"><Spinner className="w-6 h-6" /></div>
        ) : !data?.notifications?.length ? (
          <div className="text-center py-12">
            <Bell className="w-10 h-10 mx-auto mb-2 text-gray-300 dark:text-gray-700" />
            <p className="text-gray-500">No notifications found</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {data.notifications.map(n => (
              <div key={n.id} className={cn(
                'flex items-start gap-3 px-5 py-3.5 border-l-2',
                TYPE_BG[n.type] || 'border-l-gray-300',
                n.archived ? 'opacity-40' : '',
              )}>
                {TYPE_ICON[n.type] || TYPE_ICON.info}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{n.title}</p>
                    <Badge className={cn('text-xs', TYPE_BADGE[n.type])}>{n.type}</Badge>
                    <Badge className="text-xs bg-gray-100 text-gray-500 dark:bg-gray-800">{n.module}</Badge>
                    {n.archived === 1 && <Badge className="text-xs bg-gray-100 text-gray-400 dark:bg-gray-800"><Archive className="w-3 h-3 inline mr-0.5" />archived</Badge>}
                    {n.read === 0 && n.archived === 0 && <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />}
                  </div>
                  {n.message && <p className="text-xs text-gray-500 mt-0.5">{n.message}</p>}
                </div>
                <p className="text-xs text-gray-400 flex-shrink-0">{timeAgo(n.created_at)}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
