import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Activity, Shield, Database, Users, Globe } from 'lucide-react'
import api from '../lib/api'
import { Card, CardHeader, CardTitle, CardContent, Spinner, AlertBox } from '../components/shared/UI'
import { cn } from '../lib/utils'

const PERIODS = [
  { value: 'LastHour',  label: 'Last hour' },
  { value: 'LastDay',   label: 'Last 24h' },
  { value: 'LastWeek',  label: 'Last 7 days' },
  { value: 'LastMonth', label: 'Last 30 days' },
]

function fmtNum(n) {
  if (!n) return '0'
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000)    return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

function StatCard({ icon: Icon, label, value, color }) {
  const colors = {
    blue:   'text-blue-500 bg-blue-50 dark:bg-blue-900/20',
    green:  'text-green-500 bg-green-50 dark:bg-green-900/20',
    purple: 'text-purple-500 bg-purple-50 dark:bg-purple-900/20',
    red:    'text-red-500 bg-red-50 dark:bg-red-900/20',
    amber:  'text-amber-500 bg-amber-50 dark:bg-amber-900/20',
  }
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
      <div className="flex items-center gap-3">
        <div className={cn('p-2 rounded-lg', colors[color])}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <p className="text-xs text-gray-400">{label}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">{fmtNum(value)}</p>
        </div>
      </div>
    </div>
  )
}

function TopList({ title, items, nameKey = 'name', valueKey = 'hits', color = 'bg-blue-500' }) {
  if (!items?.length) return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">{title}</h3>
      <p className="text-sm text-gray-400">No data</p>
    </div>
  )
  const max = Math.max(...items.map(i => i[valueKey] || 0))
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">{title}</h3>
      <div className="space-y-2">
        {items.map((item, idx) => (
          <div key={idx}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-xs text-gray-600 dark:text-gray-400 truncate max-w-[70%]">
                {item[nameKey] || '(empty)'}
              </span>
              <span className="text-xs font-mono text-gray-500 flex-shrink-0 ml-2">
                {fmtNum(item[valueKey])}
              </span>
            </div>
            <div className="h-1.5 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
              <div
                className={cn('h-full rounded-full', color)}
                style={{ width: `${Math.round((item[valueKey] / max) * 100)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function MiniChart({ data, labels }) {
  if (!data?.length) return null
  const max = Math.max(...data)
  const h = 60
  const w = 100
  const step = w / (data.length - 1)

  const points = data.map((v, i) => {
    const x = i * step
    const y = max > 0 ? h - (v / max) * h : h
    return `${x},${y}`
  }).join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-20" preserveAspectRatio="none">
      <polyline
        points={points}
        fill="none"
        stroke="#3b82f6"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

export default function DnsAnalyticsPage() {
  const [period,   setPeriod]   = useState('LastDay')
  const [servers,  setServers]  = useState([])
  const [selected, setSelected] = useState(null)
  const [stats,    setStats]    = useState(null)
  const [tops,     setTops]     = useState({})
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState(null)

  // Load DNS servers from app
  useEffect(() => {
    api.get('/dns/local').then(r => {
      const srv = r.data || []
      setServers(srv)
      if (srv.length) setSelected(srv.find(s => s.role === 'primary') || srv[0])
    }).catch(() => {})
  }, [])

  const load = useCallback(async () => {
    if (!selected) return
    setLoading(true); setError(null)
    try {
      const [statsRes, domainsRes, clientsRes, blockedRes] = await Promise.allSettled([
        api.get(`/dns/analytics/stats?serverId=${selected.id}&period=${period}`),
        api.get(`/dns/analytics/top?serverId=${selected.id}&period=${period}&type=TopDomains`),
        api.get(`/dns/analytics/top?serverId=${selected.id}&period=${period}&type=TopClients`),
        api.get(`/dns/analytics/top?serverId=${selected.id}&period=${period}&type=TopBlockedDomains`),
      ])
      if (statsRes.status === 'fulfilled')   setStats(statsRes.value.data)
      setTops({
        domains: domainsRes.status === 'fulfilled'  ? domainsRes.value.data?.topDomains || []        : [],
        clients: clientsRes.status === 'fulfilled'  ? clientsRes.value.data?.topClients || []        : [],
        blocked: blockedRes.status === 'fulfilled'  ? blockedRes.value.data?.topBlockedDomains || [] : [],
      })
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load DNS analytics')
    } finally { setLoading(false) }
  }, [selected, period])

  useEffect(() => { load() }, [load])

  const s = stats?.stats || {}
  const chartData  = stats?.mainChartData?.data?.totalQueries || []
  const chartLabels = stats?.mainChartData?.labels || []

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">DNS Analytics</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Technitium DNS query statistics
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Server selector */}
          {servers.length > 1 && (
            <select
              value={selected?.id || ''}
              onChange={e => setSelected(servers.find(s => s.id === parseInt(e.target.value)))}
              className="text-sm px-3 py-1.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            >
              {servers.map(s => (
                <option key={s.id} value={s.id}>{s.label || s.role} ({s.ip})</option>
              ))}
            </select>
          )}
          {/* Period selector */}
          <div className="flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            {PERIODS.map(p => (
              <button key={p.value}
                onClick={() => setPeriod(p.value)}
                className={cn('px-3 py-1.5 text-xs font-medium transition-colors',
                  period === p.value
                    ? 'bg-brand text-white'
                    : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700')}>
                {p.label}
              </button>
            ))}
          </div>
          <button onClick={load} disabled={loading}
            className="p-2 text-gray-400 hover:text-brand rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {error && <AlertBox type="error">{error}</AlertBox>}

      {loading && !stats ? (
        <div className="flex justify-center py-16"><Spinner className="w-6 h-6" /></div>
      ) : (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <StatCard icon={Activity} label="Total queries"  value={s.totalQueries}   color="blue"   />
            <StatCard icon={Globe}    label="No error"       value={s.totalNoError}    color="green"  />
            <StatCard icon={Database} label="Cached"         value={s.totalCached}     color="purple" />
            <StatCard icon={Shield}   label="Blocked"        value={s.totalBlocked}    color="red"    />
            <StatCard icon={Users}    label="Clients"        value={s.totalClients}    color="amber"  />
            <StatCard icon={Activity} label="NX Domain"      value={s.totalNxDomain}   color="blue"   />
          </div>

          {/* Chart */}
          {chartData.length > 0 && (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
                Queries over time
              </h3>
              <MiniChart data={chartData} labels={chartLabels} />
              <div className="flex justify-between mt-1">
                <span className="text-xs text-gray-400">{chartLabels[0]}</span>
                <span className="text-xs text-gray-400">{chartLabels[chartLabels.length - 1]}</span>
              </div>
            </div>
          )}

          {/* Top 10 lists */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <TopList
              title="Top 10 domains"
              items={tops.domains?.slice(0, 10)}
              color="bg-blue-500"
            />
            <TopList
              title="Top 10 clients"
              items={tops.clients?.slice(0, 10)}
              color="bg-purple-500"
            />
            <TopList
              title="Top 10 blocked domains"
              items={tops.blocked?.slice(0, 10)}
              color="bg-red-500"
            />
          </div>

          {/* Extra stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Server Failure', value: s.totalServerFailure },
              { label: 'Authoritative', value: s.totalAuthoritative },
              { label: 'Recursive',     value: s.totalRecursive },
              { label: 'Dropped',       value: s.totalDropped },
            ].map(item => (
              <div key={item.label} className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-400 mb-1">{item.label}</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white">{fmtNum(item.value)}</p>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
