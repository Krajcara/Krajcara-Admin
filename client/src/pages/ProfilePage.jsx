import { useState, useEffect } from 'react'
import { Plus, Trash2, Eye, EyeOff, Copy, Check, Monitor, Smartphone, Globe, LogOut, AlertTriangle } from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { Card, CardHeader, CardTitle, CardContent, Button, Input, AlertBox, Spinner, Modal } from '../components/shared/UI'
import { cn } from '../lib/utils'
import { formatDate } from '../lib/utils'

// ── Change password section ───────────────────────────────────────
function ChangePasswordSection() {
  const [form,    setForm]    = useState({ current_password: '', new_password: '', confirm: '' })
  const [status,  setStatus]  = useState(null) // null | 'success' | 'error'
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    if (form.new_password !== form.confirm) { setStatus('error'); setMessage('Passwords do not match'); return }
    if (form.new_password.length < 8) { setStatus('error'); setMessage('Minimum 8 characters'); return }
    setLoading(true); setStatus(null)
    try {
      await api.post('/auth/change-password', { current_password: form.current_password, new_password: form.new_password })
      setStatus('success'); setMessage('Password changed successfully')
      setForm({ current_password: '', new_password: '', confirm: '' })
    } catch (err) {
      setStatus('error'); setMessage(err.response?.data?.error || 'Failed to change password')
    } finally { setLoading(false) }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Change password</CardTitle></CardHeader>
      <CardContent>
        <form onSubmit={submit} autoComplete="off" className="space-y-4 max-w-sm">
          {status && <AlertBox type={status}>{message}</AlertBox>}
          <Input label="Current password" type="password" autoComplete="new-password" value={form.current_password} onChange={f('current_password')} required />
          <Input label="New password" type="password" autoComplete="new-password" value={form.new_password} onChange={f('new_password')} required />
          <Input label="Confirm new password" type="password" autoComplete="new-password" value={form.confirm} onChange={f('confirm')} required />
          <Button type="submit" loading={loading}>Save password</Button>
        </form>
      </CardContent>
    </Card>
  )
}

