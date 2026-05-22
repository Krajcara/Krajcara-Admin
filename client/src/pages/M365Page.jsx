import { useState, useEffect, useCallback } from 'react'
import {
  Users, Shield, ShieldCheck, ShieldOff, RefreshCw,
  Settings, CheckCircle, AlertCircle, XCircle, Search,
  ChevronDown, ChevronUp, UserX, Mail, Crown, Key
} from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Modal, AlertBox, Spinner, Badge, StatCard } from '../components/shared/UI'
import { cn } from '../lib/utils'

// ── Config modal ──────────────────────────────────────────────────────────────
function ConfigModal({ config, onSave, onClose }) {
  const [form, setForm] = useState({
    tenant_id:     config?.tenant_id || '',
    client_id:     '',
    client_secret: '',
  })
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true)
    try { await api.post('/m365/config', form); onSave() }
    catch (err) { setError(err.response?.data?.error || 'Error saving config') }
    finally { setLoading(false) }
  }

  return (
    <Modal open onClose={onClose} title="Microsoft 365 configuration" size="md">
      <form onSubmit={submit} autoComplete="off" className="space-y-4">
        {error && <AlertBox type="error">{error}</AlertBox>}
        <AlertBox type="info">
          Create an App Registration in <strong>Entra ID → App registrations</strong>.
          Grant these API permissions (Application type):
          <ul className="mt-1 ml-4 list-disc text-xs space-y-0.5">
            <li>User.Read.All</li>
            <li>Directory.Read.All</li>
            <li>Organization.Read.All</li>
            <li>Reports.Read.All</li>
            <li>ServiceHealth.Read.All</li>
            <li>UserAuthenticationMethod.Read.All</li>
          </ul>
        </AlertBox>
        <Input label="Tenant ID *" autoComplete="off" value={form.tenant_id} onChange={f('tenant_id')}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className="font-mono text-sm" required />
        <Input label="Client (Application) ID *" autoComplete="off" value={form.client_id} onChange={f('client_id')}
          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className="font-mono text-sm" required />
        <Input label={config?.has_secret ? 'Client Secret (blank = keep current)' : 'Client Secret *'}
          type="password" autoComplete="new-password" value={form.client_secret} onChange={f('client_secret')}
          placeholder={config?.has_secret ? '(saved)' : 'Paste secret value...'} />
        <div className="flex gap-3 pt-2">
          <Button type="submit" loading={loading}>Save</Button>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  )
}

