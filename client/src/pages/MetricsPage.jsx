import { useState, useEffect, useCallback } from 'react'
import { Activity, Server, HardDrive, Cpu, RefreshCw, ChevronDown } from 'lucide-react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend
} from 'recharts'
import api from '../lib/api'
import { cn } from '../lib/utils'
import { Card, CardHeader, CardTitle, CardContent, Spinner } from '../components/shared/UI'

const PERIODS = [
  { label: '1h',  value: '1h'  },
  { label: '6h',  value: '6h'  },
  { label: '24h', value: '24h' },
  { label: '7d',  value: '7d'  },
  { label: '30d', value: '30d' },
]

const COLORS = {
  cpu:  '#3b82f6',
  mem:  '#a855f7',
  disk: '#f97316',
}

// ── Format X axis label based on period ──────────────────────────────────────
function fmtTime(t, period) {
  const d = new Date(t + (t.endsWith('Z') ? '' : 'Z'))
  if (period === '1h' || period === '6h') {
    return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
  }
  if (period === '24h') {
    return d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
  }
  return d.toLocaleDateString('en', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function tickInterval(data, period) {
  const map = { '1h': 4, '6h': 6, '24h': 6, '7d': 12, '30d': 24 }
  return Math.max(1, Math.floor(data.length / (map[period] || 6)))
}

// ── Small stat badge ──────────────────────────────────────────────────────────
function StatBadge({ label, value, color }) {
  return (
    <div className="text-center">
      <p className={cn('text-lg font-bold', color)}>{value != null ? `${value}%` : '—'}</p>
      <p className="text-xs text-gray-400">{label}</p>
    </div>
  )
}

// ── Single VM chart card ──────────────────────────────────────────────────────
function VMChart({ vm, period }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(false)
  const [open,    setOpen]    = useState(false)

  const load = useCallback(() => {
    if (!open) return
    setLoading(true)
    api.get(`/metrics/vms/${vm.vmid}?period=${period}&node=${vm.node}`)
      .then(r => setData(r.data))
      .finally(() => setLoading(false))
  }, [vm.vmid, vm.node, period, open])

  useEffect(() => { load() }, [load])

  const chartData = (data?.data || []).map(d => ({
    t:    fmtTime(d.t, period),
    CPU:  d.cpu,
    RAM:  d.mem,
    Disk: d.disk,
  }))

  const latest = data?.data?.[data.data.length - 1]

  return (
    <Card>
      {/* Header — always visible, click to expand */}
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-3.5 hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors rounded-xl text-left">
        <div className="flex items-center gap-3">
          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center',
            vm.type === 'lxc' ? 'bg-purple-100 dark:bg-purple-900/30' : 'bg-blue-100 dark:bg-blue-900/30')}>
            <Server className={cn('w-4 h-4', vm.type === 'lxc' ? 'text-purple-600' : 'text-blue-600')} />
          </div>
          <div>
            <p className="font-semibold text-gray-900 dark:text-white text-sm">{vm.name}</p>
            <p className="text-xs text-gray-400">{vm.node} · #{vm.vmid} · {vm.type.toUpperCase()}</p>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-5 mr-2">
            <StatBadge label="CPU" value={vm.cpu_pct} color="text-blue-600 dark:text-blue-400" />
            <StatBadge label="RAM" value={vm.mem_pct} color="text-purple-600 dark:text-purple-400" />
            <StatBadge label="Disk" value={vm.disk_pct || null} color="text-orange-600 dark:text-orange-400" />
          </div>
          <ChevronDown className={cn('w-4 h-4 text-gray-400 transition-transform', open && 'rotate-180')} />
        </div>
      </button>

      {/* Expanded chart */}
      {open && (
        <div className="border-t border-gray-100 dark:border-gray-800 px-5 pb-5 pt-4">
          {loading ? (
            <div className="flex justify-center py-8"><Spinner className="w-5 h-5" /></div>
          ) : chartData.length < 2 ? (
            <p className="text-sm text-gray-400 text-center py-6">
              Not enough data yet. Metrics are collected every 5 minutes.
            </p>
          ) : (
            <>
              {/* Summary stats for period */}
              {data && (
                <div className="grid grid-cols-3 gap-4 mb-4">
                  {[
                    { label: 'CPU avg', value: Math.round(data.data.reduce((a,d)=>a+d.cpu,0)/data.data.length), color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20' },
                    { label: 'RAM avg', value: Math.round(data.data.reduce((a,d)=>a+d.mem,0)/data.data.length), color: 'text-purple-600 dark:text-purple-400', bg: 'bg-purple-50 dark:bg-purple-900/20' },
                    { label: 'CPU peak', value: Math.max(...data.data.map(d=>d.cpu)), color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20' },
                  ].map(s => (
                    <div key={s.label} className={cn('rounded-lg px-4 py-2.5 text-center', s.bg)}>
                      <p className={cn('text-xl font-bold', s.color)}>{s.value}%</p>
                      <p className="text-xs text-gray-500">{s.label}</p>
                    </div>
                  ))}
                </div>
              )}

              {/* Chart */}
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} />
                  <XAxis dataKey="t" tick={{ fontSize: 10 }} tickLine={false} axisLine={false}
                    interval={tickInterval(chartData, period)} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false}
                    tickFormatter={v => `${v}%`} />
                  <Tooltip
                    contentStyle={{ fontSize: 11, borderRadius: 8, border: 'none', background: '#111827', color: '#f9fafb' }}
                    formatter={(v, name) => [`${v}%`, name]}
                  />
                  <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                  <Line type="monotone" dataKey="CPU"  stroke={COLORS.cpu}  strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="RAM"  stroke={COLORS.mem}  strokeWidth={1.5} dot={false} />
                  <Line type="monotone" dataKey="Disk" stroke={COLORS.disk} strokeWidth={1.5} dot={false} />
                </LineChart>
              </ResponsiveContainer>

              {/* Disk info */}
              {latest?.diskMax > 0 && (
                <p className="text-xs text-gray-400 mt-2 text-right">
                  Disk: {latest.diskUsed?.toFixed(1)} / {latest.diskMax?.toFixed(1)} GB
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Card>
  )
}

// ── Node summary chart ────────────────────────────────────────────────────────
function NodeChart({ nodeName, period }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    api.get(`/metrics/nodes?period=${period}&node=${nodeName}`)
      .then(r => setData(r.data.nodes[nodeName] || []))
      .finally(() => setLoading(false))
  }, [nodeName, period])

  const chartData = (data || []).map(d => ({
    t:   fmtTime(d.t, period),
    CPU: d.cpu,
    RAM: d.mem,
  }))

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Server className="w-4 h-4 text-gray-400" />
          <CardTitle>{nodeName}</CardTitle>
          {data && data.length > 0 && (
            <span className="text-xs text-gray-400 ml-2">
              avg CPU {Math.round(data.reduce((a,d)=>a+d.cpu,0)/data.length)}% ·
              avg RAM {Math.round(data.reduce((a,d)=>a+d.mem,0)/data.length)}%
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-4">
        {loading ? <div className="flex justify-center py-6"><Spinner className="w-5 h-5" /></div>
        : chartData.length < 2 ? <p className="text-sm text-gray-400 text-center py-4">No data yet</p>
        : (
          <ResponsiveContainer width="100%" height={160}>
            <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} />
              <XAxis dataKey="t" tick={{ fontSize: 9 }} tickLine={false} axisLine={false}
                interval={tickInterval(chartData, period)} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 9 }} tickLine={false} axisLine={false}
                tickFormatter={v => `${v}%`} />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: 'none', background: '#111827', color: '#f9fafb' }}
                formatter={(v, name) => [`${v}%`, name]} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="CPU" stroke={COLORS.cpu} strokeWidth={1.5} dot={false} />
              <Line type="monotone" dataKey="RAM" stroke={COLORS.mem} strokeWidth={1.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function MetricsPage() {
  const [vms,     setVms]     = useState([])
  const [loading, setLoading] = useState(true)
  const [period,  setPeriod]  = useState('24h')
  const [search,  setSearch]  = useState('')
  const [view,    setView]    = useState('vms') // vms | nodes
  const [nodes,   setNodes]   = useState([])

  const load = useCallback(() => {
    setLoading(true)
    Promise.all([
      api.get('/metrics/vms'),
      api.get(`/metrics/nodes?period=${period}`),
    ]).then(([vmsRes, nodesRes]) => {
      setVms(vmsRes.data)
      setNodes(Object.keys(nodesRes.data.nodes || {}))
    }).finally(() => setLoading(false))
  }, [period])

  useEffect(() => { load() }, [load])

  const filtered = vms.filter(v =>
    v.name?.toLowerCase().includes(search.toLowerCase()) ||
    v.node?.toLowerCase().includes(search.toLowerCase())
  )

  // Group by node
  const byNode = {}
  for (const vm of filtered) {
    if (!byNode[vm.node]) byNode[vm.node] = []
    byNode[vm.node].push(vm)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Metrics History</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            CPU, RAM and disk trends · collected every 5 minutes · retained 7 days
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex gap-1">
            {[{ k: 'vms', l: 'VMs' }, { k: 'nodes', l: 'Nodes' }].map(v => (
              <button key={v.k} onClick={() => setView(v.k)}
                className={cn('px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                  view === v.k ? 'bg-brand text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400')}>
                {v.l}
              </button>
            ))}
          </div>
          {/* Period */}
          <div className="flex gap-1">
            {PERIODS.map(p => (
              <button key={p.value} onClick={() => setPeriod(p.value)}
                className={cn('px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors',
                  period === p.value ? 'bg-brand text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400')}>
                {p.label}
              </button>
            ))}
          </div>
          <button onClick={load} className="p-1.5 text-gray-400 hover:text-brand rounded-lg transition-colors">
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Search */}
      {view === 'vms' && (
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search VMs or nodes..."
          className="max-w-xs w-full px-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand" />
      )}

      {loading ? (
        <div className="flex justify-center py-20"><Spinner className="w-8 h-8" /></div>
      ) : (
        <>
          {/* VMs view */}
          {view === 'vms' && (
            !vms.length ? (
              <Card className="p-12 text-center">
                <Activity className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-700" />
                <p className="text-gray-500">No metrics yet</p>
                <p className="text-sm text-gray-400 mt-1">Data is collected every 5 minutes from running Proxmox VMs</p>
              </Card>
            ) : (
              <div className="space-y-6">
                {Object.entries(byNode).map(([node, nodeVms]) => (
                  <div key={node}>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-3">
                      {node} — {nodeVms.length} VM{nodeVms.length !== 1 ? 's' : ''}
                    </p>
                    <div className="space-y-2">
                      {nodeVms.map(vm => (
                        <VMChart key={`${vm.node}-${vm.vmid}`} vm={vm} period={period} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {/* Nodes view */}
          {view === 'nodes' && (
            !nodes.length ? (
              <Card className="p-12 text-center">
                <Server className="w-12 h-12 mx-auto mb-3 text-gray-300 dark:text-gray-700" />
                <p className="text-gray-500">No node data yet</p>
              </Card>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {nodes.map(n => <NodeChart key={n} nodeName={n} period={period} />)}
              </div>
            )
          )}
        </>
      )}
    </div>
  )
}
