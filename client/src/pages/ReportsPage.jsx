import { useState, useEffect, useCallback } from 'react'
import {
  FileText, Download, RefreshCw, Activity, KeyRound, AppWindow,
  AlertCircle, AlertTriangle, CheckCircle, Info, Wifi, Calendar,
  TrendingUp, Shield, Bell, Server, Mail
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell, Legend
} from 'recharts'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { Card, CardHeader, CardTitle, CardContent, Button, Spinner, AlertBox, Badge } from '../components/shared/UI'
import { cn, timeAgo } from '../lib/utils'

const PERIODS = [
  { label: '7 days',  value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
]

const PIE_COLORS = { error: '#ef4444', warning: '#f97316', success: '#22c55e', info: '#3b82f6' }

function StatBox({ label, value, color = 'blue', icon: Icon, sub }) {
  const colors = {
    blue:   'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800',
    green:  'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800',
    red:    'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800',
    orange: 'bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-800',
    gray:   'bg-gray-50 dark:bg-gray-800/50 text-gray-500 border-gray-200 dark:border-gray-700',
  }
  return (
    <div className={cn('rounded-xl border p-4', colors[color])}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium uppercase tracking-wide opacity-70">{label}</p>
        {Icon && <Icon className="w-4 h-4 opacity-60" />}
      </div>
      <p className="text-2xl font-bold">{value ?? '—'}</p>
      {sub && <p className="text-xs opacity-60 mt-1">{sub}</p>}
    </div>
  )
}

export default function ReportsPage() {
  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [period,     setPeriod]     = useState(30)
  const [downloading,setDownloading]= useState(false)
  const [error,      setError]      = useState('')
  const { user } = useAuthStore()
  const canExport = ['superadmin', 'admin'].includes(user?.role)

  const load = useCallback(() => {
    setLoading(true); setError('')
    api.get(`/reports/data?period=${period}`)
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.error || 'Failed to load report data'))
      .finally(() => setLoading(false))
  }, [period])

  useEffect(() => { load() }, [load])

  const downloadPDF = async () => {
    setDownloading(true)
    try {
      const r = await api.get(`/reports/generate?period=${period}`, { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }))
      const a   = document.createElement('a')
      a.href    = url
      a.download = `krajcara-report-${period}d-${new Date().toISOString().split('T')[0]}.pdf`
      a.click()
      window.URL.revokeObjectURL(url)
    } catch { setError('Failed to generate PDF') }
    finally { setDownloading(false) }
  }

  const notifPieData = data ? Object.entries(data.notifications.by_type)
    .filter(([,v]) => v > 0)
    .map(([k, v]) => ({ name: k, value: v })) : []

  const speedChartData = data?.speed?.history?.map(t => ({
    date:     new Date(t.created_at + 'Z').toLocaleDateString('en', { month: 'short', day: 'numeric' }),
    Download: Math.round(t.download * 10) / 10,
    Upload:   Math.round(t.upload   * 10) / 10,
    Ping:     Math.round(t.ping),
  })) || []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Reports</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Infrastructure overview {data && `· Generated ${new Date(data.generated_at).toLocaleString('en')}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Period selector */}
          <div className="flex gap-1">
            {PERIODS.map(p => (
              <button key={p.value} onClick={() => setPeriod(p.value)}
                className={cn('px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                  period === p.value ? 'bg-brand text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700')}>
                {p.label}
              </button>
            ))}
          </div>
          <button onClick={load} className="p-2 text-gray-400 hover:text-brand rounded-lg transition-colors">
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
          {canExport && (
            <Button loading={downloading} onClick={downloadPDF}>
              <Download className="w-4 h-4" />Export PDF
            </Button>
          )}
        </div>
      </div>

      {error && <AlertBox type="error">{error}</AlertBox>}

      {loading
        ? <div className="flex justify-center py-20"><Spinner className="w-8 h-8" /></div>
        : data && (
          <div className="space-y-6">

            {/* ── Summary stats ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatBox label="Monitors up"    value={data.monitors.up}    color="green"  icon={Activity}  sub={`${data.monitors.total} total`} />
              <StatBox label="Monitors down"  value={data.monitors.down}  color={data.monitors.down > 0 ? 'red' : 'gray'} icon={Activity} sub={`${data.monitors.degraded} degraded`} />
              <StatBox label="Licences"       value={data.licences.total} color="purple" icon={KeyRound}  sub={`${data.licences.expiring_30} expiring soon`} />
              <StatBox label="Entra ID Apps"  value={data.entra.total}    color="blue"   icon={AppWindow} sub={`${data.entra.expiring_30} secrets expiring`} />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatBox label="Avg latency"      value={data.monitors.avg_latency_ms != null ? `${data.monitors.avg_latency_ms} ms` : '—'} color="blue" icon={Activity} />
              <StatBox label="Avg download"     value={data.speed.avg_download != null ? `${data.speed.avg_download} Mbps` : '—'} color="blue" icon={Wifi} sub={`${data.speed.tests} tests`} />
              {data.licences.cost_by_currency && Object.entries(data.licences.cost_by_currency).map(([cur, costs]) => (
                <StatBox key={cur} label={`Annual cost (${cur})`} value={`${costs.annual.toLocaleString('en', { minimumFractionDigits: 2 })} ${cur}`} color="purple" icon={KeyRound} sub={`${costs.monthly.toLocaleString('en', { minimumFractionDigits: 2 })} ${cur}/mo`} />
              ))}
              {data.licences.free > 0 && <StatBox label="Free licences" value={data.licences.free} color="green" icon={KeyRound} sub="no cost" />}
              <StatBox label="Notifications"    value={data.notifications.total} color={data.notifications.by_type.error > 0 ? 'red' : 'gray'} icon={Bell} sub={`${data.notifications.by_type.error || 0} errors`} />
            </div>

            {/* ── Charts row ── */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* Speed chart */}
              {speedChartData.length > 1 && (
                <Card className="lg:col-span-2">
                  <CardHeader><CardTitle>Internet Speed — last {period} days</CardTitle></CardHeader>
                  <CardContent className="pt-0 pb-4">
                    <ResponsiveContainer width="100%" height={220}>
                      <LineChart data={speedChartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} />
                        <XAxis dataKey="date" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} interval={Math.ceil(speedChartData.length / 8)} />
                        <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: 'none', background: '#111827', color: '#f9fafb' }} />
                        <Line type="monotone" dataKey="Download" stroke="#3b82f6" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="Upload"   stroke="#22c55e" strokeWidth={2} dot={false} />
                        <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}

              {/* Notifications pie */}
              {notifPieData.length > 0 && (
                <Card>
                  <CardHeader><CardTitle>Notifications by type</CardTitle></CardHeader>
                  <CardContent className="pt-0 pb-4">
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={notifPieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${value}`} labelLine={false} fontSize={10}>
                          {notifPieData.map((entry, i) => (
                            <Cell key={i} fill={PIE_COLORS[entry.name] || '#6b7280'} />
                          ))}
                        </Pie>
                        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: 'none', background: '#111827', color: '#f9fafb' }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* ── Proxmox ── */}
            {data.proxmox?.configured && data.proxmox.nodes.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Proxmox Infrastructure</CardTitle></CardHeader>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                        {['Node','Status','CPU cores','CPU %','RAM (GB)','RAM %','VMs','LXC'].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {data.proxmox.nodes.map(n => (
                        <tr key={n.node} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <td className="px-4 py-2.5 font-bold text-gray-900 dark:text-white">{n.node}</td>
                          <td className="px-4 py-2.5"><span className={cn('w-2 h-2 rounded-full inline-block mr-1.5', n.status === 'online' ? 'bg-green-500' : 'bg-red-500')} />{n.status}</td>
                          <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{n.maxcpu}</td>
                          <td className="px-4 py-2.5 font-semibold">{n.cpu_usage}%</td>
                          <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{n.mem_used_gb} / {n.maxmem_gb}</td>
                          <td className="px-4 py-2.5 font-semibold">{n.mem_usage}%</td>
                          <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{n.vm_running}/{n.vm_count}</td>
                          <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{n.lxc_running}/{n.lxc_count}</td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50 dark:bg-gray-800/50 font-semibold text-xs text-gray-500">
                        <td className="px-4 py-2" colSpan={2}>Totals</td>
                        <td className="px-4 py-2">{data.proxmox.nodes.reduce((a,n) => a + n.maxcpu, 0)} cores</td>
                        <td className="px-4 py-2">—</td>
                        <td className="px-4 py-2">{data.proxmox.nodes.reduce((a,n) => a + parseFloat(n.maxmem_gb||0), 0).toFixed(1)} GB</td>
                        <td className="px-4 py-2">—</td>
                        <td className="px-4 py-2">{data.proxmox.nodes.reduce((a,n) => a + n.vm_running, 0)}/{data.proxmox.nodes.reduce((a,n) => a + n.vm_count, 0)}</td>
                        <td className="px-4 py-2">{data.proxmox.nodes.reduce((a,n) => a + n.lxc_running, 0)}/{data.proxmox.nodes.reduce((a,n) => a + n.lxc_count, 0)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* ── M365 Mail Flow ── */}
            {data.mailFlow?.domains?.length > 0 && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>M365 Mail Flow by domain</CardTitle>
                    <div className="flex gap-4 text-xs text-gray-500">
                      <span>Sent: <strong className="text-blue-600">{data.mailFlow.totals.send.toLocaleString()}</strong></span>
                      <span>Received: <strong className="text-green-600">{data.mailFlow.totals.receive.toLocaleString()}</strong></span>
                      <span>Read: <strong className="text-purple-600">{data.mailFlow.totals.read.toLocaleString()}</strong></span>
                    </div>
                  </div>
                </CardHeader>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Domain</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-blue-500 uppercase">Sent</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-green-500 uppercase">Received</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-purple-500 uppercase">Read</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {data.mailFlow.domains.map((d, i) => (
                        <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <td className="px-4 py-2.5 font-mono font-medium text-gray-900 dark:text-white">@{d.domain}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-blue-600 dark:text-blue-400">{d.send.toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-green-600 dark:text-green-400">{d.receive.toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-purple-600 dark:text-purple-400">{d.read.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* ── Top latency monitors ── */}
            {data.monitors.top_latency.length > 0 && (
              <Card>
                <CardHeader><CardTitle>Top 5 monitors by latency</CardTitle></CardHeader>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">#</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Monitor</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Latency</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {data.monitors.top_latency.map((m, i) => (
                        <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <td className="px-4 py-2.5 text-xs text-gray-400">{i + 1}</td>
                          <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">{m.label}</td>
                          <td className="px-4 py-2.5">
                            <Badge className={cn('text-xs', { up: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300', down: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300', degraded: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300' }[m.status] || 'bg-gray-100 text-gray-500')}>{m.status}</Badge>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono font-semibold text-gray-900 dark:text-white">{m.latency_ms} ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}



          </div>
        )
      }
    </div>
  )
}