// ── User groups modal ─────────────────────────────────────────────────────────
function UserGroupsModal({ user, onClose }) {
  const [groups,  setGroups]  = useState([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    api.get(`/m365/users/${user.id}/groups`)
      .then(r => setGroups(r.data || []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [user.id])

  return (
    <Modal open onClose={onClose} title={`Groups — ${user.name}`} size="sm">
      {loading ? <div className="flex justify-center py-6"><Spinner className="w-5 h-5" /></div>
        : groups.length === 0 ? <p className="text-sm text-gray-400 py-4 text-center">No groups found</p>
        : <div className="space-y-1.5 max-h-80 overflow-y-auto">
          {groups.map((g, i) => (
            <div key={i} className="px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
              <p className="text-sm font-medium text-gray-900 dark:text-white">{g.displayName}</p>
              {g.description && <p className="text-xs text-gray-400 mt-0.5">{g.description}</p>}
            </div>
          ))}
        </div>
      }
    </Modal>
  )
}

// ── User row ──────────────────────────────────────────────────────────────────
function UserRow({ u, skus, onGroups }) {
  const licNames = (u.assigned_licence_ids || [])
    .map(id => skus?.find(s => s.skuId === id)?.displayName || null)
    .filter(Boolean)

  return (
    <div className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/50">
      <div className={cn('w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0',
        u.enabled ? 'bg-brand/10 text-brand' : 'bg-gray-100 dark:bg-gray-800 text-gray-400')}>
        {(u.name || '?')[0].toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{u.name}</p>
        <p className="text-xs text-gray-400 truncate">{u.email || '—'}</p>
        {licNames.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {licNames.slice(0, 3).map((l, i) => (
              <span key={i} className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">{l}</span>
            ))}
            {licNames.length > 3 && <span className="text-xs text-gray-400">+{licNames.length - 3}</span>}
          </div>
        )}
        {u.admin_roles?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {u.admin_roles.slice(0, 2).map((r, i) => (
              <span key={i} className="text-xs bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300 px-1.5 py-0.5 rounded">{r}</span>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {!u.enabled && <Badge className="bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 text-xs">Disabled</Badge>}
        {u.mfa.registered === true  && <ShieldCheck className="w-4 h-4 text-green-500" title="MFA enabled" />}
        {u.mfa.registered === false && <ShieldOff   className="w-4 h-4 text-red-400"   title="No MFA" />}
        <button onClick={() => onGroups(u)} className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors" title="View groups">
          <Users className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function M365Page() {
  const [config,      setConfig]      = useState(null)
  const [stats,       setStats]       = useState(null)
  const [users,       setUsers]       = useState(null)
  const [skus,        setSkus]        = useState([])
  const [health,      setHealth]      = useState([])
  const [loading,     setLoading]     = useState(true)
  const [error,       setError]       = useState('')
  const [showConfig,  setShowConfig]  = useState(false)
  const [groupsUser,  setGroupsUser]  = useState(null)
  const [activeTab,   setActiveTab]   = useState('overview')
  const [userGroup,   setUserGroup]   = useState('all')
  const [search,      setSearch]      = useState('')
  const { user: me } = useAuthStore()
  const canConfig = ['superadmin', 'admin'].includes(me?.role)

  const loadConfig = useCallback(() => {
    api.get('/m365/config').then(r => setConfig(r.data)).catch(() => {})
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [statsRes, usersRes, skusRes, healthRes] = await Promise.allSettled([
        api.get('/m365/stats'),
        api.get('/m365/users'),
        api.get('/m365/skus'),
        api.get('/m365/service-health'),
      ])
      if (statsRes.status  === 'fulfilled') setStats(statsRes.value.data)
      if (usersRes.status  === 'fulfilled') setUsers(usersRes.value.data)
      if (skusRes.status   === 'fulfilled') setSkus(skusRes.value.data || [])
      if (healthRes.status === 'fulfilled') setHealth(healthRes.value.data || [])
      if (statsRes.status  === 'rejected')  setError(statsRes.reason?.response?.data?.error || statsRes.reason?.message)
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { loadConfig() }, [loadConfig])

  useEffect(() => {
    if (config?.configured) loadAll()
    else setLoading(false)
  }, [config?.configured, loadAll])

  const STATUS_DOT = (status) => {
    if (!status || status === 'serviceOperational') return 'bg-green-500'
    if (status.includes('Degraded') || status.includes('Warning') || status.includes('Advisory')) return 'bg-yellow-500'
    return 'bg-red-500'
  }

  const filteredUsers = () => {
    if (!users) return []
    let list = userGroup === 'all' ? users.users
      : userGroup === 'admins'    ? users.groups.admins
      : userGroup === 'no_mfa'    ? users.groups.no_mfa
      : userGroup === 'disabled'  ? users.groups.disabled
      : userGroup === 'shared'    ? users.groups.shared_mailboxes
      : users.users
    if (search) {
      const q = search.toLowerCase()
      list = list.filter(u => u.name?.toLowerCase().includes(q) || u.email?.toLowerCase().includes(q))
    }
    return list.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
  }

  if (!config) return <div className="flex justify-center py-20"><Spinner className="w-8 h-8" /></div>

  if (!config.configured) return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Microsoft 365</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Microsoft Graph integration</p>
        </div>
      </div>
      <div className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-12 text-center">
        <Shield className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
        <p className="text-lg font-medium text-gray-600 dark:text-gray-400">Microsoft 365 not configured</p>
        <p className="text-sm text-gray-400 mt-1 mb-4">Connect via an Entra ID App Registration to manage users and view service health.</p>
        {canConfig && <Button onClick={() => setShowConfig(true)}><Settings className="w-4 h-4" />Configure M365</Button>}
      </div>
      {showConfig && <ConfigModal config={config} onSave={() => { setShowConfig(false); loadConfig() }} onClose={() => setShowConfig(false)} />}
    </div>
  )

  const issueCount = health.filter(s => s.active_issues > 0).length

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Microsoft 365</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Tenant: {config.tenant_id}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" size="sm" onClick={loadAll} disabled={loading}>
            <RefreshCw className={cn('w-3.5 h-3.5', loading && 'animate-spin')} />
          </Button>
          {canConfig && <Button variant="secondary" size="sm" onClick={() => setShowConfig(true)}><Settings className="w-3.5 h-3.5" /></Button>}
        </div>
      </div>

      {error && <AlertBox type="error">{error}</AlertBox>}

      {loading
        ? <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>
        : (
          <>
            {/* Tabs */}
            <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700">
              {[
                { key: 'overview', label: 'Overview' },
                { key: 'users',    label: `Users${users ? ` (${users.users.length})` : ''}` },
                { key: 'licences', label: 'Licences' },
                { key: 'health',   label: 'Service Health', badge: issueCount },
              ].map(t => (
                <button key={t.key} onClick={() => setActiveTab(t.key)}
                  className={cn('flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
                    activeTab === t.key ? 'border-brand text-brand dark:text-brand-light' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300')}>
                  {t.label}
                  {t.badge > 0 && <span className="bg-yellow-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">{t.badge}</span>}
                </button>
              ))}
            </div>

            {/* OVERVIEW */}
            {activeTab === 'overview' && stats && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard label="Total users"   value={stats.total_users}    icon={Users}       color="blue" />
                  <StatCard label="Active users"  value={stats.active_users}   icon={CheckCircle} color="green" />
                  <StatCard label="Licensed"      value={stats.licensed_users} icon={Key}         color="purple" />
                  <StatCard label="MFA enabled"   value={stats.mfa_enabled}    icon={ShieldCheck} color="yellow"
                    sub={stats.mfa_disabled > 0 ? `${stats.mfa_disabled} without MFA` : 'All users protected'} />
                </div>

                {/* Service health summary */}
                {health.length > 0 && (
                  <Card>
                    <CardHeader><CardTitle>Service health</CardTitle></CardHeader>
                    <div className="divide-y divide-gray-100 dark:divide-gray-800">
                      {health.filter(s => s.active_issues > 0 || health.length <= 10).slice(0, 8).map(s => (
                        <div key={s.service} className="flex items-center gap-3 px-5 py-2.5">
                          <span className={cn('w-2 h-2 rounded-full flex-shrink-0', STATUS_DOT(s.status))} />
                          <span className="text-sm text-gray-900 dark:text-white flex-1">{s.service}</span>
                          {s.active_issues > 0 && (
                            <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 text-xs">
                              {s.active_issues} issue{s.active_issues > 1 ? 's' : ''}
                            </Badge>
                          )}
                        </div>
                      ))}
                    </div>
                  </Card>
                )}
              </div>
            )}

            {/* USERS */}
            {activeTab === 'users' && users && (
              <div className="space-y-4">
                {/* Group filter pills */}
                <div className="flex gap-2 flex-wrap">
                  {[
                    { key: 'all',      label: `All (${users.users.length})` },
                    { key: 'admins',   label: `Admins (${users.groups.admins.length})`,         icon: Crown },
                    { key: 'no_mfa',   label: `No MFA (${users.groups.no_mfa.length})`,         icon: ShieldOff },
                    { key: 'disabled', label: `Disabled (${users.groups.disabled.length})`,     icon: UserX },
                    { key: 'shared',   label: `Shared MB (${users.groups.shared_mailboxes.length})`, icon: Mail },
                  ].map(g => (
                    <button key={g.key} onClick={() => setUserGroup(g.key)}
                      className={cn('flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors',
                        userGroup === g.key ? 'bg-brand text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700')}>
                      {g.icon && <g.icon className="w-3 h-3" />}{g.label}
                    </button>
                  ))}
                </div>

                {/* Search */}
                <div className="relative max-w-xs">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input autoComplete="off" placeholder="Search users..."
                    value={search} onChange={e => setSearch(e.target.value)}
                    className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
                </div>

                <Card>
                  <div className="divide-y divide-gray-100 dark:divide-gray-800">
                    {filteredUsers().length === 0 && (
                      <p className="text-sm text-gray-400 text-center py-8">No users found</p>
                    )}
                    {filteredUsers().map(u => (
                      <UserRow key={u.id} u={u} skus={skus} onGroups={setGroupsUser} />
                    ))}
                  </div>
                </Card>
              </div>
            )}

            {/* LICENCES */}
            {activeTab === 'licences' && (
              <Card>
                {skus.length === 0
                  ? <div className="text-center py-10 text-gray-400">No licences found</div>
                  : <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Licence</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Total</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Used</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Available</th>
                          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase w-36">Usage</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                        {[...skus].sort((a, b) => b.used - a.used).map(s => {
                          const pct = s.total > 0 ? Math.round((s.used / s.total) * 100) : 0
                          const barColor = pct > 90 ? 'bg-red-500' : pct > 75 ? 'bg-yellow-500' : 'bg-brand'
                          return (
                            <tr key={s.skuId} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                              <td className="px-4 py-3">
                                <p className="font-medium text-gray-900 dark:text-white">{s.displayName}</p>
                                <p className="text-xs text-gray-400 font-mono">{s.skuPartNumber}</p>
                              </td>
                              <td className="px-4 py-3 text-gray-600 dark:text-gray-400">{s.total}</td>
                              <td className="px-4 py-3 font-semibold text-gray-900 dark:text-white">{s.used}</td>
                              <td className="px-4 py-3">
                                <span className={cn('font-medium', s.available < 0 ? 'text-red-500' : s.available === 0 ? 'text-yellow-500' : 'text-green-600 dark:text-green-400')}>
                                  {s.available}
                                </span>
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-2">
                                  <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                                    <div className={cn('h-full rounded-full', barColor)} style={{ width: `${Math.min(pct, 100)}%` }} />
                                  </div>
                                  <span className="text-xs text-gray-500 w-8 text-right">{pct}%</span>
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                }
              </Card>
            )}

            {/* HEALTH */}
            {activeTab === 'health' && (
              <Card>
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {health.length === 0 && <p className="text-center py-8 text-gray-400">No health data</p>}
                  {[...health].sort((a, b) => b.active_issues - a.active_issues).map(s => (
                    <div key={s.service} className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', STATUS_DOT(s.status))} />
                        <span className="font-medium text-sm text-gray-900 dark:text-white flex-1">{s.service}</span>
                        {s.active_issues === 0
                          ? <span className="text-xs text-green-600 dark:text-green-400">Operational</span>
                          : <Badge className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300 text-xs">
                              {s.active_issues} issue{s.active_issues > 1 ? 's' : ''}
                            </Badge>
                        }
                      </div>
                      {s.issues?.slice(0, 2).map((issue, i) => (
                        <div key={i} className="mt-2 ml-5.5 pl-3 border-l-2 border-yellow-300 dark:border-yellow-700">
                          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{issue.title}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{issue.impactDescription?.slice(0, 120)}</p>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </>
        )
      }

      {groupsUser && <UserGroupsModal user={groupsUser} onClose={() => setGroupsUser(null)} />}
      {showConfig && <ConfigModal config={config} onSave={() => { setShowConfig(false); loadConfig(); loadAll() }} onClose={() => setShowConfig(false)} />}
    </div>
  )
}
