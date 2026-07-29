import { useState, useEffect, useCallback } from 'react'
import {
  Download, Upload, Trash2, RefreshCw, HardDrive,
  AlertCircle, Eye, EyeOff, Archive, FileText, Shield, Check
} from 'lucide-react'
import api from '../lib/api'
import { Card, CardHeader, CardTitle, CardContent, Button, AlertBox, Spinner, Input } from '../components/shared/UI'
import { cn, formatDate } from '../lib/utils'

function fmtSize(bytes) {
  if (!bytes) return '0 B'
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB'
  if (bytes >= 1024)    return (bytes / 1024).toFixed(1) + ' KB'
  return bytes + ' B'
}

// ── Download backup with optional password ────────────────────────────────────
function DownloadSection({ hasEnv }) {
  const [password,  setPassword]  = useState('')
  const [showPass,  setShowPass]  = useState(false)
  const [includeEnv, setInclude]  = useState(false)

  const download = () => {
    const url = includeEnv && password
      ? `/api/backup/download?password=${encodeURIComponent(password)}`
      : '/api/backup/download'
    const a = document.createElement('a')
    a.href = url
    a.download = ''
    a.click()
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Download a full backup as a <strong>.zip</strong> file containing the database and optionally the encrypted <code className="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">.env</code> file.
      </p>

      {/* What's included info */}
      <div className="grid grid-cols-2 gap-3">
        <div className="flex items-start gap-2.5 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
          <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">krajcara-admin.db</p>
            <p className="text-xs text-gray-500 mt-0.5">All data — users, settings, monitors, licences, M365, Proxmox tokens, SSH servers, scripts, metrics, audit log</p>
          </div>
        </div>
        <div className={cn('flex items-start gap-2.5 p-3 border rounded-lg',
          includeEnv && password
            ? 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
            : 'bg-gray-50 dark:bg-gray-800/50 border-gray-200 dark:border-gray-700')}>
          {includeEnv && password
            ? <Check className="w-4 h-4 text-green-500 mt-0.5 flex-shrink-0" />
            : <Shield className="w-4 h-4 text-gray-400 mt-0.5 flex-shrink-0" />}
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">.env (encrypted)</p>
            <p className="text-xs text-gray-500 mt-0.5">APP_SECRET, GitHub token, port, SMTP config — needed for full restore to a new server</p>
          </div>
        </div>
      </div>

      {/* Include .env option */}
      {hasEnv && (
        <div className="space-y-3">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input type="checkbox" checked={includeEnv} onChange={e => setInclude(e.target.checked)}
              className="w-4 h-4 rounded text-brand" />
            <span className="text-sm text-gray-700 dark:text-gray-300">Include encrypted .env in backup</span>
          </label>

          {includeEnv && (
            <div className="pl-6">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Encryption password <span className="text-red-500">*</span>
              </label>
              <div className="relative max-w-sm">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="Enter a strong password"
                  autoComplete="new-password"
                  className="w-full px-3 py-2 pr-10 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand"
                />
                <button type="button" onClick={() => setShowPass(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
                ⚠ Remember this password — you will need it to restore .env on the new server. It cannot be recovered.
              </p>
            </div>
          )}
        </div>
      )}

      <Button onClick={download} disabled={includeEnv && !password}>
        <Archive className="w-4 h-4" />
        Download backup{includeEnv && password ? ' (DB + .env)' : ' (DB only)'}
      </Button>
    </div>
  )
}

// ── Restore section ───────────────────────────────────────────────────────────
function RestoreSection({ onDone }) {
  const [file,      setFile]      = useState(null)
  const [password,  setPassword]  = useState('')
  const [showPass,  setShowPass]  = useState(false)
  const [hasEnvInZip, setHasEnv]  = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [message,   setMessage]   = useState(null)

  const handleFile = async (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.name.endsWith('.db') && !f.name.endsWith('.zip')) {
      setMessage({ type: 'error', text: 'Only .zip or .db files are supported' })
      return
    }
    setFile(f)
    setMessage(null)
    setHasEnv(false)
    setPassword('')

    // Peek into ZIP to see if it has env.enc
    if (f.name.endsWith('.zip')) {
      const buf = await f.arrayBuffer()
      const text = new TextDecoder('utf-8', { fatal: false }).decode(buf)
      setHasEnv(text.includes('env.enc'))
    }
  }

  const doRestore = async () => {
    if (!file) return
    if (!window.confirm(`Restore from "${file.name}"?\n\nThe current database will be replaced and the server will restart.\nA pre-restore backup is created automatically.`)) return

    setRestoring(true); setMessage(null)
    try {
      const buf = await file.arrayBuffer()
      const headers = {
        Authorization: `Bearer ${(() => { try { return JSON.parse(localStorage.getItem('krajcara-admin-auth')).state?.accessToken } catch { return '' } })()}`,
        'x-filename': file.name,
      }
      if (password) headers['x-env-password'] = password

      const res  = await fetch('/api/backup/restore', { method: 'POST', body: buf, headers })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMessage({ type: 'success', text: data.message + ' Page will reload in 10 seconds...' })
      setTimeout(() => window.location.reload(), 10000)
    } catch (e) {
      setMessage({ type: 'error', text: e.message || 'Restore failed' })
    } finally { setRestoring(false) }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Restore from a <strong>.zip</strong> backup (recommended) or a legacy <strong>.db</strong> file.
        A pre-restore backup is created automatically before replacing the database.
      </p>

      {message && <AlertBox type={message.type}>{message.text}</AlertBox>}

      {/* File picker */}
      <div>
        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Backup file</label>
        <label className={cn('flex items-center gap-2 px-4 py-2.5 text-sm rounded-lg border cursor-pointer transition-colors w-fit',
          'border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300')}>
          <Upload className="w-4 h-4" />
          {file ? file.name : 'Choose file (.zip or .db)'}
          <input type="file" accept=".db,.zip" className="hidden" onChange={handleFile} />
        </label>
      </div>

      {/* Password field — only shown for ZIP with env.enc */}
      {file && hasEnvInZip && (
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            .env decryption password
          </label>
          <div className="relative max-w-sm">
            <input
              type={showPass ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Password used when creating backup"
              autoComplete="new-password"
              className="w-full px-3 py-2 pr-10 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand"
            />
            <button type="button" onClick={() => setShowPass(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
              {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Leave blank to restore only the database — .env will not be replaced.
          </p>
        </div>
      )}

      {file && (
        <Button variant="danger" loading={restoring} onClick={doRestore}>
          <Upload className="w-4 h-4" />
          Restore from {file.name}
        </Button>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BackupPage() {
  const [info,     setInfo]     = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [backing,  setBacking]  = useState(false)
  const [message,  setMessage]  = useState(null)
  const [deleting, setDeleting] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    api.get('/backup/info')
      .then(r => setInfo(r.data))
      .catch(e => setMessage({ type: 'error', text: e.response?.data?.error || 'Failed to load backup info' }))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  const triggerBackup = async () => {
    setBacking(true); setMessage(null)
    try {
      const r = await api.post('/backup/trigger')
      setMessage({ type: 'success', text: `Backup created: ${r.data.filename} (${fmtSize(r.data.size)})` })
      load()
    } catch (e) { setMessage({ type: 'error', text: e.response?.data?.error || 'Backup failed' }) }
    finally { setBacking(false) }
  }

  const deleteBackup = async (name) => {
    setDeleting(name)
    try { await api.delete(`/backup/${name}`); load() }
    catch (e) { setMessage({ type: 'error', text: e.response?.data?.error || 'Delete failed' }) }
    finally { setDeleting(null) }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Backup & Restore</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Database backup and restore — superadmin only</p>
      </div>

      {message && <AlertBox type={message.type}>{message.text}</AlertBox>}

      {loading
        ? <div className="flex justify-center py-12"><Spinner className="w-6 h-6" /></div>
        : (
          <>
            {/* DB stats */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Database</CardTitle>
                  <div className="flex items-center gap-2">
                    <Button variant="secondary" size="sm" loading={backing} onClick={triggerBackup}>
                      <HardDrive className="w-3.5 h-3.5" />Quick backup
                    </Button>
                    <Button variant="secondary" size="sm" onClick={load}>
                      <RefreshCw className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-4">
                  {[
                    { label: 'DB size',    value: fmtSize(info?.db_size) },
                    { label: 'Modified',   value: info?.db_modified ? new Date(info.db_modified).toLocaleString('en') : '—' },
                    { label: 'Saved backups', value: info?.backups?.length || 0 },
                  ].map(s => (
                    <div key={s.label} className="bg-gray-50 dark:bg-gray-800/50 rounded-lg px-4 py-3">
                      <p className="text-xs text-gray-400 mb-1">{s.label}</p>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{s.value}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Download */}
            <Card>
              <CardHeader><CardTitle>Download backup</CardTitle></CardHeader>
              <CardContent>
                <DownloadSection hasEnv={info?.has_env} />
              </CardContent>
            </Card>

            {/* Restore */}
            <Card>
              <CardHeader><CardTitle>Restore</CardTitle></CardHeader>
              <CardContent>
                <RestoreSection onDone={load} />
              </CardContent>
            </Card>

            {/* Saved backups list */}
            <Card>
              <CardHeader><CardTitle>Saved backups</CardTitle></CardHeader>
              {!info?.backups?.length
                ? <div className="text-center py-10 text-gray-400 text-sm">
                    <HardDrive className="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                    No backups yet
                  </div>
                : <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {info.backups.map(b => (
                    <div key={b.name} className="flex items-center gap-4 px-5 py-3">
                      {b.type === 'full'
                        ? <Archive className="w-4 h-4 text-brand flex-shrink-0" />
                        : <HardDrive className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{b.name}</p>
                          {b.type === 'full' && (
                            <span className="text-xs bg-brand/10 text-brand px-1.5 py-0.5 rounded font-medium flex-shrink-0">ZIP</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">{fmtSize(b.size)} · {new Date(b.created).toLocaleString('en')}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <a href={`/api/backup/download-saved/${b.name}`}
                          className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors" title="Download">
                          <Download className="w-3.5 h-3.5" />
                        </a>
                        <button onClick={() => deleteBackup(b.name)} disabled={deleting === b.name}
                          className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors" title="Delete">
                          {deleting === b.name ? <Spinner className="w-3.5 h-3.5" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              }
            </Card>

            {/* Info box */}
            <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl">
              <AlertCircle className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-blue-700 dark:text-blue-300 space-y-1">
                <p className="font-semibold">Backup notes</p>
                <p>Auto-backup runs daily at 03:00 — last 7 auto-backups are kept (database only).</p>
                <p>Manual quick backups are kept up to 10 — oldest deleted automatically.</p>
                <p>For full server migration, download a ZIP backup with encrypted .env included.</p>
                <p>A pre-restore backup is always created automatically before any restore operation.</p>
              </div>
            </div>
          </>
        )
      }
    </div>
  )
}
