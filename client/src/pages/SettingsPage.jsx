import { useState, useEffect, useRef } from 'react'
import { Save, TestTube, RefreshCw, CheckCircle, AlertCircle, Bell } from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { useSocket } from '../hooks/useSocket'
import { Card, CardHeader, CardTitle, CardContent, Button, Input, AlertBox, Spinner, Toggle } from '../components/shared/UI'

function SettingsSection({ title, children }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

// ── Notification settings ─────────────────────────────────────────────────────
function NotificationSection() {
  const [form,    setForm]    = useState({ email_enabled: false, email_sender: '', email_recipients: '' })
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [status,  setStatus]  = useState(null)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  useEffect(() => {
    api.get('/notifications/settings')
      .then(r => setForm(r.data))
      .finally(() => setLoading(false))
  }, [])

  const MODULES = [
    { key: 'monitors', label: 'Monitor down/up',          default: true },
    { key: 'proxmox',  label: 'Proxmox VM stopped/started', default: true },
    { key: 'routers',  label: 'Router offline/online',    default: true },
    { key: 'dns',      label: 'DNS server offline/online', default: true },
    { key: 'licences', label: 'Licence expiring',         default: false },
    { key: 'entra',    label: 'Entra ID secret expiring', default: false },
  ]

  const save = async (e) => {
    e.preventDefault(); setSaving(true); setStatus(null)
    try {
      await api.post('/notifications/settings', form)
      setStatus({ type: 'success', message: 'Notification settings saved' })
    } catch { setStatus({ type: 'error', message: 'Failed to save' }) }
    finally { setSaving(false) }
  }

  if (loading) return null

  return (
    <SettingsSection title="Notifications">
      <form onSubmit={save} autoComplete="off" className="space-y-4 max-w-lg">
        {status && <AlertBox type={status.type}>{status.message}</AlertBox>}
        <Toggle
          checked={!!form.email_enabled}
          onChange={v => setForm(p => ({ ...p, email_enabled: v }))}
          label="Send email notifications"
        />
        {form.email_enabled && <>
          <AlertBox type="info">
            Emails are sent via <strong>M365</strong> (if configured) or fall back to <strong>SMTP</strong> (configured in Email section above).
          </AlertBox>
          <Input label="Sender email (M365 mailbox or SMTP from)" autoComplete="off"
            value={form.email_sender || ''} onChange={f('email_sender')}
            placeholder="notifications@company.com" />
          <div className="space-y-1">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Recipients (comma separated)</label>
            <textarea autoComplete="off" rows={2}
              value={form.email_recipients || ''} onChange={f('email_recipients')}
              placeholder="admin@company.com, ops@company.com"
              className="w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand resize-none" />
          </div>
          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Send email for</label>
            <div className="space-y-2 pl-1">
              {MODULES.map(m => {
                const val = form[`module_${m.key}`] !== undefined ? form[`module_${m.key}`] : m.default
                return (
                  <label key={m.key} className="flex items-center gap-2.5 cursor-pointer">
                    <input type="checkbox" checked={!!val}
                      onChange={e => setForm(p => ({ ...p, [`module_${m.key}`]: e.target.checked }))}
                      className="w-4 h-4 rounded text-brand" />
                    <span className="text-sm text-gray-700 dark:text-gray-300">{m.label}</span>
                    {!m.default && <span className="text-xs text-gray-400">(daily check)</span>}
                  </label>
                )
              })}
            </div>
          </div>
        </>}
        <Button type="submit" loading={saving}><Save className="w-4 h-4" />Save</Button>
      </form>
    </SettingsSection>
  )
}

// ── Update section ────────────────────────────────────────────────
function UpdateSection() {
  const [checking,  setChecking]  = useState(false)
  const [updating,  setUpdating]  = useState(false)
  const [info,      setInfo]      = useState(null)
  const [phase,     setPhase]     = useState('idle')   // idle | running | waiting | done | error
  const [message,   setMessage]   = useState(null)
  const pollRef = useRef(null)
  const pollCount = useRef(0)

  // Listen for server-pushed update event
  useSocket({
    'system:updating': ({ message: msg }) => {
      setPhase('waiting')
      setMessage({ type: 'info', text: msg || 'Update in progress. Waiting for server to restart...' })
      startPolling()
    }
  })

  const stopPolling = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    pollCount.current = 0
  }

  const startPolling = () => {
    stopPolling()
    pollCount.current = 0
    // Wait 10s before first check (service needs time to go down and come back)
    setTimeout(() => {
      pollRef.current = setInterval(async () => {
        pollCount.current++
        try {
          await api.get('/health', { timeout: 5000 })
          // Server responded — update complete
          stopPolling()
          setPhase('done')
          setUpdating(false)
          setInfo(null)
          setMessage({ type: 'success', text: 'Update complete! Page will reload in 3 seconds...' })
          setTimeout(() => window.location.reload(), 3000)
        } catch {
          // Still down — keep polling
          if (pollCount.current > 40) {
            // ~3.5 minutes total, give up
            stopPolling()
            setPhase('error')
            setUpdating(false)
            setMessage({ type: 'error', text: 'Update timed out. Check server logs: sudo journalctl -u krajcara-admin -n 50' })
          }
        }
      }, 5000)
    }, 10000)
  }

  useEffect(() => () => stopPolling(), [])

  const check = async () => {
    setChecking(true); setMessage(null)
    try {
      const r = await api.get('/update/check')
      setInfo(r.data)
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Could not reach GitHub. Check internet connection.' })
    } finally { setChecking(false) }
  }

  const runUpdate = async () => {
    setUpdating(true); setMessage(null); setPhase('running')
    try {
      await api.post('/update/run')
      setMessage({ type: 'info', text: 'Update started. Waiting for the server to restart...' })
      setInfo(null)
      // Start polling in case Socket.io event is missed (server restarts before emit)
      setTimeout(startPolling, 5000)
    } catch (err) {
      setPhase('error'); setUpdating(false)
      setMessage({ type: 'error', text: err.response?.data?.error || 'Update failed' })
    }
  }

  const isActive = phase === 'running' || phase === 'waiting'

  return (
    <SettingsSection title="System update">
      <div className="space-y-4 max-w-lg">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Check GitHub for new commits. If an update is available, the server will pull the latest code, rebuild the frontend and restart automatically.
        </p>

        {message && (
          <AlertBox type={message.type}>
            <div className="flex items-center gap-2">
              {isActive && <RefreshCw className="w-4 h-4 animate-spin flex-shrink-0" />}
              {phase === 'done' && <CheckCircle className="w-4 h-4 flex-shrink-0 text-green-500" />}
              {phase === 'error' && <AlertCircle className="w-4 h-4 flex-shrink-0" />}
              <span>{message.text}</span>
            </div>
          </AlertBox>
        )}

        {info && !isActive && (
          <div className={`rounded-lg border px-4 py-3 text-sm flex items-start gap-3 ${
            info.up_to_date
              ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
              : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
          }`}>
            {info.up_to_date
              ? <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
              : <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />}
            <div>
              <p className={`font-medium ${info.up_to_date ? 'text-green-700 dark:text-green-300' : 'text-yellow-700 dark:text-yellow-300'}`}>
                {info.up_to_date ? 'Already up to date' : 'Update available'}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-mono">
                Installed: {info.local_sha}{!info.up_to_date && <> → Latest: {info.remote_sha}</>}
              </p>
              {info.current_version && <p className="text-xs text-gray-400 mt-0.5">Version: {info.current_version}</p>}
            </div>
          </div>
        )}

        {!isActive && phase !== 'done' && (
          <div className="flex gap-2">
            <Button variant="secondary" loading={checking} onClick={check}>
              <RefreshCw className="w-4 h-4" />Check for updates
            </Button>
            {info && !info.up_to_date && (
              <Button loading={updating} onClick={runUpdate}>
                <RefreshCw className="w-4 h-4" />Install update
              </Button>
            )}
          </div>
        )}

        {isActive && (
          <div className="text-sm text-gray-500 dark:text-gray-400 space-y-1">
            <p>The server will restart automatically. This page will reload when the update is complete.</p>
            <p className="text-xs font-mono">Polling for server... ({pollCount.current} attempts)</p>
          </div>
        )}

        <p className="text-xs text-gray-400">
          Manual: <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded font-mono">sudo bash /opt/krajcara-admin/update.sh</code>
        </p>
      </div>
    </SettingsSection>
  )
}

