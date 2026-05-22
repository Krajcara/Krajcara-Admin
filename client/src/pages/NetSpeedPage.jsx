import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Wifi, Download, Upload, Activity, Play, RefreshCw,
  Settings, CheckCircle, XCircle, Clock
} from 'lucide-react'
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid
} from 'recharts'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { Card, CardHeader, CardTitle, CardContent, Button, Input, Modal, AlertBox, Spinner, Badge } from '../components/shared/UI'
import { cn, formatDate } from '../lib/utils'

function fmt(val, unit = 'Mbps', decimals = 1) {
  if (val == null) return '—'
  return `${Number(val).toFixed(decimals)} ${unit}`
}

function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── Stat card with min/avg/max ────────────────────────────────────────────────
function SpeedCard({ label, icon: Icon, color, data, unit = 'Mbps' }) {
  const colorMap = {
    download: { bg: 'bg-blue-50 dark:bg-blue-900/20', icon: 'text-blue-500', bar: 'bg-blue-500', border: 'border-blue-200 dark:border-blue-800' },
    upload:   { bg: 'bg-green-50 dark:bg-green-900/20', icon: 'text-green-500', bar: 'bg-green-500', border: 'border-green-200 dark:border-green-800' },
    ping:     { bg: 'bg-purple-50 dark:bg-purple-900/20', icon: 'text-purple-500', bar: 'bg-purple-500', border: 'border-purple-200 dark:border-purple-800' },
  }
  const c = colorMap[color] || colorMap.download

  return (
    <div className={cn('rounded-xl border p-5', c.bg, c.border)}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Icon className={cn('w-5 h-5', c.icon)} />
          <span className="font-semibold text-gray-900 dark:text-white">{label}</span>
        </div>
        <span className="text-xs text-gray-400 uppercase font-medium">{unit}</span>
      </div>

      {data ? (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Min', value: data.min },
            { label: 'Avg', value: data.avg },
            { label: 'Max', value: data.max },
          ].map(s => (
            <div key={s.label} className="text-center bg-white/60 dark:bg-gray-900/40 rounded-lg py-2.5 px-1">
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-0.5">{s.label}</p>
              <p className="text-lg font-bold text-gray-900 dark:text-white leading-tight">
                {s.value != null ? Number(s.value).toFixed(unit === 'ms' ? 0 : 1) : '—'}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex justify-center py-4"><Spinner className="w-5 h-5" /></div>
      )}
    </div>
  )
}

// ── Ping mini chart ───────────────────────────────────────────────────────────
function PingChart({ tests }) {
  const data = [...tests]
    .reverse()
    .slice(-50)
    .map(t => ({
      time: fmtTime(t.created),
      ping: t.ping != null ? Math.round(t.ping) : null,
    }))
    .filter(t => t.ping != null)

  if (data.length === 0) return (
    <div className="flex items-center justify-center h-32 text-gray-400 text-sm">No data</div>
  )

  return (
    <ResponsiveContainer width="100%" height={140}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <defs>
          <linearGradient id="pingGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#a855f7" stopOpacity={0.25} />
            <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} />
        <XAxis dataKey="time" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} unit="ms" />
        <Tooltip
          contentStyle={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: 'none', background: '#111827', color: '#f9fafb' }}
          formatter={v => [`${v} ms`, 'Ping']}
        />
        <Area type="monotone" dataKey="ping" stroke="#a855f7" strokeWidth={1.5} fill="url(#pingGrad)" dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ── Download/Upload chart ─────────────────────────────────────────────────────
function SpeedChart({ tests }) {
  const data = [...tests]
    .reverse()
    .slice(-50)
    .map(t => ({
      time:     fmtTime(t.created),
      download: t.download != null ? Math.round(t.download * 10) / 10 : null,
      upload:   t.upload   != null ? Math.round(t.upload   * 10) / 10 : null,
    }))

  if (data.length < 2) return null

  return (
    <ResponsiveContainer width="100%" height={140}>
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} />
        <XAxis dataKey="time" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} unit=" M" />
        <Tooltip
          contentStyle={{ fontSize: 11, padding: '4px 8px', borderRadius: 6, border: 'none', background: '#111827', color: '#f9fafb' }}
          formatter={(v, name) => [`${v} Mbps`, name === 'download' ? 'Download' : 'Upload']}
        />
        <Line type="monotone" dataKey="download" stroke="#3b82f6" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="upload"   stroke="#22c55e" strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ── Config modal ──────────────────────────────────────────────────────────────
