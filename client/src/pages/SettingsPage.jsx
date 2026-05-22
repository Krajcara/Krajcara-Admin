import { useState, useEffect } from 'react'
import { Save, TestTube, RefreshCw, CheckCircle, AlertCircle } from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { Card, CardHeader, CardTitle, CardContent, Button, Input, AlertBox, Spinner } from '../components/shared/UI'

function SettingsSection({ title, children }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

// ── Update section ────────────────────────────────────────────────
function UpdateSection() {
  const [checking,  setChecking]  = useState(false)
  const [updating,  setUpdating]  = useState(false)
  const [info,      setInfo]      = useState(null)  // result from /check
  const [message,   setMessage]   = useState(null)  // { type, text }

  const check = async () => {
    setChecking(true)
    setMessage(null)
    try {
      const r = await api.get('/update/check')
      setInfo(r.data)
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Could not reach GitHub. Check internet connection.' })
    } finally { setChecking(false) }
  }

  const runUpdate = async () => {
    setUpdating(true)
    setMessage(null)
    try {
      const r = await api.post('/update/run')
      setMessage({ type: 'success', text: r.data.message })
      setInfo(null)
    } catch (err) {
      setMessage({ type: 'error', text: err.response?.data?.error || 'Update failed' })
    } finally { setUpdating(false) }
  }

  return (
    <SettingsSection title="System update">
      <div className="space-y-4 max-w-lg">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Check GitHub for new commits. If an update is available, it will pull the latest code, rebuild the frontend and restart the service automatically.
        </p>

        {message && <AlertBox type={message.type}>{message.text}</AlertBox>}

        {info && (
          <div className={`rounded-lg border px-4 py-3 text-sm flex items-start gap-3 ${
            info.up_to_date
              ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
              : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
          }`}>
            {info.up_to_date
              ? <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
              : <AlertCircle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />}
            <div>
              {info.up_to_date
                ? <p className="text-green-700 dark:text-green-300 font-medium">Already up to date</p>
                : <p className="text-yellow-700 dark:text-yellow-300 font-medium">Update available</p>}
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-mono">
                Installed: {info.local_sha}
                {!info.up_to_date && <> → Latest: {info.remote_sha}</>}
              </p>
              {info.current_version && (
                <p className="text-xs text-gray-400 mt-0.5">Version: {info.current_version}</p>
              )}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <Button variant="secondary" loading={checking} onClick={check}>
            <RefreshCw className="w-4 h-4" />
            Check for updates
          </Button>
          {info && !info.up_to_date && (
            <Button loading={updating} onClick={runUpdate}>
              <RefreshCw className="w-4 h-4" />
              Install update
            </Button>
          )}
        </div>

        <p className="text-xs text-gray-400">
          You can also update manually via SSH: <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded font-mono">sudo bash /opt/krajcara-admin/update.sh</code>
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
      const payload = Object.fromEntries(keys.map(k => [k, settings[k] ?? '']))
      await api.post('/settings/save', payload)
      setStatus({ type: 'success', message: 'Settings saved' })
    } catch {
      setStatus({ type: 'error', message: 'Failed to save settings' })
    } finally { setSaving(false) }
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

      {/* General */}
      <SettingsSection title="General">
        <div className="space-y-4 max-w-lg">
          <Input label="Application name" autoComplete="off" value={settings.app_name || ''} onChange={f('app_name')} />
          <Input label="GitHub repository" autoComplete="off" value={settings.github_repo || ''} onChange={f('github_repo')} placeholder="https://github.com/krajcara/Krajcara-Admin.git" />
          <Button loading={saving} onClick={() => save(['app_name', 'github_repo'])}><Save className="w-4 h-4" />Save</Button>
        </div>
      </SettingsSection>

      {/* SMTP */}
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
            <Button loading={saving} onClick={() => save(['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_secure'])}><Save className="w-4 h-4" />Save</Button>
            <Button variant="secondary" loading={testing} onClick={testSmtp}><TestTube className="w-4 h-4" />Test connection</Button>
          </div>
        </div>
      </SettingsSection>

      {/* Retention */}
      <SettingsSection title="Data retention">
        <div className="space-y-4 max-w-lg">
          <Input label="Audit log retention (days)" type="number" autoComplete="off" value={settings.audit_retention_days || '365'} onChange={f('audit_retention_days')} />
          <Button loading={saving} onClick={() => save(['audit_retention_days'])}><Save className="w-4 h-4" />Save</Button>
        </div>
      </SettingsSection>

      {/* Update — only for superadmin/admin */}
      {(user?.role === 'superadmin' || user?.role === 'admin') && <UpdateSection />}
    </div>
  )
}
