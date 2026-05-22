import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Trash2, RefreshCw, CheckCircle, XCircle, Globe, Server, Key, Settings, AlertCircle } from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { Card, Button, Modal, Input, Select, Table, Th, Td, Badge, Empty, Spinner, AlertBox } from '../components/shared/UI'
import { cn, formatDate } from '../lib/utils'

const DNS_TYPES = [
  { value: 'technitium',  label: 'Technitium DNS' },
  { value: 'pihole',      label: 'Pi-hole' },
  { value: 'adguard',     label: 'AdGuard Home' },
  { value: 'bind9',       label: 'BIND9' },
  { value: 'windows_dns', label: 'Windows Server DNS' },
  { value: 'other',       label: 'Other' },
]

// ── Helpers ───────────────────────────────────────────────────────────────────
const Ok  = () => <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
const Nok = () => <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />

function RecordBadge({ label, value }) {
  return value
    ? <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 px-2 py-0.5 rounded font-medium">
        <CheckCircle className="w-3 h-3" />{label}
      </span>
    : <span className="inline-flex items-center gap-1 text-xs bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 px-2 py-0.5 rounded font-medium">
        <XCircle className="w-3 h-3" />{label}
      </span>
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
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className={cn('text-xs font-semibold px-2 py-0.5 rounded uppercase tracking-wide',
              server.role === 'primary'
                ? 'bg-brand/10 text-brand dark:text-brand-light'
                : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400')}>
              {server.role}
            </span>
            <span className="text-sm font-medium text-gray-900 dark:text-white">{server.label || typeLabel}</span>
          </div>
          <p className="text-sm font-mono text-gray-500">{server.ip}</p>
          <p className="text-xs text-gray-400 mt-0.5">{typeLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          {status
            ? status.online
              ? <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400"><CheckCircle className="w-4 h-4" /><span className="text-xs font-medium">Online</span></div>
              : <div className="flex items-center gap-1.5 text-red-500"><XCircle className="w-4 h-4" /><span className="text-xs font-medium">Offline</span></div>
            : <span className="text-xs text-gray-400">—</span>
          }
          <button onClick={check} disabled={checking} className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors">
            <RefreshCw className={cn('w-3.5 h-3.5', checking && 'animate-spin')} />
          </button>
        </div>
      </div>

      {status?.stats && (
        <div className="grid grid-cols-3 gap-2 pt-3 border-t border-gray-100 dark:border-gray-800">
          {[
            { label: 'Queries', value: status.stats.totalQueries?.toLocaleString() },
            { label: 'Blocked', value: status.stats.totalBlocked?.toLocaleString() },
            { label: 'Clients', value: status.stats.totalClients?.toLocaleString() },
          ].map(s => (
            <div key={s.label} className="text-center">
              <p className="text-sm font-bold text-gray-900 dark:text-white">{s.value ?? '—'}</p>
              <p className="text-xs text-gray-400">{s.label}</p>
            </div>
          ))}
        </div>
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
  const isEdit = !!initial?.id
  const [form, setForm] = useState(initial || { role: 'primary', type: 'technitium', ip: '', api_key: '', label: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true)
    try { await api.post('/dns/local', form); onSave() }
    catch (err) { setError(err.response?.data?.error || 'Error saving DNS server') }
    finally { setLoading(false) }
  }

  return (
    <form onSubmit={submit} autoComplete="off" className="space-y-4">
      {error && <AlertBox type="error">{error}</AlertBox>}
      <Select label="Role" value={form.role} onChange={f('role')}>
        <option value="primary">Primary DNS</option>
        <option value="backup">Backup DNS</option>
      </Select>
      <Select label="DNS server type" value={form.type} onChange={f('type')}>
        {DNS_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
      </Select>
      <Input label="IP address or URL *" autoComplete="off" value={form.ip} onChange={f('ip')}
        placeholder="192.168.1.53 or http://192.168.1.53:5380" required />
      <Input label="Label (optional)" autoComplete="off" value={form.label} onChange={f('label')} placeholder="e.g. Home DNS" />
      {['technitium','pihole','adguard'].includes(form.type) && (
        <Input label="API key / password (for stats)" type="password" autoComplete="new-password"
          value={form.api_key} onChange={f('api_key')} placeholder={isEdit ? '(blank = keep current)' : ''} />
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
  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800/50">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-brand" />
          <span className="font-medium text-gray-900 dark:text-white">{zone.domain}</span>
          {zone.status && <span className={cn('text-xs px-1.5 py-0.5 rounded',
            zone.status === 'active' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-500'
          )}>{zone.status}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <RecordBadge label="SPF"   value={zone.spf} />
          <RecordBadge label="DKIM"  value={zone.dkim} />
          <RecordBadge label="DMARC" value={zone.dmarc} />
          <RecordBadge label="MX"    value={zone.mx?.length > 0} />
        </div>
      </div>
      {(zone.spf || zone.dmarc || zone.dkim || zone.mx?.length > 0) && (
        <div className="px-4 py-3 space-y-2 text-xs">
          {zone.spf && (
            <div className="flex items-start gap-2">
              <span className="text-gray-400 w-12 flex-shrink-0">SPF</span>
              <span className="font-mono text-gray-600 dark:text-gray-400 break-all">{zone.spf}</span>
            </div>
          )}
          {zone.dmarc && (
            <div className="flex items-start gap-2">
              <span className="text-gray-400 w-12 flex-shrink-0">DMARC</span>
              <span className="font-mono text-gray-600 dark:text-gray-400 break-all">{zone.dmarc}</span>
            </div>
          )}
          {zone.dkim && (
            <div className="flex items-start gap-2">
              <span className="text-gray-400 w-12 flex-shrink-0">DKIM</span>
              <span className="font-mono text-gray-600 dark:text-gray-400">selector: <strong>{zone.dkim.selector}</strong></span>
            </div>
          )}
          {zone.mx?.length > 0 && (
            <div className="flex items-start gap-2">
              <span className="text-gray-400 w-12 flex-shrink-0">MX</span>
              <div className="font-mono text-gray-600 dark:text-gray-400">
                {zone.mx.slice(0,3).map((m,i) => <div key={i}>{m.priority} {m.exchange || m}</div>)}
              </div>
            </div>
          )}
          {zone.checked_at && <p className="text-gray-400 pt-1">Checked: {formatDate(zone.checked_at)}</p>}
        </div>
      )}
    </div>
  )
}

// ── Cloudflare section ────────────────────────────────────────────────────────
function CloudflareSection({ canEdit }) {
  const [config,    setConfig]    = useState(null)
  const [zones,     setZones]     = useState([])
  const [loading,   setLoading]   = useState(false)
  const [showSetup, setShowSetup] = useState(false)
  const [token,     setToken]     = useState('')
  const [zoneId,    setZoneId]    = useState('')
  const [saving,    setSaving]    = useState(false)
  const [error,     setError]     = useState('')

  const autoRefreshRef = useRef(null)

  const loadConfig = useCallback(() => {
    api.get('/dns/cloudflare/config').then(r => setConfig(r.data)).catch(() => {})
  }, [])

  useEffect(() => { loadConfig() }, [loadConfig])

  // Auto-refresh zones every 90 seconds when configured
  useEffect(() => {
    if (!config?.configured || zones.length === 0) return
    autoRefreshRef.current = setInterval(() => {
      api.get('/dns/cloudflare/zones')
        .then(r => setZones(r.data))
        .catch(() => {})
    }, 90000)
    return () => clearInterval(autoRefreshRef.current)
  }, [config?.configured, zones.length])

  const saveConfig = async (e) => {
    e.preventDefault(); setSaving(true); setError('')
    try {
      await api.post('/dns/cloudflare/config', { token: token || undefined, zone_id: zoneId })
      setToken(''); setShowSetup(false); loadConfig()
    } catch (err) { setError(err.response?.data?.error || 'Error saving config') }
    finally { setSaving(false) }
  }

  const fetchZones = async (silent = false) => {
    if (!silent) { setLoading(true); setError('') }
    try {
      const r = await api.get('/dns/cloudflare/zones')
      setZones(r.data)
    } catch (err) {
      if (!silent) setError(err.response?.data?.error || 'Failed to fetch zones')
    }
    finally { if (!silent) setLoading(false) }
  }

  return (
    <div className="space-y-4">
      {/* Config bar */}
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={cn('w-2.5 h-2.5 rounded-full', config?.configured ? 'bg-green-500' : 'bg-gray-300')} />
            <div>
              <p className="text-sm font-medium text-gray-900 dark:text-white">Cloudflare API</p>
              <p className="text-xs text-gray-400">{config?.configured ? 'Token configured' : 'Not configured'}</p>
            </div>
          </div>
          <div className="flex gap-2">
            {config?.configured && (
              <Button size="sm" variant="secondary" loading={loading} onClick={fetchZones}>
                <RefreshCw className="w-3.5 h-3.5" />Fetch zones
              </Button>
            )}
            {canEdit && (
              <Button size="sm" variant="secondary" onClick={() => setShowSetup(s => !s)}>
                <Settings className="w-3.5 h-3.5" />{config?.configured ? 'Update token' : 'Configure'}
              </Button>
            )}
          </div>
        </div>

        {showSetup && (
          <form onSubmit={saveConfig} autoComplete="off" className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800 space-y-3">
            {error && <AlertBox type="error">{error}</AlertBox>}
            <Input label="Cloudflare API Token (with Zone:Read permission)" type="password" autoComplete="new-password"
              value={token} onChange={e => setToken(e.target.value)}
              placeholder={config?.configured ? '(blank = keep current token)' : 'Paste API token...'} />
            <Input label="Zone ID (optional — leave blank to fetch all zones)" autoComplete="off"
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

      {loading && <div className="flex justify-center py-8"><Spinner className="w-6 h-6" /></div>}

      {zones.length > 0 && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{zones.length} zone{zones.length !== 1 ? 's' : ''}</p>
          {zones.map(z => <ZoneCard key={z.zone_id} zone={z} />)}
        </div>
      )}

      {!loading && !config?.configured && !showSetup && (
        <Empty icon={Globe} title="Cloudflare not configured"
          description={canEdit ? "Add your Cloudflare API token to see DNS records and email security status for all your zones." : "Cloudflare integration not configured."} />
      )}
    </div>
  )
}

// ── Manual domains section ────────────────────────────────────────────────────
function ManualDomainsSection({ canEdit }) {
  const [domains,      setDomains]      = useState([])
  const [loading,      setLoading]      = useState(true)
  const [checking,     setChecking]     = useState(false)
  const [results,      setResults]      = useState([])
  const [domainInput,  setDomainInput]  = useState('')
  const [addingDomain, setAddingDomain] = useState(false)
  const [domainError,  setDomainError]  = useState('')

  const loadDomains = useCallback(() => {
    setLoading(true)
    api.get('/dns/domains').then(r => setDomains(r.data)).catch(() => {}).finally(() => setLoading(false))
  }, [])
  useEffect(() => { loadDomains() }, [loadDomains])

  const addDomain = async (e) => {
    e.preventDefault(); setDomainError('')
    if (!domainInput.trim()) return
    setAddingDomain(true)
    try { await api.post('/dns/domains', { domain: domainInput.trim() }); setDomainInput(''); loadDomains() }
    catch (err) { setDomainError(err.response?.data?.error || 'Error adding domain') }
    finally { setAddingDomain(false) }
  }

  const deleteDomain = async (id) => {
    await api.delete(`/dns/domains/${id}`)
    loadDomains()
  }

  const checkAll = async () => {
    setChecking(true); setResults([])
    try { const r = await api.get('/dns/check-all'); setResults(r.data) }
    catch {} finally { setChecking(false) }
  }

  const checkSingle = async (domain) => {
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

  return (
    <div className="space-y-4">
      {canEdit && (
        <Card className="p-4">
          <form onSubmit={addDomain} autoComplete="off" className="flex gap-3 items-end">
            <div className="flex-1">
              <Input label="Add domain to check" autoComplete="off"
                value={domainInput} onChange={e => setDomainInput(e.target.value)} placeholder="example.com" />
            </div>
            <Button type="submit" loading={addingDomain}>Add</Button>
          </form>
          {domainError && <p className="text-xs text-red-500 mt-2">{domainError}</p>}
        </Card>
      )}

      {loading
        ? <div className="flex justify-center py-6"><Spinner className="w-5 h-5" /></div>
        : domains.length === 0
          ? <Empty icon={Globe} title="No domains" description={canEdit ? "Add a domain above to check its email security records" : "No domains configured"} />
          : (
            <Card>
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-800">
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{domains.length} domain{domains.length !== 1 ? 's' : ''}</p>
                <Button size="sm" variant="secondary" loading={checking} onClick={checkAll}>
                  <RefreshCw className="w-3.5 h-3.5" />Check all
                </Button>
              </div>
              <Table>
                <thead>
                  <tr>
                    <Th>Domain</Th>
                    <Th>Added</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {domains.map(d => (
                    <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <Td><span className="font-mono text-sm">{d.domain}</span></Td>
                      <Td className="text-xs text-gray-400">{formatDate(d.created_at)}</Td>
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => checkSingle(d.domain)} disabled={checking}
                            className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors">
                            <RefreshCw className={cn('w-3.5 h-3.5', checking && 'animate-spin')} />
                          </button>
                          {canEdit && <button onClick={() => deleteDomain(d.id)} className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>}
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
          <p className="text-sm font-medium text-gray-700 dark:text-gray-300">Check results</p>
          {results.map(r => <ZoneCard key={r.domain} zone={r} />)}
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
  const { user } = useAuthStore()
  const canEdit = ['superadmin','admin'].includes(user?.role)

  const loadLocal = useCallback(() => {
    setLoadingLocal(true)
    api.get('/dns/local').then(r => setLocalServers(r.data)).catch(() => {}).finally(() => setLoadingLocal(false))
  }, [])
  useEffect(() => { loadLocal() }, [loadLocal])

  const deleteLocal = async (id) => {
    await api.delete(`/dns/local/${id}`)
    loadLocal(); setDelTarget(null)
  }

  const primary = localServers.find(s => s.role === 'primary')
  const backup  = localServers.find(s => s.role === 'backup')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">DNS</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Local DNS servers and external domain health</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700">
        {[
          { key: 'local',     label: 'Local DNS',     icon: Server },
          { key: 'cloudflare',label: 'Cloudflare DNS',icon: Globe  },
          { key: 'external',  label: 'Manual check',  icon: Key    },
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
      {tab === 'cloudflare' && <CloudflareSection canEdit={canEdit} />}

      {/* MANUAL CHECK */}
      {tab === 'external' && <ManualDomainsSection canEdit={canEdit} />}

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
          Remove <strong>{delTarget?.label || delTarget?.ip}</strong> ({delTarget?.role} DNS)?
        </p>
        <div className="flex gap-3">
          <Button variant="danger" onClick={() => deleteLocal(delTarget.id)}>Remove</Button>
          <Button variant="secondary" onClick={() => setDelTarget(null)}>Cancel</Button>
        </div>
      </Modal>
    </div>
  )
}