function ConfigModal({ config, onSave, onClose }) {
  const [form,    setForm]    = useState({ url: config?.url || '', password: '' })
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true)
    try { await api.post('/netspeed/config', form); onSave() }
    catch (err) { setError(err.response?.data?.error || 'Error saving config') }
    finally { setLoading(false) }
  }

  return (
    <Modal open onClose={onClose} title="MySpeed configuration" size="sm">
      <form onSubmit={submit} autoComplete="off" className="space-y-4">
        {error && <AlertBox type="error">{error}</AlertBox>}
        <AlertBox type="info">
          Enter the URL where MySpeed is running. Default port is <strong>5216</strong>.
        </AlertBox>
        <Input label="MySpeed URL *" autoComplete="off" value={form.url} onChange={f('url')}
          placeholder="http://192.168.1.10:5216" required />
        <Input label={config?.hasPassword ? 'Password (blank = keep current)' : 'Password (if set)'}
          type="password" autoComplete="new-password" value={form.password} onChange={f('password')}
          placeholder="Leave blank if no password" />
        <div className="flex gap-3 pt-2">
          <Button type="submit" loading={loading}>Save</Button>
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function NetSpeedPage() {
  const [config,     setConfig]     = useState(null)
  const [status,     setStatus]     = useState(null)
  const [stats,      setStats]      = useState(null)
  const [tests,      setTests]      = useState([])
  const [loading,    setLoading]    = useState(true)
  const [running,    setRunning]    = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [error,      setError]      = useState('')
  const [lastUpdate, setLastUpdate] = useState(null)
  const intervalRef = useRef(null)
  const { user } = useAuthStore()
  const canRun = ['superadmin', 'admin', 'operator'].includes(user?.role)

  const loadConfig = useCallback(() => {
    api.get('/netspeed/config').then(r => setConfig(r.data)).catch(() => {})
  }, [])

  const loadData = useCallback(async () => {
    try {
      const [testsRes, statsRes, statusRes] = await Promise.all([
        api.get('/netspeed/tests?limit=50'),
        api.get('/netspeed/statistics'),
        api.get('/netspeed/status'),
      ])
      setTests(testsRes.data || [])
      setStats(statsRes.data)
      setStatus(statusRes.data)
      setLastUpdate(new Date())
      setError('')
    } catch (err) {
      setError(err.response?.data?.error || 'Cannot reach MySpeed')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadConfig() }, [loadConfig])

  useEffect(() => {
    clearInterval(intervalRef.current)
    if (!config?.configured) { setLoading(false); return }
    loadData()
    // Auto-refresh every 60s
    intervalRef.current = setInterval(loadData, 60000)
    return () => clearInterval(intervalRef.current)
  }, [config?.configured, loadData])

  // Poll while test is running
  useEffect(() => {
    if (!status?.running) return
    const poll = setInterval(async () => {
      const r = await api.get('/netspeed/status').catch(() => null)
      if (r?.data?.running === false) {
        clearInterval(poll)
        setRunning(false)
        loadData()
      }
    }, 3000)
    return () => clearInterval(poll)
  }, [status?.running, loadData])

  const runTest = async () => {
    setRunning(true); setError('')
    try {
      await api.post('/netspeed/run')
      setStatus(s => ({ ...s, running: true }))
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to start test')
      setRunning(false)
    }
  }

  // Compute stats from tests if /statistics not available
  const computedStats = stats || (() => {
    const valid = tests.filter(t => !t.error && t.download)
    if (!valid.length) return null
    const calc = (key) => {
      const vals = valid.map(t => t[key]).filter(v => v != null)
      if (!vals.length) return { min: null, avg: null, max: null }
      return {
        min: Math.round(Math.min(...vals) * 10) / 10,
        avg: Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10,
        max: Math.round(Math.max(...vals) * 10) / 10,
      }
    }
    return { download: calc('download'), upload: calc('upload'), ping: calc('ping') }
  })()

  const validTests = tests.filter(t => !t.error)
  const lastTest   = validTests[0]

  if (!config) return <div className="flex justify-center py-20"><Spinner className="w-8 h-8" /></div>

  if (!config.configured) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-white">Net Speed</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">MySpeed integration</p>
          </div>
        </div>
        <div className="border-2 border-dashed border-gray-300 dark:border-gray-700 rounded-xl p-12 text-center">
          <Wifi className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-4" />
          <p className="text-lg font-medium text-gray-600 dark:text-gray-400">MySpeed not configured</p>
          <p className="text-sm text-gray-400 mt-1 mb-4">
            Connect to your <a href="https://github.com/gnmyt/myspeed" target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">MySpeed</a> instance to see speed test results.
          </p>
          {canRun && <Button onClick={() => setShowConfig(true)}><Settings className="w-4 h-4" />Configure MySpeed</Button>}
        </div>
        {showConfig && <ConfigModal config={config} onSave={() => { setShowConfig(false); loadConfig() }} onClose={() => setShowConfig(false)} />}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Net Speed</h1>
          <div className="flex items-center gap-2 mt-0.5">
            <p className="text-sm text-gray-500 dark:text-gray-400">MySpeed · {config.url}</p>
            {status && !status.unreachable && (
              <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium',
                status.running ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' :
                status.paused  ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' :
                'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300')}>
                {status.running ? 'Test running...' : status.paused ? 'Paused' : 'Active'}
              </span>
            )}
            {status?.unreachable && <span className="text-xs text-red-500">Unreachable</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lastUpdate && <span className="text-xs text-gray-400">{lastUpdate.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}</span>}
          <Button variant="secondary" size="sm" onClick={loadData}><RefreshCw className="w-3.5 h-3.5" /></Button>
          {canRun && (
            <Button size="sm" loading={running || status?.running} onClick={runTest}>
              <Play className="w-3.5 h-3.5" />
              {running || status?.running ? 'Running...' : 'Run test'}
            </Button>
          )}
          {canRun && <Button variant="secondary" size="sm" onClick={() => setShowConfig(true)}><Settings className="w-3.5 h-3.5" /></Button>}
        </div>
      </div>

      {error && <AlertBox type="error">{error}</AlertBox>}

      {running || status?.running ? (
        <AlertBox type="info">
          <div className="flex items-center gap-2">
            <Spinner className="w-4 h-4" />
            Speed test in progress — results will appear automatically when done.
          </div>
        </AlertBox>
      ) : null}

      {loading && <div className="flex justify-center py-12"><Spinner className="w-8 h-8" /></div>}

      {!loading && (
        <>
          {/* Stat cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <SpeedCard label="Download" icon={Download} color="download" data={computedStats?.download} unit="Mbps" />
            <SpeedCard label="Upload"   icon={Upload}   color="upload"   data={computedStats?.upload}   unit="Mbps" />
            <SpeedCard label="Ping"     icon={Activity} color="ping"     data={computedStats?.ping}     unit="ms" />
          </div>

          {/* Charts */}
          {validTests.length > 1 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Ping</CardTitle>
                    <span className="text-xs text-gray-400">last {Math.min(validTests.length, 50)} tests</span>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <PingChart tests={validTests} />
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Download / Upload</CardTitle>
                    <div className="flex items-center gap-3 text-xs">
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />DL</span>
                      <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />UL</span>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <SpeedChart tests={validTests} />
                </CardContent>
              </Card>
            </div>
          )}

          {/* Test history table */}
          {validTests.length > 0 && (
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Recent tests</CardTitle>
                  <span className="text-xs text-gray-400">{validTests.length} result{validTests.length !== 1 ? 's' : ''}</span>
                </div>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Time</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Download</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Upload</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Ping</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Jitter</th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {validTests.slice(0, 20).map(t => (
                      <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtTime(t.created)}</td>
                        <td className="px-4 py-2.5 font-medium text-blue-600 dark:text-blue-400">{fmt(t.download)}</td>
                        <td className="px-4 py-2.5 font-medium text-green-600 dark:text-green-400">{fmt(t.upload)}</td>
                        <td className="px-4 py-2.5 font-medium text-purple-600 dark:text-purple-400">{fmt(t.ping, 'ms', 0)}</td>
                        <td className="px-4 py-2.5 text-gray-500 text-xs">{t.jitter != null ? `${Math.round(t.jitter)} ms` : '—'}</td>
                        <td className="px-4 py-2.5">
                          <Badge className={cn('text-xs', t.type === 'auto' ? 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' : 'bg-brand/10 text-brand')}>
                            {t.type || 'auto'}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {validTests.length === 0 && !error && (
            <Card>
              <div className="text-center py-12">
                <Wifi className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="font-medium text-gray-600 dark:text-gray-400">No speed tests yet</p>
                <p className="text-sm text-gray-400 mt-1 mb-4">Run a test to see results here.</p>
                {canRun && <Button onClick={runTest} loading={running}><Play className="w-4 h-4" />Run test</Button>}
              </div>
            </Card>
          )}
        </>
      )}

      {showConfig && (
        <ConfigModal config={config} onSave={() => { setShowConfig(false); loadConfig() }} onClose={() => setShowConfig(false)} />
      )}
    </div>
  )
}
