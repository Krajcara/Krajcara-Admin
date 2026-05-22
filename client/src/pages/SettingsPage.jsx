import { useState, useEffect } from 'react'
import { Save, TestTube } from 'lucide-react'
import api from '../lib/api'
import { Card, CardHeader, CardTitle, CardContent, Button, Input, AlertBox, Spinner } from '../components/shared/UI'

function SettingsSection({ title, children }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export default function SettingsPage() {
  const [settings, setSettings] = useState({})
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [testing,  setTesting]  = useState(false)
  const [status,   setStatus]   = useState(null)
  const f = k => e => setSettings(p => ({ ...p, [k]: e.target.value }))

  useEffect(() => {
    api.get('/settings').then(r => setSettings(r.data)).finally(() => setLoading(false))
  }, [])

  const save = async (section, keys) => {
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

  const GENERAL_KEYS = ['app_name', 'github_repo']
  const SMTP_KEYS    = ['smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'smtp_from', 'smtp_secure']

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
          <Input label="GitHub repository" autoComplete="off" value={settings.github_repo || ''} onChange={f('github_repo')} placeholder="username/krajcara-admin" />
          <Button loading={saving} onClick={() => save('general', GENERAL_KEYS)}><Save className="w-4 h-4" />Save</Button>
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
          <Input label="Password" type="password" autoComplete="new-password" value={settings.smtp_pass || ''} onChange={f('smtp_pass')} placeholder={settings.smtp_pass === '***' ? '••••••••' : ''} />
          <Input label="From address" autoComplete="off" value={settings.smtp_from || ''} onChange={f('smtp_from')} placeholder="Krajcara Admin <noreply@example.com>" />
          <div className="flex gap-2">
            <Button loading={saving} onClick={() => save('smtp', SMTP_KEYS)}><Save className="w-4 h-4" />Save</Button>
            <Button variant="secondary" loading={testing} onClick={testSmtp}><TestTube className="w-4 h-4" />Test connection</Button>
          </div>
        </div>
      </SettingsSection>

      {/* Retention */}
      <SettingsSection title="Data retention">
        <div className="space-y-4 max-w-lg">
          <Input label="Audit log retention (days)" type="number" autoComplete="off" value={settings.audit_retention_days || '365'} onChange={f('audit_retention_days')} />
          <Button loading={saving} onClick={() => save('retention', ['audit_retention_days'])}><Save className="w-4 h-4" />Save</Button>
        </div>
      </SettingsSection>
    </div>
  )
}
