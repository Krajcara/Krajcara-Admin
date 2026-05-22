import { useState, useEffect, useCallback } from 'react'
import {
  Plus, Trash2, Pencil, Eye, EyeOff, Copy, Check,
  AppWindow, RotateCcw, ShieldCheck, ExternalLink,
  AlertTriangle, Key, Search, ChevronUp, ChevronDown, Key as KeyIcon
} from 'lucide-react'
import api from '../lib/api'
import {
  Card, Button, Modal, Input, Select, Textarea,
  Table, Th, Td, Badge, Empty, Spinner, AlertBox, Toggle
} from '../components/shared/UI'
import { cn, formatDate } from '../lib/utils'

// ── Helpers ───────────────────────────────────────────────────────────────────
const CURRENCIES     = ['EUR', 'USD', 'RSD', 'GBP', 'CHF']
const BILLING_LABELS = { monthly: 'Monthly', annual: 'Annual', perpetual: 'Perpetual' }

function daysUntil(dateStr) {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr) - new Date()) / 86400000)
}

function expiryBadge(dateStr) {
  if (!dateStr) return null
  const days = daysUntil(dateStr)
  if (days < 0)   return { label: 'Expired',       cls: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300' }
  if (days <= 30) return { label: `${days}d left`,  cls: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' }
  return null
}

function formatPrice(val) {
  if (val == null || val === '' || isNaN(Number(val))) return ''
  return Number(val).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function parsePrice(s) {
  if (!s && s !== 0) return ''
  const str = String(s).trim()
  // "1.452,22" → 1452.22 (dot = thousands, comma = decimal)
  if (str.includes('.') && str.includes(',')) return parseFloat(str.replace(/\./g, '').replace(',', '.')) || ''
  // "1452,22" → 1452.22
  if (str.includes(',')) return parseFloat(str.replace(',', '.')) || ''
  return parseFloat(str) || ''
}

// ── Licence form modal ────────────────────────────────────────────────────────
const EMPTY_LIC = {
  vendor: '', licence_type: '', licence_count: 1, licence_used: '',
  purchase_date: '', expiry_date: '', price_per_licence: '',
  currency: 'EUR', billing_cycle: 'annual', tax_percent: '',
  is_free: false, active_users: '', assigned_to: [],
  url: '', licence_username: '', licence_password: '', licence_mfa: false, notes: ''
}

function LicenceModal({ licence, onClose, onSaved }) {
  const isEdit = !!licence?.id
  const [form,     setForm]     = useState(isEdit ? {
    ...EMPTY_LIC, ...licence,
    licence_password: '',
    price_per_licence: licence.price_per_licence != null ? licence.price_per_licence : '',
    active_users: licence.active_users ?? '',
    licence_used: licence.licence_used ?? ''
  } : EMPTY_LIC)
  const [showPass, setShowPass] = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.vendor.trim() || !form.licence_type.trim()) { setError('Vendor and licence name are required'); return }
    setLoading(true)
    try {
      const payload = { ...form, price_per_licence: parsePrice(form.price_per_licence) }
      isEdit ? await api.put(`/licences/${licence.id}`, payload) : await api.post('/licences', payload)
      onSaved()
    } catch (err) {
      setError(err.response?.data?.error || 'Error saving licence')
    } finally { setLoading(false) }
  }

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit — ${licence.vendor}` : 'Add licence'} size="lg">
      <form onSubmit={submit} autoComplete="off" className="space-y-4">
        {error && <AlertBox type="error">{error}</AlertBox>}

        <div className="grid grid-cols-2 gap-4">
          <Input label="Vendor *" autoComplete="off" value={form.vendor} onChange={f('vendor')} placeholder="Microsoft, Adobe..." required />
          <Input label="Licence name *" autoComplete="off" value={form.licence_type} onChange={f('licence_type')} placeholder="Microsoft 365 Business Premium" required />
          <Input label="Total seats" type="number" min="1" autoComplete="off" value={form.licence_count} onChange={f('licence_count')} />
          <Input label="Used seats" type="number" min="0" autoComplete="off"
            value={form.licence_used}
            onChange={f('licence_used')}
            placeholder="0" />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Select label="Billing cycle" value={form.billing_cycle} onChange={f('billing_cycle')}>
            <option value="monthly">Monthly</option>
            <option value="annual">Annual</option>
            <option value="perpetual">Perpetual</option>
          </Select>
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Price / licence</label>
            <input autoComplete="off" placeholder="0,00"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand"
              value={form.price_per_licence === '' ? '' : (form._priceEditing ? form._priceRaw : formatPrice(form.price_per_licence))}
              onFocus={() => setForm(p => ({ ...p, _priceEditing: true, _priceRaw: String(p.price_per_licence ?? '') }))}
              onChange={e => setForm(p => ({ ...p, _priceRaw: e.target.value, price_per_licence: e.target.value }))}
              onBlur={e => setForm(p => ({ ...p, _priceEditing: false, price_per_licence: parsePrice(e.target.value) }))}
            />
          </div>
          <Select label="Currency" value={form.currency} onChange={f('currency')}>
            {CURRENCIES.map(c => <option key={c}>{c}</option>)}
          </Select>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Input label="Tax %" type="number" step="0.1" min="0" max="100" autoComplete="off" value={form.tax_percent} onChange={f('tax_percent')} placeholder="0" />
          <Input label="Purchase date" type="date" autoComplete="off" value={form.purchase_date} onChange={f('purchase_date')} />
          <Input label="Expiry date" type="date" autoComplete="off" value={form.expiry_date} onChange={f('expiry_date')} />
        </div>

        <div className="flex items-center gap-3">
          <Toggle checked={!!form.is_free} onChange={v => setForm(p => ({ ...p, is_free: v }))} label="Free / bonus licence (counts toward savings, not cost)" />
        </div>
        {form.is_free && (
          <Input label="Active users (for savings calculation)" type="number" min="0" autoComplete="off"
            value={form.active_users} onChange={f('active_users')} placeholder="0" />
        )}

        {/* Credentials */}
        <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Access credentials</p>
          <div className="grid grid-cols-1 gap-4">
            <Input label="URL / Portal" autoComplete="off" value={form.url} onChange={f('url')} placeholder="https://portal.office.com" />
            <div className="grid grid-cols-2 gap-4">
              <Input label="Username / email" autoComplete="new-password" value={form.licence_username} onChange={f('licence_username')} placeholder="admin@company.com" />
              <div className="space-y-1">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                  Password{isEdit && ' (blank = keep current)'}
                </label>
                <div className="relative">
                  <input type={showPass ? 'text' : 'password'} autoComplete="new-password"
                    value={form.licence_password}
                    onChange={f('licence_password')}
                    className="w-full px-3 py-2 pr-10 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand"
                  />
                  <button type="button" onClick={() => setShowPass(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            </div>
            <Toggle checked={!!form.licence_mfa} onChange={v => setForm(p => ({ ...p, licence_mfa: v }))} label="MFA enabled on this account" />
          </div>
        </div>

        <Textarea label="Notes" autoComplete="off" rows={2} value={form.notes || ''} onChange={f('notes')} />

        <div className="flex gap-3 pt-2">
          <Button type="submit" loading={loading}>{isEdit ? 'Save changes' : 'Add licence'}</Button>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  )
}

// ── Entra App form modal ──────────────────────────────────────────────────────
const EMPTY_APP = { app_name: '', app_id: '', client_secret: '', secret_expiry: '', assigned_to: '', project: '', notes: '' }

function EntraAppModal({ app, onClose, onSaved }) {
  const isEdit = !!app?.id
  const [form,       setForm]       = useState(isEdit ? { ...EMPTY_APP, ...app, client_secret: '' } : EMPTY_APP)
  const [showSecret, setShowSecret] = useState(false)
  const [revealed,   setRevealed]   = useState(null)
  const [revealing,  setRevealing]  = useState(false)
  const [copied,     setCopied]     = useState(false)
  const [error,      setError]      = useState('')
  const [loading,    setLoading]    = useState(false)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const days = daysUntil(form.secret_expiry)
  const expiryColor = days == null ? '' : days < 0 ? 'text-red-500' : days <= 30 ? 'text-yellow-500' : 'text-green-500'
  const expiryText  = days == null ? '' : days < 0 ? `Expired ${Math.abs(days)} days ago` : days <= 30 ? `Expires in ${days} days` : `OK — expires in ${days} days`

  const reveal = async () => {
    setRevealing(true)
    try {
      const r = await api.post(`/licences/entra-apps/${app.id}/reveal`)
      setRevealed(r.data.secret)
      setShowSecret(true)
    } catch { setError('Could not reveal secret') }
    finally { setRevealing(false) }
  }

  const copySecret = () => {
    const val = revealed || form.client_secret
    if (!val) return
    navigator.clipboard.writeText(val)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!form.app_name.trim()) { setError('App name is required'); return }
    setLoading(true)
    try {
      isEdit ? await api.put(`/licences/entra-apps/${app.id}`, form) : await api.post('/licences/entra-apps', form)
      onSaved()
    } catch (err) {
      setError(err.response?.data?.error || 'Error saving app')
    } finally { setLoading(false) }
  }

  return (
    <Modal open onClose={onClose} title={isEdit ? `Edit — ${app.app_name}` : 'Add Entra ID App'} size="md">
      <form onSubmit={submit} autoComplete="off" className="space-y-4">
        {error && <AlertBox type="error">{error}</AlertBox>}

        <Input label="App name *" autoComplete="off" value={form.app_name} onChange={f('app_name')} placeholder="My App — Production" required autoFocus />
        <Input label="Application (Client) ID" autoComplete="off" value={form.app_id} onChange={f('app_id')} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" className="font-mono text-sm" />

        <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Client secret</p>

          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
              {isEdit ? 'Client secret (blank = keep current)' : 'Client secret'}
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showSecret ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder={isEdit ? '••••••••••••' : 'Paste secret value...'}
                  value={showSecret && revealed ? revealed : form.client_secret}
                  onChange={e => { setRevealed(null); setForm(p => ({ ...p, client_secret: e.target.value })) }}
                  className="w-full px-3 py-2 pr-10 text-sm font-mono rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand"
                />
                <button type="button" onClick={() => setShowSecret(s => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {(revealed || form.client_secret) && (
                <button type="button" onClick={copySecret} className="p-2 text-gray-400 hover:text-brand rounded-lg border border-gray-300 dark:border-gray-600 transition-colors" title="Copy secret">
                  {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
                </button>
              )}
              {isEdit && app.client_secret && (
                <Button type="button" variant="secondary" size="sm" loading={revealing} onClick={reveal}>
                  <Key className="w-3.5 h-3.5" /> Reveal
                </Button>
              )}
            </div>
          </div>

          <div className="mt-4 space-y-1">
            <Input label="Secret expiry date" type="date" autoComplete="off" value={form.secret_expiry} onChange={f('secret_expiry')} />
            {form.secret_expiry && <p className={cn('text-xs font-medium mt-1', expiryColor)}>{expiryText}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Input label="Assigned to" autoComplete="off" value={form.assigned_to} onChange={f('assigned_to')} placeholder="John Doe / DevOps team" />
          <Input label="Project" autoComplete="off" value={form.project} onChange={f('project')} placeholder="HR Portal, CRM..." />
        </div>
        <Textarea label="Notes" autoComplete="off" rows={2} value={form.notes || ''} onChange={f('notes')} />

        <div className="flex gap-3 pt-2">
          <Button type="submit" loading={loading}>{isEdit ? 'Save changes' : 'Add app'}</Button>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function LicencesPage() {
  const [tab,        setTab]        = useState('licences')
  const [licences,   setLicences]   = useState([])
  const [totals,     setTotals]     = useState({ paid: {}, free: {} })
  const [entraApps,  setEntraApps]  = useState([])
  const [loading,    setLoading]    = useState(true)
  const [entraLoad,  setEntraLoad]  = useState(true)
  const [modal,      setModal]      = useState(null)  // null | 'add' | licence obj
  const [entraModal, setEntraModal] = useState(null)  // null | 'add' | app obj
  const [delTarget,  setDelTarget]  = useState(null)  // { type: 'lic'|'entra', id, name }
  const [showHidden, setShowHidden] = useState(false)
  const [search,     setSearch]     = useState('')
  const [sortCol,    setSortCol]    = useState('licence_type')
  const [sortDir,    setSortDir]    = useState('asc')
  const [renewing,   setRenewing]   = useState(null)

  const loadLicences = useCallback(() => {
    setLoading(true)
    api.get(`/licences${showHidden ? '?show_hidden=true' : ''}`)
      .then(r => { setLicences(r.data.licences); setTotals(r.data.totals) })
      .finally(() => setLoading(false))
  }, [showHidden])

  const loadEntra = useCallback(() => {
    setEntraLoad(true)
    api.get(`/licences/entra-apps${showHidden ? '?show_hidden=true' : ''}`)
      .then(r => setEntraApps(r.data))
      .finally(() => setEntraLoad(false))
  }, [showHidden])

  useEffect(() => { loadLicences() }, [loadLicences])
  useEffect(() => { loadEntra()    }, [loadEntra])

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const SortIcon = ({ col }) => {
    if (sortCol !== col) return <ChevronUp className="w-3 h-3 opacity-30" />
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />
  }

  const sortedLicences = [...licences]
    .filter(l => !search || l.licence_type?.toLowerCase().includes(search.toLowerCase()) || l.vendor?.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => {
      let av, bv
      if (sortCol === 'expiry') { av = a.expiry_date || '9999'; bv = b.expiry_date || '9999' }
      else if (sortCol === 'cost') {
        av = (a.price_per_licence || 0) * (a.licence_count || 1)
        bv = (b.price_per_licence || 0) * (b.licence_count || 1)
        return sortDir === 'asc' ? av - bv : bv - av
      } else {
        av = (a[sortCol] || '').toLowerCase()
        bv = (b[sortCol] || '').toLowerCase()
      }
      return sortDir === 'asc' ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0)
    })

  const entraWarnings = entraApps.filter(a => a.secret_status === 'expiring' || a.secret_status === 'expired').length

  const handleRenew = async (l) => {
    setRenewing(l.id)
    try {
      await api.post(`/licences/${l.id}/renew`, { cycle: l.billing_cycle })
      loadLicences()
    } catch {}
    finally { setRenewing(null) }
  }

  const handleDelete = async () => {
    if (!delTarget) return
    try {
      if (delTarget.type === 'lic') { await api.delete(`/licences/${delTarget.id}`); loadLicences() }
      else                          { await api.delete(`/licences/entra-apps/${delTarget.id}`); loadEntra() }
    } finally { setDelTarget(null) }
  }

  const ThSort = ({ col, children }) => (
    <Th className="cursor-pointer select-none" onClick={() => handleSort(col)}>
      <span className="flex items-center gap-1">{children}<SortIcon col={col} /></span>
    </Th>
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Licences</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Software licences, subscriptions and Entra ID app registrations</p>
        </div>
        {tab === 'licences' && <Button onClick={() => setModal('add')}><Plus className="w-4 h-4" />Add licence</Button>}
        {tab === 'entra'    && <Button onClick={() => setEntraModal('add')}><Plus className="w-4 h-4" />Add Entra app</Button>}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700">
        {[
          { key: 'licences', label: 'Licences' },
          { key: 'entra',    label: 'Entra ID Apps', badge: entraWarnings > 0 ? entraWarnings : null }
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn('flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.key
                ? 'border-brand text-brand dark:text-brand-light'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            )}>
            {t.key === 'entra' && <AppWindow className="w-4 h-4" />}
            {t.label}
            {t.badge && <span className="bg-yellow-500 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">{t.badge}</span>}
          </button>
        ))}
      </div>

      {/* ── LICENCES TAB ─────────────────────────────────────────────── */}
      {tab === 'licences' && (
        <>
          {/* Totals summary */}
          {(Object.keys(totals.paid).length > 0 || Object.keys(totals.free).length > 0) && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {Object.keys(totals.paid).length > 0 && (
                <Card className="p-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Cost (incl. tax)</p>
                  <table className="w-full text-sm">
                    <thead><tr className="text-xs text-gray-400 border-b border-gray-100 dark:border-gray-800">
                      <th className="text-left py-1 font-medium">Currency</th>
                      <th className="text-right py-1 font-medium pr-4">Monthly</th>
                      <th className="text-right py-1 font-medium">Annual</th>
                    </tr></thead>
                    <tbody>
                      {Object.values(totals.paid).map(t => (
                        <tr key={t.currency} className="border-b border-gray-50 dark:border-gray-800/50 last:border-0">
                          <td className="py-1.5 font-semibold text-brand">{t.currency}</td>
                          <td className="py-1.5 text-right pr-4 font-mono tabular-nums text-gray-900 dark:text-white">{formatPrice(t.monthly)}</td>
                          <td className="py-1.5 text-right font-mono tabular-nums text-gray-900 dark:text-white">{formatPrice(t.annual)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
              {Object.keys(totals.free).length > 0 && (
                <Card className="p-4">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Savings (free / bonus)</p>
                  <table className="w-full text-sm">
                    <thead><tr className="text-xs text-gray-400 border-b border-gray-100 dark:border-gray-800">
                      <th className="text-left py-1 font-medium">Currency</th>
                      <th className="text-right py-1 font-medium pr-4">Monthly</th>
                      <th className="text-right py-1 font-medium">Annual</th>
                    </tr></thead>
                    <tbody>
                      {Object.values(totals.free).map(t => (
                        <tr key={t.currency} className="border-b border-gray-50 dark:border-gray-800/50 last:border-0">
                          <td className="py-1.5 font-semibold text-green-600">{t.currency}</td>
                          <td className="py-1.5 text-right pr-4 font-mono tabular-nums text-green-600">{formatPrice(t.monthly)}</td>
                          <td className="py-1.5 text-right font-mono tabular-nums text-green-600">{formatPrice(t.annual)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </div>
          )}

          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input autoComplete="off" placeholder="Search licences..."
                value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
            <Toggle checked={showHidden} onChange={setShowHidden} label="Show hidden" />
            <span className="text-sm text-gray-400 ml-auto">{sortedLicences.length} licence{sortedLicences.length !== 1 ? 's' : ''}</span>
          </div>

          {/* Table */}
          <Card>
            {loading ? (
              <div className="flex justify-center py-12"><Spinner className="w-6 h-6" /></div>
            ) : sortedLicences.length === 0 ? (
              <Empty icon={KeyIcon} title="No licences" description="Add your first software licence" action={<Button onClick={() => setModal('add')}><Plus className="w-4 h-4" />Add licence</Button>} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <ThSort col="licence_type">Name</ThSort>
                    <ThSort col="vendor">Vendor</ThSort>
                    <Th>Used / Total</Th>
                    <ThSort col="billing_cycle">Billing</ThSort>
                    <ThSort col="cost">Cost</ThSort>
                    <ThSort col="expiry">Expiry</ThSort>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {sortedLicences.map(l => {
                    const exp  = expiryBadge(l.expiry_date)
                    const used = l.assigned_to?.length > 0 ? l.assigned_to.length : (l.licence_used || 0)
                    const pct  = l.licence_count > 0 ? Math.round((used / l.licence_count) * 100) : 0
                    const barColor = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-yellow-500' : 'bg-brand'
                    return (
                      <tr key={l.id} className={cn('hover:bg-gray-50 dark:hover:bg-gray-800/50', l.hidden && 'opacity-40')}>
                        <Td>
                          <div className="flex items-center gap-1.5 font-medium text-gray-900 dark:text-white">
                            {l.licence_type}
                            {l.url && <a href={l.url} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-brand"><ExternalLink className="w-3 h-3" /></a>}
                            {l.licence_mfa ? <ShieldCheck className="w-3.5 h-3.5 text-green-500" title="MFA enabled" /> : null}
                          </div>
                          {l.licence_username && <p className="text-xs text-gray-400 font-mono mt-0.5">{l.licence_username}</p>}
                          {l.is_free ? <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 px-1.5 py-0.5 rounded font-medium">Free</span> : null}
                        </Td>
                        <Td className="text-gray-600 dark:text-gray-400">{l.vendor}</Td>
                        <Td>
                          <div className="font-mono text-sm">
                            <span className={pct >= 100 ? 'text-red-500 font-semibold' : ''}>{used}</span>
                            <span className="text-gray-400"> / {l.licence_count}</span>
                          </div>
                          {used > 0 && l.licence_count > 0 && (
                            <div className="w-20 h-1 bg-gray-200 dark:bg-gray-700 rounded-full mt-1">
                              <div className={cn('h-full rounded-full', barColor)} style={{ width: `${Math.min(pct, 100)}%` }} />
                            </div>
                          )}
                        </Td>
                        <Td className="text-gray-500">{BILLING_LABELS[l.billing_cycle] || l.billing_cycle}</Td>
                        <Td>
                          {l.price_per_licence ? (
                            <div>
                              <span className={cn('font-medium', l.is_free ? 'text-green-600' : 'text-gray-900 dark:text-white')}>
                                {formatPrice(l.price_per_licence * (l.licence_count || 1))} {l.currency}
                              </span>
                              <p className="text-xs text-gray-400">{formatPrice(l.price_per_licence)}/{l.billing_cycle === 'monthly' ? 'mo' : 'yr'}</p>
                            </div>
                          ) : <span className="text-gray-300">—</span>}
                        </Td>
                        <Td>
                          {l.expiry_date ? (
                            <div>
                              <span className="text-sm">{l.expiry_date}</span>
                              {exp && <Badge className={cn('ml-1 text-xs', exp.cls)}>{exp.label}</Badge>}
                            </div>
                          ) : <span className="text-gray-300">—</span>}
                        </Td>
                        <Td>
                          <div className="flex items-center justify-end gap-1">
                            {l.expiry_date && l.billing_cycle !== 'perpetual' && (
                              <button onClick={() => handleRenew(l)} disabled={renewing === l.id}
                                className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors" title="Renew">
                                <RotateCcw className={cn('w-3.5 h-3.5', renewing === l.id && 'animate-spin')} />
                              </button>
                            )}
                            <button onClick={() => setModal(l)} className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => setDelTarget({ type: 'lic', id: l.id, name: `${l.vendor} — ${l.licence_type}` })} className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}

      {/* ── ENTRA ID APPS TAB ─────────────────────────────────────────── */}
      {tab === 'entra' && (
        <>
          {entraWarnings > 0 && (
            <AlertBox type="warning">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 flex-shrink-0" />
                <span><strong>{entraWarnings}</strong> app{entraWarnings > 1 ? 's have' : ' has'} a client secret expiring within 30 days or already expired.</span>
              </div>
            </AlertBox>
          )}

          <div className="flex items-center gap-3">
            <Toggle checked={showHidden} onChange={setShowHidden} label="Show hidden" />
            <span className="text-sm text-gray-400 ml-auto">{entraApps.length} app{entraApps.length !== 1 ? 's' : ''}</span>
          </div>

          <Card>
            {entraLoad ? (
              <div className="flex justify-center py-12"><Spinner className="w-6 h-6" /></div>
            ) : entraApps.length === 0 ? (
              <Empty icon={AppWindow} title="No Entra ID apps" description="Add app registrations to track client secret expiry dates" action={<Button onClick={() => setEntraModal('add')}><Plus className="w-4 h-4" />Add Entra app</Button>} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>App name</Th>
                    <Th>Client ID</Th>
                    <Th>Secret</Th>
                    <Th>Expiry</Th>
                    <Th>Assigned to</Th>
                    <Th>Project</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {entraApps.map(a => {
                    const statusCls = a.secret_status === 'expired'  ? 'text-red-500'
                                    : a.secret_status === 'expiring' ? 'text-yellow-500'
                                    : 'text-green-500'
                    return (
                      <tr key={a.id} className={cn('hover:bg-gray-50 dark:hover:bg-gray-800/50', a.hidden && 'opacity-40')}>
                        <Td>
                          <div className="flex items-center gap-2 font-medium text-gray-900 dark:text-white">
                            <AppWindow className="w-4 h-4 text-brand flex-shrink-0" />
                            {a.app_name}
                          </div>
                          {a.notes && <p className="text-xs text-gray-400 mt-0.5 truncate max-w-48">{a.notes}</p>}
                        </Td>
                        <Td>{a.app_id ? <span className="font-mono text-xs text-gray-500 truncate block max-w-40">{a.app_id}</span> : <span className="text-gray-300">—</span>}</Td>
                        <Td>{a.client_secret ? <span className="font-mono text-xs bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">***</span> : <span className="text-xs text-gray-400">not set</span>}</Td>
                        <Td>
                          {a.secret_expiry ? (
                            <div>
                              <span className="text-sm">{a.secret_expiry}</span>
                              {a.days_until_expiry != null && (
                                <p className={cn('text-xs font-medium', statusCls)}>
                                  {a.days_until_expiry < 0 ? `Expired ${Math.abs(a.days_until_expiry)}d ago` : `${a.days_until_expiry}d left`}
                                </p>
                              )}
                            </div>
                          ) : <span className="text-gray-300">—</span>}
                        </Td>
                        <Td className="text-gray-600 dark:text-gray-400">{a.assigned_to || <span className="text-gray-300">—</span>}</Td>
                        <Td>{a.project ? <Badge className="bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400">{a.project}</Badge> : <span className="text-gray-300">—</span>}</Td>
                        <Td>
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => setEntraModal(a)} className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                            <button onClick={() => setDelTarget({ type: 'entra', id: a.id, name: a.app_name })} className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                          </div>
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}

      {/* Modals */}
      {modal && (
        <LicenceModal
          licence={modal === 'add' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); loadLicences() }}
        />
      )}
      {entraModal && (
        <EntraAppModal
          app={entraModal === 'add' ? null : entraModal}
          onClose={() => setEntraModal(null)}
          onSaved={() => { setEntraModal(null); loadEntra() }}
        />
      )}

      {/* Delete confirm */}
      <Modal open={!!delTarget} onClose={() => setDelTarget(null)} title="Delete" size="sm">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Are you sure you want to delete <strong>{delTarget?.name}</strong>? This cannot be undone.
        </p>
        <div className="flex gap-3">
          <Button variant="danger" onClick={handleDelete}>Delete</Button>
          <Button variant="secondary" onClick={() => setDelTarget(null)}>Cancel</Button>
        </div>
      </Modal>
    </div>
  )
}
