import { useState, useEffect, useCallback } from 'react'
import { Download, Upload, Trash2, RefreshCw, HardDrive, Shield, AlertCircle } from 'lucide-react'
import api from '../lib/api'
import { Card, CardHeader, CardTitle, CardContent, Button, AlertBox, Spinner } from '../components/shared/UI'
import { cn, formatDate } from '../lib/utils'

function fmtSize(bytes) {
  if (!bytes) return '0 B'
  if (bytes >= 1048576) return (bytes / 1048576).toFixed(1) + ' MB'
  if (bytes >= 1024)    return (bytes / 1024).toFixed(1) + ' KB'
  return bytes + ' B'
}

export default function BackupPage() {
  const [info,      setInfo]      = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [backing,   setBacking]   = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [message,   setMessage]   = useState(null)
  const [deleting,  setDeleting]  = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    api.get('/backup/info').then(r => setInfo(r.data)).catch(e => setMessage({ type: 'error', text: e.response?.data?.error || 'Failed to load backup info' })).finally(() => setLoading(false))
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

  const downloadBackup = () => {
    const a = document.createElement('a')
    a.href = '/api/backup/download'
    a.download = ''
    a.click()
  }

  const deleteBackup = async (name) => {
    setDeleting(name)
    try {
      await api.delete(`/backup/${name}`)
      load()
    } catch (e) { setMessage({ type: 'error', text: e.response?.data?.error || 'Delete failed' }) }
    finally { setDeleting(null) }
  }

  const handleRestore = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.name.endsWith('.db')) { setMessage({ type: 'error', text: 'Only .db files are supported' }); return }
    if (!window.confirm(`Restore from "${file.name}"? The current database will be replaced and the server will restart. Make sure you have a recent backup.`)) return

    setRestoring(true); setMessage(null)
    try {
      const buf = await file.arrayBuffer()
      const res = await fetch('/api/backup/restore', {
        method: 'POST',
        body:   buf,
        headers: { Authorization: `Bearer ${localStorage.getItem('krajcara-admin-auth') ? JSON.parse(localStorage.getItem('krajcara-admin-auth')).state?.accessToken : ''}` }
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setMessage({ type: 'success', text: data.message + ' Page will reload in 10 seconds...' })
      setTimeout(() => window.location.reload(), 10000)
    } catch (e) { setMessage({ type: 'error', text: e.message || 'Restore failed' }) }
    finally { setRestoring(false) }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Backup & Restore</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">SQLite database backup and restore — superadmin only</p>
      </div>

      {message && <AlertBox type={message.type}>{message.text}</AlertBox>}

      {loading
        ? <div className="flex justify-center py-12"><Spinner className="w-6 h-6" /></div>
        : (
          <>
            {/* Current DB info */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Database</CardTitle>
                  <Button variant="secondary" size="sm" onClick={load}><RefreshCw className="w-3.5 h-3.5" /></Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                  {[
                    { label: 'Size',     value: fmtSize(info?.db_size) },
                    { label: 'Modified', value: info?.db_modified ? new Date(info.db_modified).toLocaleString('en') : '—' },
                    { label: 'Backups',  value: info?.backups?.length || 0 },
                  ].map(s => (
                    <div key={s.label} className="bg-gray-50 dark:bg-gray-800/50 rounded-lg px-4 py-3">
                      <p className="text-xs text-gray-400 mb-1">{s.label}</p>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{s.value}</p>
                    </div>
                  ))}
                </div>

                <div className="flex gap-2 flex-wrap">
                  <Button loading={backing} onClick={triggerBackup}>
                    <HardDrive className="w-4 h-4" />Create backup
                  </Button>
                  <Button variant="secondary" onClick={downloadBackup}>
                    <Download className="w-4 h-4" />Download current DB
                  </Button>
                  <label className={cn('inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors cursor-pointer',
                    restoring ? 'opacity-50 cursor-not-allowed' : 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700')}>
                    <Upload className="w-4 h-4" />
                    {restoring ? 'Restoring...' : 'Restore from file'}
                    <input type="file" accept=".db" className="hidden" onChange={handleRestore} disabled={restoring} />
                  </label>
                </div>
              </CardContent>
            </Card>

            {/* Backup list */}
            <Card>
              <CardHeader>
                <CardTitle>Saved backups</CardTitle>
              </CardHeader>
              {!info?.backups?.length
                ? <div className="text-center py-10 text-gray-400 text-sm">
                    <HardDrive className="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                    No backups yet — create one above
                  </div>
                : <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {info.backups.map(b => (
                    <div key={b.name} className="flex items-center gap-4 px-5 py-3">
                      <HardDrive className="w-4 h-4 text-gray-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{b.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{fmtSize(b.size)} · {new Date(b.created).toLocaleString('en')}</p>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <a href={`/api/backup/download`} download={b.name}
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

            {/* Warning */}
            <div className="flex items-start gap-3 p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl">
              <AlertCircle className="w-5 h-5 text-yellow-500 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-yellow-700 dark:text-yellow-300 space-y-1">
                <p className="font-semibold">Important notes</p>
                <p>Automatic daily backup runs at 03:00 — last 7 auto-backups are kept.</p>
                <p>Manual backups are kept up to 10 — oldest are deleted automatically.</p>
                <p>Restoring will replace the current database and restart the server. A pre-restore backup is created automatically.</p>
              </div>
            </div>
          </>
        )
      }
    </div>
  )
}