// ── TOTP section ──────────────────────────────────────────────────
function TotpSection() {
  const [status,      setStatus]      = useState(null)
  const [qr,          setQr]          = useState(null)
  const [secret,      setSecret]      = useState(null)
  const [code,        setCode]        = useState('')
  const [backupCodes, setBackupCodes] = useState(null)
  const [loading,     setLoading]     = useState(false)
  const [error,       setError]       = useState('')

  useEffect(() => {
    api.get('/totp/status').then(r => setStatus(r.data)).catch(() => {})
  }, [])

  const setupTotp = async () => {
    setLoading(true); setError('')
    try {
      const r = await api.post('/totp/setup')
      setQr(r.data.qr); setSecret(r.data.secret)
    } catch { setError('Setup failed') }
    finally { setLoading(false) }
  }

  const verifyTotp = async (e) => {
    e.preventDefault(); setLoading(true); setError('')
    try {
      const r = await api.post('/totp/verify', { code })
      setBackupCodes(r.data.backup_codes)
      setStatus({ enabled: true })
      setQr(null); setSecret(null)
    } catch (err) { setError(err.response?.data?.error || 'Invalid code') }
    finally { setLoading(false) }
  }

  const disableTotp = async () => {
    await api.post('/totp/disable')
    setStatus({ enabled: false }); setBackupCodes(null)
  }

  if (!status) return <div className="py-4"><Spinner className="w-5 h-5" /></div>

  return (
    <Card>
      <CardHeader><CardTitle>Two-factor authentication</CardTitle></CardHeader>
      <CardContent>
        {backupCodes && (
          <AlertBox type="warning" className="mb-4">
            <p className="font-medium mb-2">Save your backup codes — they will not be shown again:</p>
            <div className="grid grid-cols-2 gap-1 font-mono text-xs mt-2">
              {backupCodes.map(c => <span key={c} className="bg-white dark:bg-gray-800 px-2 py-1 rounded">{c}</span>)}
            </div>
          </AlertBox>
        )}
        {status.enabled && !qr && (
          <div className="space-y-3">
            <AlertBox type="success">Two-factor authentication is enabled.</AlertBox>
            <Button variant="danger" onClick={disableTotp}>Disable 2FA</Button>
          </div>
        )}
        {!status.enabled && !qr && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-400">Add an extra layer of security to your account.</p>
            <Button onClick={setupTotp} loading={loading}>Enable 2FA</Button>
          </div>
        )}
        {qr && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 dark:text-gray-400">Scan this QR code with your authenticator app (Google Authenticator, Authy, etc.):</p>
            <img src={qr} alt="TOTP QR Code" className="w-48 h-48 border rounded-lg" />
            <p className="text-xs text-gray-400">Manual key: <span className="font-mono">{secret}</span></p>
            <form onSubmit={verifyTotp} autoComplete="off" className="space-y-3 max-w-xs">
              {error && <AlertBox type="error">{error}</AlertBox>}
              <Input label="Enter 6-digit code to confirm" autoComplete="new-password" value={code} onChange={e => setCode(e.target.value)} placeholder="000000" required />
              <Button type="submit" loading={loading}>Verify and enable</Button>
            </form>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── API Keys section ──────────────────────────────────────────────
function ApiKeysSection() {
  const [keys,     setKeys]     = useState([])
  const [loading,  setLoading]  = useState(true)
  const [modal,    setModal]    = useState(false)
  const [newName,  setNewName]  = useState('')
  const [newKey,   setNewKey]   = useState(null) // shown once after creation
  const [copied,   setCopied]   = useState(false)
  const [creating, setCreating] = useState(false)
  const [error,    setError]    = useState('')

  const load = () => api.get('/api-keys').then(r => setKeys(r.data)).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const create = async (e) => {
    e.preventDefault(); setError(''); setCreating(true)
    try {
      const r = await api.post('/api-keys', { name: newName })
      setNewKey(r.data.key)
      setNewName('')
      load()
    } catch (err) { setError(err.response?.data?.error || 'Error creating key') }
    finally { setCreating(false) }
  }

  const revoke = async (id) => {
    await api.delete(`/api-keys/${id}`)
    load()
  }

  const copy = () => {
    navigator.clipboard.writeText(newKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>API keys</CardTitle>
          <Button size="sm" onClick={() => setModal(true)}><Plus className="w-4 h-4" />New key</Button>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">API keys allow programmatic access to Krajcara Admin without using your password. Each key is shown only once at creation.</p>
        {loading ? <Spinner className="w-5 h-5" /> : (
          <div className="space-y-2">
            {keys.length === 0 && <p className="text-sm text-gray-400">No API keys yet.</p>}
            {keys.map(k => (
              <div key={k.id} className="flex items-center gap-3 py-2 border-b border-gray-100 dark:border-gray-800 last:border-0">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{k.name}</p>
                  <p className="text-xs text-gray-400 font-mono">{k.key_prefix}••••••••••••</p>
                  <p className="text-xs text-gray-400 mt-0.5">Created {formatDate(k.created_at)}{k.last_used && ` · Last used ${formatDate(k.last_used)}`}</p>
                </div>
                <button onClick={() => revoke(k.id)} className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      {/* Create modal */}
      <Modal open={modal} onClose={() => { setModal(false); setNewKey(null); setError('') }} title="New API key">
        {newKey ? (
          <div className="space-y-4">
            <AlertBox type="warning">Copy this key now — it will not be shown again.</AlertBox>
            <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 rounded-lg px-3 py-2">
              <code className="flex-1 text-xs font-mono text-gray-800 dark:text-gray-200 break-all">{newKey}</code>
              <button onClick={copy} className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors flex-shrink-0">
                {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            <Button onClick={() => { setModal(false); setNewKey(null) }}>Done</Button>
          </div>
        ) : (
          <form onSubmit={create} autoComplete="off" className="space-y-4">
            {error && <AlertBox type="error">{error}</AlertBox>}
            <Input label="Key name" autoComplete="off" value={newName} onChange={e => setNewName(e.target.value)} placeholder="e.g. Monitoring script" required autoFocus />
            <div className="flex gap-3">
              <Button type="submit" loading={creating}>Create key</Button>
              <Button type="button" variant="secondary" onClick={() => { setModal(false); setError('') }}>Cancel</Button>
            </div>
          </form>
        )}
      </Modal>
    </Card>
  )
}


// ── Active sessions ────────────────────────────────────────────────────────────
function SessionsSection() {
  const [sessions, setSessions]   = useState([])
  const [loading,  setLoading]    = useState(true)
  const [revoking, setRevoking]   = useState(null)
  const [message,  setMessage]    = useState(null)

  const load = () => {
    setLoading(true)
    api.get('/auth/sessions').then(r => setSessions(r.data)).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  const terminate = async (id) => {
    setRevoking(id)
    try {
      await api.delete(`/auth/sessions/${id}`)
      setSessions(p => p.filter(s => s.id !== id))
      setMessage({ type: 'success', text: 'Session terminated' })
    } catch (e) { setMessage({ type: 'error', text: e.response?.data?.error || 'Failed' }) }
    finally { setRevoking(null) }
  }

  const terminateAll = async () => {
    if (!window.confirm('Sign out all other devices?')) return
    setRevoking('all')
    try {
      const r = await api.delete('/auth/sessions')
      setSessions(p => p.filter(s => s.is_current))
      setMessage({ type: 'success', text: `${r.data.terminated} other session${r.data.terminated !== 1 ? 's' : ''} terminated` })
    } catch (e) { setMessage({ type: 'error', text: e.response?.data?.error || 'Failed' }) }
    finally { setRevoking(null) }
  }

  const DeviceIcon = ({ hint }) => {
    if (/mobile/i.test(hint)) return <Smartphone className="w-4 h-4" />
    return <Monitor className="w-4 h-4" />
  }

  const fmtDate = (d) => d ? new Date(d + (d.endsWith('Z') ? '' : 'Z')).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

  const others = sessions.filter(s => !s.is_current)

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Active sessions</CardTitle>
          {others.length > 0 && (
            <Button variant="secondary" size="sm" loading={revoking === 'all'} onClick={terminateAll}>
              <LogOut className="w-3.5 h-3.5" />Sign out all others
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {message && <AlertBox type={message.type} className="mb-4">{message.text}</AlertBox>}
        {loading ? <div className="flex justify-center py-6"><Spinner className="w-5 h-5" /></div>
        : !sessions.length ? <p className="text-sm text-gray-400 py-2">No active sessions</p>
        : (
          <div className="space-y-2">
            {sessions.map(s => (
              <div key={s.id} className={cn(
                'flex items-center gap-3 p-3 rounded-lg border',
                s.is_current
                  ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
                  : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700'
              )}>
                <div className={cn('text-gray-400', s.is_current && 'text-green-600 dark:text-green-400')}>
                  <DeviceIcon hint={s.device_hint || ''} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {s.device_hint || 'Unknown device'}
                    </p>
                    {s.is_current && (
                      <span className="text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 px-1.5 py-0.5 rounded font-medium">
                        current
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">
                    {s.ip_address || 'Unknown IP'} · Last seen {fmtDate(s.last_seen)}
                  </p>
                  <p className="text-xs text-gray-300 dark:text-gray-600 truncate mt-0.5">
                    {(s.user_agent || '').slice(0, 80)}
                  </p>
                </div>
                {!s.is_current && (
                  <button onClick={() => terminate(s.id)} disabled={revoking === s.id}
                    className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors flex-shrink-0"
                    title="Terminate session">
                    {revoking === s.id ? <Spinner className="w-4 h-4" /> : <LogOut className="w-4 h-4" />}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Main profile page ─────────────────────────────────────────────
export default function ProfilePage() {
  const { user } = useAuthStore()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Profile</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{user?.username} · {user?.role}</p>
      </div>

      <ChangePasswordSection />
      <TotpSection />
      <ApiKeysSection />
      <SessionsSection />
    </div>
  )
}
