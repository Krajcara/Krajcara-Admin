import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Plus, Trash2, RefreshCw, CheckCircle, XCircle,
  Globe, Server, Key, Settings, BarChart2, Users, ShieldCheck, Search
} from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { Card, Button, Modal, Input, Select, Table, Th, Td, Empty, Spinner, AlertBox } from '../components/shared/UI'
import { cn, formatDate } from '../lib/utils'

const DNS_TYPES = [
  { value: 'technitium',  label: 'Technitium DNS' },
  { value: 'pihole',      label: 'Pi-hole' },
  { value: 'adguard',     label: 'AdGuard Home' },
  { value: 'bind9',       label: 'BIND9' },
  { value: 'windows_dns', label: 'Windows Server DNS' },
  { value: 'other',       label: 'Other' },
]

const REFRESH_OPTS = [
  { label: '1 min',  value: 1  },
  { label: '5 min',  value: 5  },
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
]

// ── Record badge ──────────────────────────────────────────────────────────────
function RecordBadge({ value, label }) {
  return value
    ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800 font-medium">
        <CheckCircle className="w-2.5 h-2.5" />{label}
      </span>
    : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border border-red-200 dark:border-red-800 font-medium">
        <XCircle className="w-2.5 h-2.5" />No {label}
      </span>
}