// ── Main settings page ────────────────────────────────────────────
export default function SettingsPage() {
  const [settings, setSettings] = useState({})
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [testing,  setTesting]  = useState(false)
  const [status,   setStatus]   = useState(null)
  const { user } = useAuthStore()
  const f = k => e => setSettings(p => ({ ...p, [k]: e.target.value }))

  useEffect(() => {
    api.get('/settings').then(r => setSettings(r.data)).finally(() => setLoading(false))
  }, [])

  const save = async (keys) => {
    setSaving(true); setStatus(null)
    try {
      await api.post('/settings/save', Object.fromEntries(keys.map(k => [k, settings[k] ?? ''])))
      setStatus({ type: 'success', message: 'Settings saved' })
    } catch { setStatus({ type: 'error', message: 'Failed to save settings' }) }
    finally { setSaving(false) }
  }

  const testSmtp = async () => {
    setTesting(true); setStatus(null)
    try {
      const r = await api.post('/settings/test/smtp', {
        smtp_host: settings.smtp_host, smtp_port: settings.smtp_port,
        smtp_user: settings.smtp_user, smtp_pass: settings.smtp_pass,
        smtp_from: settings.smtp_from
      })
      setStatus({ type: r.data.ok ? 'success' : 'error', message: r.data.message || r.data.error })
    } catch { setStatus({ type: 'error', message: 'Test failed' }) }
    finally { setTesting(false) }
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner className="w-8 h-8" /></div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Settings</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Application configuration</p>
      </div>

      {status && <AlertBox type={status.type}>{status.message}</AlertBox>}

      <SettingsSection title="General">
        <div className="space-y-4 max-w-lg">
          <Input label="Application name" autoComplete="off" value={settings.app_name || ''} onChange={f('app_name')} />
          <Input label="GitHub repository" autoComplete="off" value={settings.github_repo || ''} onChange={f('github_repo')} placeholder="https://github.com/krajcara/Krajcara-Admin.git" />
          <Button loading={saving} onClick={() => save(['app_name', 'github_repo'])}><Save className="w-4 h-4" />Save</Button>
        </div>
      </SettingsSection>

      <SettingsSection title="TV Monitor">
        <div className="space-y-4 max-w-lg">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Proxmox view mode
            </label>
            <div className="space-y-2">
              {[
                { value: 'cards',     label: 'Cards by node',    desc: 'VM kartice grupisane po nodu, 6 po redu' },
                { value: 'table',     label: 'Table',            desc: 'Kompaktna tabela sa svim VM-ovima' },
                { value: 'wallboard', label: 'NOC / Wallboard',  desc: 'Boja kartice mijenja se po statusu (zelena/žuta/crvena)' },
              ].map(opt => (
                <label key={opt.value} className="flex items-start gap-3 cursor-pointer p-3 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                  <input type="radio" name="tv_proxmox_view"
                    value={opt.value}
                    checked={(settings.tv_proxmox_view || 'cards') === opt.value}
                    onChange={() => setSettings(p => ({ ...p, tv_proxmox_view: opt.value }))}
                    className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{opt.label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{opt.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <Button loading={saving} onClick={() => save(['tv_proxmox_view'])}><Save className="w-4 h-4" />Save</Button>
        </div>
      </SettingsSection>

      <SettingsSection title="Email (SMTP)">
        <div className="space-y-4 max-w-lg">
          <div className="grid grid-cols-2 gap-4">
            <Input label="SMTP host" autoComplete="off" value={settings.smtp_host || ''} onChange={f('smtp_host')} placeholder="smtp.example.com" />
            <Input label="Port" autoComplete="off" value={settings.smtp_port || ''} onChange={f('smtp_port')} placeholder="587" />
          </div>
          <Input label="Username" autoComplete="new-password" value={settings.smtp_user || ''} onChange={f('smtp_user')} />
          <Input label="Password" type="password" autoComplete="new-password"
            value={settings.smtp_pass || ''}
            onChange={f('smtp_pass')}
            placeholder={settings.smtp_pass === '***' ? '(saved)' : ''} />
          <Input label="From address" autoComplete="off" value={settings.smtp_from || ''} onChange={f('smtp_from')} placeholder="Krajcara Admin <noreply@example.com>" />
          <div className="flex gap-2">
            <Button loading={saving} onClick={() => save(['smtp_host','smtp_port','smtp_user','smtp_pass','smtp_from','smtp_secure'])}><Save className="w-4 h-4" />Save</Button>
            <Button variant="secondary" loading={testing} onClick={testSmtp}><TestTube className="w-4 h-4" />Test connection</Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Data retention">
        <div className="space-y-4 max-w-lg">
          <Input label="Audit log retention (days)" type="number" autoComplete="off" value={settings.audit_retention_days || '365'} onChange={f('audit_retention_days')} />
          <Button loading={saving} onClick={() => save(['audit_retention_days'])}><Save className="w-4 h-4" />Save</Button>
        </div>
      </SettingsSection>

      {(user?.role === 'superadmin' || user?.role === 'admin') && <NotificationSection />}

      {(user?.role === 'superadmin' || user?.role === 'admin') && <UpdateSection />}
    </div>
  )
}
