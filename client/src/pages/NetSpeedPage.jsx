import { useState, useEffect, useCallback, useRef } from 'react'
import { Download, Upload, Activity, Play, RefreshCw, Trash2 } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid
} from 'recharts'
import api from '../lib/api'
import { useSocket } from '../hooks/useSocket'
import { useAuthStore } from '../store/authStore'
import { Card, CardHeader, CardTitle, CardContent, Button, AlertBox, Spinner, Badge } from '../components/shared/UI'
import { cn, formatDate } from '../lib/utils'

// ── Helpers ───────────────────────────────────────────────────────────────────
function round(v, d = 1) {
  if (v == null) return null
  return Math.round(v * Math.pow(10, d)) / Math.pow(10, d)
}
function fmtVal(v, unit, d = 1) {
  if (v == null) return '—'
  return `${round(v, d)} ${unit}`
}
function fmtTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ label, icon: Icon, stats, unit, decimals = 1, theme }) {
  const themes = {
    blue:   { wrap: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800', icon: 'text-blue-500', val: 'text-blue-700 dark:text-blue-300' },
    green:  { wrap: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800', icon: 'text-green-500', val: 'text-green-700 dark:text-green-300' },
    purple: { wrap: 'bg-purple-50 dark:bg-purple-900/20 border-purple-200 dark:border-purple-800', icon: 'text-purple-500', val: 'text-purple-700 dark:text-purple-300' },
  }
  const t = themes[theme] || themes.blue
  const items = [
    { label: 'Min', value: stats?.min },
    { label: 'Avg', value: stats?.avg },
    { label: 'Max', value: stats?.max },
  ]
  return (
    <div className={cn('rounded-xl border p-5', t.wrap)}>
      <div className="flex items-center gap-2 mb-4">
        <Icon className={cn('w-5 h-5', t.icon)} />
        <span className="font-semibold text-gray-900 dark:text-white">{label}</span>
        <span className="text-xs text-gray-400 ml-auto font-medium">{unit}</span>
      </div>
      {stats ? (
        <div className="grid grid-cols-3 gap-2">
          {items.map(s => (
            <div key={s.label} className="text-center bg-white/60 dark:bg-gray-900/40 rounded-lg py-3">
              <p className="text-xs text-gray-400 mb-1">{s.label}</p>
              <p className={cn('text-xl font-bold leading-tight', t.val)}>
                {s.value != null ? round(s.value, decimals) : '—'}
              </p>
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          {items.map(s => (
            <div key={s.label} className="text-center bg-white/60 dark:bg-gray-900/40 rounded-lg py-3">
              <p className="text-xs text-gray-400 mb-1">{s.label}</p>
              <p className="text-xl font-bold text-gray-300 dark:text-gray-600">—</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Ping chart ────────────────────────────────────────────────────────────────
function PingChart({ tests }) {
  const data = [...tests]
    .filter(t => t.status === 'done' && t.ping != null)
    .reverse()
    .slice(-40)
    .map(t => ({ time: fmtTime(t.created_at), ping: Math.round(t.ping) }))

  if (data.length < 2) return (
    <div className="flex items-center justify-center h-28 text-sm text-gray-400">
      {data.length === 0 ? 'No ping data yet' : 'Need more tests for chart'}
    </div>
  )

  return (
    <ResponsiveContainer width="100%" height={120}>
      <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -16 }}>
        <defs>
          <linearGradient id="pingGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor="#a855f7" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.05} />
        <XAxis dataKey="time" tick={{ fontSize: 9 }} tickLine={false} axisLine={false}
          interval="preserveStartEnd" />
        <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} unit="ms" width={36} />
        <Tooltip
          contentStyle={{ fontSize: 11, padding: '3px 8px', borderRadius: 6, border: 'none', background: '#111827', color: '#f9fafb' }}
          formatter={v => [`${v} ms`, 'Ping']}
          labelStyle={{ fontSize: 10, color: '#9ca3af' }}
        />
        <Area type="monotone" dataKey="ping" stroke="#a855f7" strokeWidth={2}
          fill="url(#pingGrad)" dot={false} isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

// ── Running indicator ─────────────────────────────────────────────────────────
function RunningBanner() {
  return (
    <div className="rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 px-5 py-4 flex items-center gap-3">
      <div className="flex gap-1 flex-shrink-0">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
      <div>
        <p className="text-sm font-semibold text-blue-700 dark:text-blue-300">Speed test in progress</p>
        <p className="text-xs text-blue-500 dark:text-blue-400 mt-0.5">Testing via Cloudflare — this takes 30–60 seconds</p>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function NetSpeedPage() {
  const [tests,   setTests]   = useState([])
  const [stats,   setStats]   = useState(null)
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [days,    setDays]    = useState(30)
  const { user } = useAuthStore()
  const canRun = ['superadmin', 'admin', 'operator'].includes(user?.role)

  const loadData = useCallback(async () => {
    try {
      const [testsRes, statsRes, statusRes] = await Promise.all([
        api.get('/netspeed/tests?limit=50'),
        api.get(`/netspeed/stats?days=${days}`),
        api.get('/netspeed/status'),
      ])
      setTests(testsRes.data || [])
      setStats(statsRes.data)
      setRunning(statusRes.data?.running || false)
      setError('')
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [days])

  useEffect(() => { loadData() }, [loadData])

  // Socket.io — real-time updates
  useSocket({
    'netspeed:started': ()          => { setRunning(true) },
    'netspeed:done':    ({ test })  => {
      setRunning(false)
      setTests(prev => [test, ...prev].slice(0, 50))
      // Reload stats to recalculate min/avg/max
      api.get(`/netspeed/stats?days=${days}`).then(r => setStats(r.data)).catch(() => {})
    },
    'netspeed:error':   ({ error: e }) => { setRunning(false); setError(e) },
  })

  const runTest = async () => {
    if (running) return
    setError('')
    try {
      await api.post('/netspeed/run')
      setRunning(true)
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to start test')
    }
  }

  const deleteTest = async (id) => {
    await api.delete(`/netspeed/tests/${id}`)
    setTests(prev => prev.filter(t => t.id !== id))
  }

  const donTests  = tests.filter(t => t.status === 'done')
  const lastTest  = donTests[0]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Net Speed</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Internet speed tests via Cloudflare
            {lastTest && ` · Last test: ${fmtTime(lastTest.created_at)}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Days filter */}
          <select value={days} onChange={e => setDays(parseInt(e.target.value))}
            className="text-xs px-2 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-brand">
            {[7, 14, 30, 90].map(d => <option key={d} value={d}>Last {d} days</option>)}
          </select>
          <Button variant="secondary" size="sm" onClick={loadData} disabled={running}>
            <RefreshCw className="w-3.5 h-3.5" />
          </Button>
          {canRun && (
            <Button size="sm" onClick={runTest} disabled={running}>
              <Play className="w-3.5 h-3.5" />
              {running ? 'Running...' : 'Run test'}
            </Button>
          )}
        </div>
      </div>

      {error && <AlertBox type="error">{error}</AlertBox>}

      {running && <RunningBanner />}

      {loading
        ? <div className="flex justify-center py-16"><Spinner className="w-8 h-8" /></div>
        : (
          <>
            {/* Stat cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard label="Download" icon={Download} stats={stats?.download} unit="Mbps" decimals={1} theme="blue" />
              <StatCard label="Upload"   icon={Upload}   stats={stats?.upload}   unit="Mbps" decimals={1} theme="green" />
              <StatCard label="Ping"     icon={Activity} stats={stats?.ping}     unit="ms"   decimals={0} theme="purple" />
            </div>

            {stats?.count === 0 && (
              <AlertBox type="info">
                No test results yet for the last {days} days.
                {canRun && ' Click "Run test" to run the first test.'}
                {' '}Tests also run automatically every hour.
              </AlertBox>
            )}

            {/* Ping chart */}
            {donTests.length > 0 && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Ping over time</CardTitle>
                    <span className="text-xs text-gray-400">last {Math.min(donTests.length, 40)} tests</span>
                  </div>
                </CardHeader>
                <CardContent className="pt-0 pb-3">
                  <PingChart tests={donTests} />
                </CardContent>
              </Card>
            )}

            {/* History table */}
            {tests.length > 0 && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Test history</CardTitle>
                    <span className="text-xs text-gray-400">{stats?.count ?? donTests.length} test{stats?.count !== 1 ? 's' : ''} in last {days} days</span>
                  </div>
                </CardHeader>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Download</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Upload</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Ping</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">By</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {tests.map(t => (
                        <tr key={t.id} className={cn('hover:bg-gray-50 dark:hover:bg-gray-800/50', t.status === 'running' && 'opacity-60')}>
                          <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtTime(t.created_at)}</td>
                          <td className="px-4 py-2.5 font-semibold text-blue-600 dark:text-blue-400">
                            {t.status === 'done' ? fmtVal(t.download, 'Mbps') : '—'}
                          </td>
                          <td className="px-4 py-2.5 font-semibold text-green-600 dark:text-green-400">
                            {t.status === 'done' ? fmtVal(t.upload, 'Mbps') : '—'}
                          </td>
                          <td className="px-4 py-2.5 font-semibold text-purple-600 dark:text-purple-400">
                            {t.status === 'done' ? fmtVal(t.ping, 'ms', 0) : '—'}
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge className={cn('text-xs',
                              t.triggered_by === 'auto'
                                ? 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                                : 'bg-brand/10 text-brand')}>
                              {t.triggered_by}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5">
                            {t.status === 'running' && (
                              <div className="flex items-center gap-1.5 text-blue-500">
                                <Spinner className="w-3.5 h-3.5" />
                                <span className="text-xs">Running</span>
                              </div>
                            )}
                            {t.status === 'done' && (
                              <span className="text-xs text-green-600 dark:text-green-400 font-medium">Done</span>
                            )}
                            {t.status === 'error' && (
                              <span className="text-xs text-red-500" title={t.error}>Failed</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {canRun && t.status !== 'running' && (
                              <button onClick={() => deleteTest(t.id)}
                                className="p-1.5 text-gray-300 hover:text-red-500 rounded transition-colors">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </>
        )
      }
    </div>
  )
}