// ── Local DNS stats (Technitium/Pihole) ──────────────────────────────────────
function LocalDnsStats({ serverId, type }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.get(`/dns/local/${serverId}/status`)
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [serverId])

  if (loading) return <div className="flex justify-center py-3"><Spinner className="w-4 h-4" /></div>
  if (!data?.online || !data?.stats) return null

  const s = data.stats
  return (
    <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-800">
      <p className="text-xs font-semibold text-gray-400 uppercase mb-2 flex items-center gap-1">
        <BarChart2 className="w-3.5 h-3.5" /> Stats — last hour
      </p>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label:'Queries',  value: s.totalQueries?.toLocaleString(),  color:'text-blue-600 dark:text-blue-400' },
          { label:'Blocked',  value: s.totalBlocked?.toLocaleString(),  color:'text-red-600 dark:text-red-400' },
          { label:'Clients',  value: s.totalClients?.toLocaleString(),  color:'text-purple-600 dark:text-purple-400' },
        ].map(stat => (
          <div key={stat.label} className="text-center bg-gray-50 dark:bg-gray-800/50 rounded-lg py-2">
            <p className={cn('text-lg font-bold', stat.color)}>{stat.value ?? '—'}</p>
            <p className="text-xs text-gray-400">{stat.label}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Local DNS server card ─────────────────────────────────────────────────────
function LocalDnsCard({ server, onEdit, onDelete, canEdit }) {
  const [status,   setStatus]   = useState(null)
  const [checking, setChecking] = useState(false)

  const check = useCallback(async () => {
    setChecking(true)
    try { const r = await api.get(`/dns/local/${server.id}/status`); setStatus(r.data) }
    catch { setStatus({ online: false }) }
    finally { setChecking(false) }
  }, [server.id])

  useEffect(() => { check() }, [check])

  const typeLabel = DNS_TYPES.find(t => t.value === server.type)?.label || server.type

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={cn('text-xs font-semibold px-2 py-0.5 rounded uppercase tracking-wide',
              server.role === 'primary' ? 'bg-brand/10 text-brand' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400')}>
              {server.role}
            </span>
            <span className="text-sm font-medium text-gray-900 dark:text-white">{server.label || typeLabel}</span>
          </div>
          <p className="text-xs font-mono text-gray-500">{server.ip}</p>
          <p className="text-xs text-gray-400 mt-0.5">{typeLabel}</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          {status
            ? status.online
              ? <div className="flex items-center gap-1 text-green-600 dark:text-green-400"><CheckCircle className="w-4 h-4" /><span className="text-xs font-medium">Online</span></div>
              : <div className="flex items-center gap-1 text-red-500"><XCircle className="w-4 h-4" /><span className="text-xs font-medium">Offline</span></div>
            : <span className="text-xs text-gray-400">—</span>
          }
          <button onClick={check} disabled={checking} className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors">
            <RefreshCw className={cn('w-3.5 h-3.5', checking && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Stats for Technitium and Pi-hole */}
      {status?.online && ['technitium','pihole','adguard'].includes(server.type) && (
        <LocalDnsStats serverId={server.id} type={server.type} />
      )}

      {canEdit && (
        <div className="flex gap-3 mt-3 pt-3 border-t border-gray-100 dark:border-gray-800 text-xs">
          <button onClick={onEdit} className="text-gray-400 hover:text-brand transition-colors">Edit</button>
          <span className="text-gray-200 dark:text-gray-700">·</span>
          <button onClick={onDelete} className="text-gray-400 hover:text-red-500 transition-colors">Remove</button>
        </div>
      )}
    </Card>
  )
}

function LocalDnsForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(initial || { role: 'primary', type: 'technitium', ip: '', api_key: '', label: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true)
    try { await api.post('/dns/local', form); onSave() }
    catch (err) { setError(err.response?.data?.error || 'Error saving') }
    finally { setLoading(false) }
  }

  return (
    <form onSubmit={submit} autoComplete="off" className="space-y-4">
      {error && <AlertBox type="error">{error}</AlertBox>}
      <Select label="Role" value={form.role} onChange={f('role')}>
        <option value="primary">Primary DNS</option>
        <option value="backup">Backup DNS</option>
      </Select>
      <Select label="Type" value={form.type} onChange={f('type')}>
        {DNS_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </Select>
      <Input label="IP / URL *" autoComplete="off" value={form.ip} onChange={f('ip')}
        placeholder="192.168.1.53 or http://192.168.1.53:5380" required />
      <Input label="Label (optional)" autoComplete="off" value={form.label} onChange={f('label')} placeholder="e.g. Home DNS" />
      {['technitium','pihole','adguard'].includes(form.type) && (
        <Input label="API key / password" type="password" autoComplete="new-password"
          value={form.api_key} onChange={f('api_key')}
          placeholder={initial?.id ? '(blank = keep current)' : ''} />
      )}
      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={loading}>Save</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

// ── Cloudflare zone card ──────────────────────────────────────────────────────
function ZoneCard({ zone }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800/50">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-brand flex-shrink-0" />
          <span className="font-medium text-gray-900 dark:text-white font-mono">{zone.domain}</span>
          {zone.status && (
            <span className={cn('text-xs px-1.5 py-0.5 rounded',
              zone.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-500')}>
              {zone.status}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <RecordBadge value={zone.spf}            label="SPF"   />
          <RecordBadge value={zone.dkim}           label="DKIM"  />
          <RecordBadge value={zone.dmarc}          label="DMARC" />
          <RecordBadge value={zone.mx?.length > 0} label="MX"    />
          <button onClick={() => setOpen(s => !s)} className="p-1 text-gray-400 hover:text-brand rounded transition-colors ml-1">
            {open ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>
      {open && (
        <div className="px-4 py-3 space-y-2 text-xs border-t border-gray-100 dark:border-gray-800">
          {zone.spf && (
            <div>
              <span className="font-semibold text-green-600 mr-2">SPF</span>
              <code className="text-gray-500 dark:text-gray-400 break-all">{zone.spf}</code>
            </div>
          )}
          {!zone.spf && <p className="text-red-500">⚠ No SPF record found</p>}
          {zone.dmarc && (
            <div>
              <span className="font-semibold text-green-600 mr-2">DMARC</span>
              <code className="text-gray-500 dark:text-gray-400 break-all">{zone.dmarc}</code>
            </div>
          )}
          {!zone.dmarc && <p className="text-red-500">⚠ No DMARC record found</p>}
          {zone.dkim && (
            <div>
              <span className="font-semibold text-green-600 mr-2">DKIM</span>
              <span className="text-gray-500">selector: <strong>{zone.dkim.selector}</strong></span>
            </div>
          )}
          {!zone.dkim && <p className="text-orange-500">⚠ No DKIM found (checked common selectors)</p>}
          {zone.mx?.length > 0 && (
            <div>
              <span className="font-semibold text-blue-600 mr-2">MX</span>
              {zone.mx.slice(0,3).map((m,i) => (
                <span key={i} className="font-mono text-gray-500 mr-3">{m.priority} {m.exchange || m}</span>
              ))}
            </div>
          )}
          {zone.checked_at && <p className="text-gray-400 pt-1">Checked: {formatDate(zone.checked_at)}</p>}
        </div>
      )}
    </div>
  )
}

// ── Cloudflare section ────────────────────────────────────────────────────────
function CloudflareSection({ canEdit, refreshMin }) {
  const [config,    setConfig]    = useState(null)
  const [zones,     setZones]     = useState([])
  const [loading,   setLoading]   = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [token,     setToken]     = useState('')
  const [zoneId,    setZoneId]    = useState('')
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')
  const intervalRef = useRef(null)

  const loadConfig = useCallback(() => {
    api.get('/dns/cloudflare/config').then(r => setConfig(r.data)).catch(() => {})
  }, [])

  const fetchZones = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const r = await api.get('/dns/cloudflare/zones')
      setZones(r.data)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to fetch zones')
    } finally { setLoading(false) }
  }, [])

  // Load config on mount
  useEffect(() => { loadConfig() }, [loadConfig])

  // When config is confirmed → auto-fetch zones immediately + set interval
  useEffect(() => {
    clearInterval(intervalRef.current)
    if (!config?.configured) return
    fetchZones()
    intervalRef.current = setInterval(fetchZones, refreshMin * 60 * 1000)
    return () => clearInterval(intervalRef.current)
  }, [config?.configured, refreshMin, fetchZones])

  const saveConfig = async (e) => {
    e.preventDefault(); setSaving(true); setError('')
    try {
      await api.post('/dns/cloudflare/config', { token: token || undefined, zone_id: zoneId })
      setToken(''); setShowSetup(false); loadConfig()
    } catch (err) { setError(err.response?.data?.error || 'Error saving') }
    finally { setSaving(false) }
  }

  if (!config?.configured && !showSetup) {
    return (
      <div className="space-y-4">
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-8 text-center">
          <Globe className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-sm font-medium text-gray-600 dark:text-gray-400">Cloudflare not configured</p>
          <p className="text-xs text-gray-400 mt-1 mb-4">Add your Cloudflare API token to see DNS and email security records for all zones.</p>
          {canEdit && <Button size="sm" onClick={() => setShowSetup(true)}><Key className="w-3.5 h-3.5" />Configure Cloudflare</Button>}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header bar */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn('w-2.5 h-2.5 rounded-full', config?.configured ? 'bg-green-500' : 'bg-gray-300')} />
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Cloudflare API</p>
              <p className="text-xs text-gray-400">{config?.configured ? 'Token configured — zones refresh every ' + refreshMin + ' min' : 'Not configured'}</p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" loading={loading} onClick={fetchZones}>
              <RefreshCw className="w-3.5 h-3.5" />Refresh now
            </Button>
            {canEdit && (
              <Button size="sm" variant="secondary" onClick={() => setShowSetup(s => !s)}>
                <Settings className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </div>

        {showSetup && canEdit && (
          <form onSubmit={saveConfig} autoComplete="off" className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 space-y-3">
            {error && <AlertBox type="error">{error}</AlertBox>}
            <Input label="API Token (Zone:Read permission)" type="password" autoComplete="new-password"
              value={token} onChange={e => setToken(e.target.value)}
              placeholder={config?.configured ? '(blank = keep current)' : 'Paste API token...'} />
            <Input label="Zone ID (optional — blank = all zones)" autoComplete="off"
              value={zoneId} onChange={e => setZoneId(e.target.value)}
              placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" className="font-mono text-sm" />
            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={saving}><Key className="w-3.5 h-3.5" />Save</Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setShowSetup(false)}>Cancel</Button>
            </div>
          </form>
        )}
      </Card>

      {error && !showSetup && <AlertBox type="error">{error}</AlertBox>}

      {loading && zones.length === 0 && (
        <div className="flex justify-center py-8"><Spinner className="w-6 h-6" /></div>
      )}

      {zones.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
            {zones.length} zone{zones.length !== 1 ? 's' : ''}
          </p>
          {zones.map(z => <ZoneCard key={z.zone_id || z.domain} zone={z} />)}
        </div>
      )}
    </div>
  )
}

// Need ChevronUp/Down for ZoneCard
import { ChevronDown, ChevronUp } from 'lucide-react'

// ── Manual domain check section ───────────────────────────────────────────────
function ManualDomainsSection({ canEdit }) {
  const [domains,     setDomains]     = useState([])
  const [results,     setResults]     = useState([])
  const [loading,     setLoading]     = useState(true)
  const [checking,    setChecking]    = useState(false)
  const [newDomain,   setNewDomain]   = useState('')
  const [domSearch,   setDomSearch]   = useState('')
  const [adding,      setAdding]      = useState(false)
  const [addError,    setAddError]    = useState('')

  const loadDomains = useCallback(() => {
    api.get('/dns/domains').then(r => setDomains(r.data)).catch(() => {}).finally(() => setLoading(false))
  }, [])
  useEffect(() => { loadDomains() }, [loadDomains])

  const addDomain = async (e) => {
    e.preventDefault(); setAddError('')
    if (!newDomain.trim()) return
    setAdding(true)
    try { await api.post('/dns/domains', { domain: newDomain.trim() }); setNewDomain(''); loadDomains() }
    catch (err) { setAddError(err.response?.data?.error || 'Error adding domain') }
    finally { setAdding(false) }
  }

  const checkAll = async () => {
    setChecking(true); setResults([])
    try { const r = await api.get('/dns/check-all'); setResults(r.data) }
    catch {} finally { setChecking(false) }
  }

  const checkOne = async (domain) => {
    setChecking(true)
    try {
      const r = await api.post('/dns/check', { domain })
      setResults(prev => {
        const idx = prev.findIndex(x => x.domain === domain)
        if (idx >= 0) { const n = [...prev]; n[idx] = r.data; return n }
        return [...prev, r.data]
      })
    } catch {} finally { setChecking(false) }
  }

  const filtered = results.filter(r => !domSearch || r.domain.includes(domSearch.toLowerCase()))

  return (
    <div className="space-y-4">
      {canEdit && (
        <Card className="p-4">
          <form onSubmit={addDomain} autoComplete="off" className="flex gap-3 items-end">
            <div className="flex-1">
              <Input label="Add domain" autoComplete="off" value={newDomain} onChange={e => setNewDomain(e.target.value)} placeholder="example.com" />
            </div>
            <Button type="submit" loading={adding}>Add</Button>
          </form>
          {addError && <p className="text-xs text-red-500 mt-2">{addError}</p>}
        </Card>
      )}

      {loading
        ? <div className="flex justify-center py-6"><Spinner className="w-5 h-5" /></div>
        : domains.length === 0
          ? <Empty icon={Globe} title="No domains" description={canEdit ? 'Add a domain above to check SPF, DKIM, DMARC and MX records' : 'No domains configured'} />
          : (
            <Card>
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-800">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{domains.length} domain{domains.length !== 1 ? 's' : ''}</p>
                <Button size="sm" variant="secondary" loading={checking} onClick={checkAll}>
                  <RefreshCw className="w-3.5 h-3.5" />Check all
                </Button>
              </div>
              <Table>
                <thead><tr>
                  <Th>Domain</Th><Th>Added</Th><Th />
                </tr></thead>
                <tbody>
                  {domains.map(d => (
                    <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <Td><span className="font-mono text-sm">{d.domain}</span></Td>
                      <Td className="text-xs text-gray-400">{formatDate(d.created_at)}</Td>
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => checkOne(d.domain)} disabled={checking}
                            className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors">
                            <RefreshCw className={cn('w-3.5 h-3.5', checking && 'animate-spin')} />
                          </button>
                          {canEdit && (
                            <button onClick={async () => { await api.delete(`/dns/domains/${d.id}`); loadDomains() }}
                              className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )
      }

      {results.length > 0 && (
        <div className="space-y-3">
          {domains.length > 3 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input autoComplete="off" placeholder="Filter results..."
                value={domSearch} onChange={e => setDomSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
            </div>
          )}
          {filtered.map(r => <ZoneCard key={r.domain} zone={r} />)}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function DnsPage() {
  const [tab,          setTab]          = useState('local')
  const [localServers, setLocalServers] = useState([])
  const [loadingLocal, setLoadingLocal] = useState(true)
  const [modal,        setModal]        = useState(null)
  const [delTarget,    setDelTarget]    = useState(null)
  const [refreshMin,   setRefreshMin]   = useState(5)
  const { user } = useAuthStore()
  const canEdit = ['superadmin','admin'].includes(user?.role)

  const loadLocal = useCallback(() => {
    setLoadingLocal(true)
    api.get('/dns/local').then(r => setLocalServers(r.data)).catch(() => {}).finally(() => setLoadingLocal(false))
  }, [])
  useEffect(() => { loadLocal() }, [loadLocal])

  const primary = localServers.find(s => s.role === 'primary')
  const backup  = localServers.find(s => s.role === 'backup')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">DNS</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Local DNS servers and domain security records</p>
        </div>
        {/* Refresh interval — relevant for cloudflare and local tabs */}
        <select
          value={refreshMin}
          onChange={e => setRefreshMin(parseInt(e.target.value))}
          className="text-xs px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-brand"
        >
          {REFRESH_OPTS.map(o => <option key={o.value} value={o.value}>Refresh: {o.label}</option>)}
        </select>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700">
        {[
          { key: 'local',      label: 'Local DNS',      icon: Server },
          { key: 'cloudflare', label: 'Cloudflare DNS', icon: Globe  },
          { key: 'manual',     label: 'Manual check',   icon: Key    },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn('flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.key ? 'border-brand text-brand dark:text-brand-light' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300')}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>

      {/* LOCAL DNS */}
      {tab === 'local' && (
        loadingLocal
          ? <div className="flex justify-center py-12"><Spinner className="w-6 h-6" /></div>
          : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {primary
                ? <LocalDnsCard server={primary} canEdit={canEdit} onEdit={() => setModal(primary)} onDelete={() => setDelTarget(primary)} />
                : canEdit && (
                  <button onClick={() => setModal({ role: 'primary' })}
                    className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-8 text-center hover:border-brand transition-colors">
                    <Server className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                    <p className="text-sm font-medium text-gray-500">Add Primary DNS</p>
                  </button>
                )
              }
              {backup
                ? <LocalDnsCard server={backup} canEdit={canEdit} onEdit={() => setModal(backup)} onDelete={() => setDelTarget(backup)} />
                : canEdit && (
                  <button onClick={() => setModal({ role: 'backup' })}
                    className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-8 text-center hover:border-brand transition-colors">
                    <Server className="w-8 h-8 text-gray-300 dark:text-gray-600 mx-auto mb-2" />
                    <p className="text-sm font-medium text-gray-500">Add Backup DNS</p>
                  </button>
                )
              }
              {!primary && !backup && !canEdit && (
                <div className="col-span-2"><Empty icon={Server} title="No local DNS configured" /></div>
              )}
            </div>
          )
      )}

      {/* CLOUDFLARE */}
      {tab === 'cloudflare' && <CloudflareSection canEdit={canEdit} refreshMin={refreshMin} />}

      {/* MANUAL */}
      {tab === 'manual' && <ManualDomainsSection canEdit={canEdit} />}

      {/* Modals */}
      {modal !== null && (
        <Modal open onClose={() => setModal(null)}
          title={modal?.id ? `Edit — ${modal.label || modal.ip}` : `Add ${modal?.role === 'backup' ? 'Backup' : 'Primary'} DNS`}
          size="sm">
          <LocalDnsForm
            initial={modal?.id ? modal : { role: modal?.role || 'primary', type: 'technitium', ip: '', api_key: '', label: '' }}
            onSave={() => { setModal(null); loadLocal() }}
            onCancel={() => setModal(null)}
          />
        </Modal>
      )}
      <Modal open={!!delTarget} onClose={() => setDelTarget(null)} title="Remove DNS server" size="sm">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Remove <strong>{delTarget?.label || delTarget?.ip}</strong> ({delTarget?.role})?
        </p>
        <div className="flex gap-3">
          <Button variant="danger" onClick={async () => { await api.delete(`/dns/local/${delTarget.id}`); setDelTarget(null); loadLocal() }}>Remove</Button>
          <Button variant="secondary" onClick={() => setDelTarget(null)}>Cancel</Button>
        </div>
      </Modal>
    </div>
  )
}
