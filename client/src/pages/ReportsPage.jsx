import { useState, useEffect, useCallback } from 'react'
import {
  FileText, Download, RefreshCw, Activity, KeyRound, AppWindow,
  CheckCircle, XCircle, Wifi, Server, Mail, Shield
} from 'lucide-react'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend
} from 'recharts'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { Card, CardHeader, CardTitle, CardContent, Button, Spinner, AlertBox } from '../components/shared/UI'
import { cn } from '../lib/utils'

const PERIODS = [
  { label: '7 days',  value: 7 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
]

function StatBox({ label, value, sub, color = 'blue' }) {
  const colors = {
    blue:   'bg-blue-900/30 border-blue-700 text-blue-300',
    green:  'bg-green-900/30 border-green-700 text-green-300',
    purple: 'bg-purple-900/30 border-purple-700 text-purple-300',
    gray:   'bg-gray-800/50 border-gray-700 text-gray-300',
  }
  return (
    <div className={cn('rounded-xl border p-4 text-center', colors[color])}>
      <p className={cn('text-2xl font-bold')}>{value ?? '—'}</p>
      <p className="text-xs opacity-70 mt-1">{label}</p>
      {sub && <p className="text-xs opacity-50 mt-0.5">{sub}</p>}
    </div>
  )
}

export default function ReportsPage() {
  const [data,        setData]        = useState(null)
  const [loading,     setLoading]     = useState(true)
  const [period,      setPeriod]      = useState(30)
  const [downloading, setDownloading] = useState(false)
  const [error,       setError]       = useState('')
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

  const fmtNum = n => n?.toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'

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

            {/* ── Monitors summary ── */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-gray-400" />
                  <CardTitle>Uptime Monitors</CardTitle>
                </div>
              </CardHeader>
              <div className="px-5 pb-5 grid grid-cols-3 gap-4">
                <StatBox label="Up"       value={data.monitors.up}       color="green" />
                <StatBox label="Avg latency" value={data.monitors.avg_latency_ms != null ? `${data.monitors.avg_latency_ms} ms` : '—'} color="blue" />
                <StatBox label="Total"    value={data.monitors.total}    color="gray" />
              </div>
              {/* Monitor table */}
              <div className="overflow-x-auto border-t border-gray-100 dark:border-gray-800">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800/50">
                      {['Monitor','Target','Status','Latency'].map(h => (
                        <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {data.monitors.all?.map((m, i) => (
                      <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">{m.label}</td>
                        <td className="px-4 py-2 text-xs text-gray-400 font-mono truncate max-w-xs">{m.target}</td>
                        <td className="px-4 py-2">
                          <span className={cn('text-xs font-bold px-2 py-0.5 rounded',
                            m.last_status === 'up' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                            : m.last_status === 'down' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                            : 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300')}>
                            {m.last_status || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-2 font-mono text-sm text-gray-600 dark:text-gray-400">
                          {m.last_latency_ms != null ? `${m.last_latency_ms} ms` : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* ── Speed ── */}
            {data.speed.tests > 0 && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Wifi className="w-4 h-4 text-gray-400" />
                    <CardTitle>Internet Speed — last {period} days</CardTitle>
                    <span className="text-xs text-gray-400">({data.speed.tests} tests)</span>
                  </div>
                </CardHeader>
                <div className="px-5 pb-5 grid grid-cols-3 gap-4">
                  <StatBox label="Avg Download" value={data.speed.avg_download != null ? `${data.speed.avg_download} Mbps` : '—'} color="blue" />
                  <StatBox label="Avg Upload"   value={data.speed.avg_upload   != null ? `${data.speed.avg_upload} Mbps`   : '—'} color="green" />
                  <StatBox label="Avg Ping"     value={data.speed.avg_ping     != null ? `${data.speed.avg_ping} ms`        : '—'} color="purple" />
                </div>
                {data.speed.history?.length > 1 && (
                  <CardContent className="pt-0 pb-4">
                    <ResponsiveContainer width="100%" height={180}>
                      <LineChart data={data.speed.history.map(t => ({
                        date: new Date(t.created_at + 'Z').toLocaleDateString('en', { month: 'short', day: 'numeric' }),
                        Download: Math.round(t.download * 10) / 10,
                        Upload:   Math.round(t.upload   * 10) / 10,
                      }))} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} />
                        <XAxis dataKey="date" tick={{ fontSize: 9 }} tickLine={false} axisLine={false} interval={Math.ceil(data.speed.history.length / 8)} />
                        <YAxis tick={{ fontSize: 9 }} tickLine={false} axisLine={false} />
                        <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: 'none', background: '#111827', color: '#f9fafb' }} />
                        <Line type="monotone" dataKey="Download" stroke="#3b82f6" strokeWidth={2} dot={false} />
                        <Line type="monotone" dataKey="Upload"   stroke="#22c55e" strokeWidth={2} dot={false} />
                        <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                )}
              </Card>
            )}

            {/* ── Licence Costs ── */}
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-gray-400" />
                  <CardTitle>Licence Costs</CardTitle>
                  <span className="text-xs text-gray-400">({data.licences.total} total, {data.licences.free} free)</span>
                </div>
              </CardHeader>
              <div className="px-5 pb-5 space-y-3">
                {data.licences.cost_by_currency && Object.entries(data.licences.cost_by_currency).map(([cur, costs]) => (
                  <div key={cur} className="grid grid-cols-3 gap-3">
                    <div className="rounded-xl border border-blue-700 bg-blue-900/30 p-4 text-center">
                      <p className="text-xl font-bold text-blue-300">{fmtNum(costs.annual)} {cur}</p>
                      <p className="text-xs text-blue-400/70 mt-1">Annual Cost (net)</p>
                    </div>
                    <div className="rounded-xl border border-purple-700 bg-purple-900/30 p-4 text-center">
                      <p className="text-xl font-bold text-purple-300">{fmtNum(costs.annual)} {cur}</p>
                      <p className="text-xs text-purple-400/70 mt-1">Annual Cost (incl. tax)</p>
                    </div>
                    <div className="rounded-xl border border-green-700 bg-green-900/30 p-4 text-center">
                      <p className="text-xl font-bold text-green-300">0.00 {cur}</p>
                      <p className="text-xs text-green-400/70 mt-1">Savings (free/bonus)</p>
                    </div>
                  </div>
                ))}
                {(!data.licences.cost_by_currency || Object.keys(data.licences.cost_by_currency).length === 0) && (
                  <p className="text-sm text-gray-400 text-center py-4">No paid licences</p>
                )}
              </div>
              {/* Licence table */}
              {data.licences.list?.length > 0 && (
                <div className="overflow-x-auto border-t border-gray-100 dark:border-gray-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800/50">
                        {['Vendor','Type','Seats','Billing','Expiry','Price/seat','Currency'].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {data.licences.list.map((l, i) => {
                        const days = l.expiry_date ? Math.ceil((new Date(l.expiry_date) - new Date()) / 86400000) : null
                        const expiryColor = days != null && days <= 0 ? 'text-red-500' : days != null && days <= 30 ? 'text-orange-500' : 'text-gray-500 dark:text-gray-400'
                        return (
                          <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                            <td className="px-4 py-2 font-medium text-gray-900 dark:text-white">{l.vendor}</td>
                            <td className="px-4 py-2 text-gray-600 dark:text-gray-400">{l.licence_type}</td>
                            <td className="px-4 py-2 text-gray-500">{l.licence_used || 0}/{l.licence_count}</td>
                            <td className="px-4 py-2 text-gray-500">{l.billing_cycle || '—'}</td>
                            <td className={cn('px-4 py-2 font-mono text-xs', expiryColor)}>{l.expiry_date || '—'}</td>
                            <td className="px-4 py-2 text-gray-500">{l.price_per_licence || '—'}</td>
                            <td className="px-4 py-2 text-gray-500">{l.currency || '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            {/* ── Mail Flow monthly ── */}
            {data.mailFlowMonthly?.months?.length > 0 && (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-gray-400" />
                      <CardTitle>Email Activity — monthly</CardTitle>
                    </div>
                    {data.mailFlowMonthly.trend != null && (
                      <span className={cn('text-xs font-semibold', data.mailFlowMonthly.trend < 0 ? 'text-red-400' : 'text-green-400')}>
                        {data.mailFlowMonthly.trend > 0 ? '+' : ''}{data.mailFlowMonthly.trend.toLocaleString()} sent vs prev month
                      </span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="pt-0 pb-4">
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={data.mailFlowMonthly.months} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                      <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => v >= 1000 ? `${(v/1000).toFixed(0)}k` : v} />
                      <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: 'none', background: '#111827', color: '#f9fafb' }} formatter={(v, name) => [v.toLocaleString(), name]} />
                      <Bar dataKey="send"    name="Sent"     fill="#3b82f6" radius={[3,3,0,0]} maxBarSize={28} />
                      <Bar dataKey="receive" name="Received" fill="#22c55e" radius={[3,3,0,0]} maxBarSize={28} />
                      <Bar dataKey="read"    name="Read"     fill="#a855f7" radius={[3,3,0,0]} maxBarSize={28} />
                      <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
                {/* Monthly table */}
                <div className="overflow-x-auto border-t border-gray-100 dark:border-gray-800">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Month</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-blue-500 uppercase">↑ Sent</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-green-500 uppercase">↓ Received</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-purple-500 uppercase">● Read</th>
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {data.mailFlowMonthly.months.map((m, i) => (
                        <tr key={i} className={cn('hover:bg-gray-50 dark:hover:bg-gray-800/50', i === data.mailFlowMonthly.months.length - 1 && 'font-semibold')}>
                          <td className="px-4 py-2.5 text-gray-900 dark:text-white">{m.label}</td>
                          <td className="px-4 py-2.5 text-right text-blue-600 dark:text-blue-400">{m.send.toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-right text-green-600 dark:text-green-400">{m.receive.toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-right text-purple-600 dark:text-purple-400">{m.read.toLocaleString()}</td>
                          <td className="px-4 py-2.5 text-right text-gray-500">{(m.send + m.receive).toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* ── Mail Flow by domain ── */}
            {data.mailFlow?.domains?.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Email Activity by domain</CardTitle>
                </CardHeader>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800/50">
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

            {/* ── DNS External ── */}
            {data.dnsExternal?.length > 0 && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Shield className="w-4 h-4 text-gray-400" />
                    <CardTitle>DNS — External Domain Security</CardTitle>
                  </div>
                </CardHeader>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Domain</th>
                        {['SPF','DKIM','DMARC','MX'].map(h => (
                          <th key={h} className="px-4 py-2.5 text-center text-xs font-medium text-gray-500 uppercase">{h}</th>
                        ))}
                        <th className="px-4 py-2.5 text-right text-xs font-medium text-gray-500 uppercase">Score</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {data.dnsExternal.map((d, i) => (
                        <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <td className="px-4 py-2.5 font-mono font-medium text-gray-900 dark:text-white">{d.domain}</td>
                          {[d.spf, d.dkim, d.dmarc, d.mx].map((v, j) => (
                            <td key={j} className="px-4 py-2.5 text-center">
                              {v
                                ? <CheckCircle className="w-4 h-4 text-green-500 mx-auto" />
                                : <XCircle    className="w-4 h-4 text-red-500 mx-auto" />
                              }
                            </td>
                          ))}
                          <td className="px-4 py-2.5 text-right">
                            <span className={cn('font-bold text-sm',
                              d.score === 4 ? 'text-green-500' : d.score >= 2 ? 'text-orange-500' : 'text-red-500')}>
                              {d.score}/4
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* ── Proxmox ── */}
            {data.proxmox?.configured && data.proxmox.nodes.length > 0 && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <Server className="w-4 h-4 text-gray-400" />
                    <CardTitle>Proxmox Infrastructure</CardTitle>
                  </div>
                </CardHeader>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800/50">
                        {['Node','Status','CPU cores','CPU %','RAM (GB)','RAM %','VMs','LXC'].map(h => (
                          <th key={h} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {data.proxmox.nodes.map(n => (
                        <tr key={n.node} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                          <td className="px-4 py-2.5 font-bold text-gray-900 dark:text-white">{n.node}</td>
                          <td className="px-4 py-2.5">
                            <span className={cn('w-2 h-2 rounded-full inline-block mr-1.5', n.status === 'online' ? 'bg-green-500' : 'bg-red-500')} />
                            {n.status}
                          </td>
                          <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{n.maxcpu}</td>
                          <td className="px-4 py-2.5 font-semibold">{n.cpu_usage}%</td>
                          <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{n.mem_used_gb} / {n.maxmem_gb}</td>
                          <td className="px-4 py-2.5 font-semibold">{n.mem_usage}%</td>
                          <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{n.vm_running}/{n.vm_count}</td>
                          <td className="px-4 py-2.5 text-gray-600 dark:text-gray-400">{n.lxc_running}/{n.lxc_count}</td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50 dark:bg-gray-800/50 text-xs font-semibold text-gray-500">
                        <td className="px-4 py-2" colSpan={2}>Totals</td>
                        <td className="px-4 py-2">{data.proxmox.nodes.reduce((a,n) => a+n.maxcpu,0)} cores</td>
                        <td className="px-4 py-2">—</td>
                        <td className="px-4 py-2">{data.proxmox.nodes.reduce((a,n) => a+parseFloat(n.maxmem_gb||0),0).toFixed(1)} GB</td>
                        <td className="px-4 py-2">—</td>
                        <td className="px-4 py-2">{data.proxmox.nodes.reduce((a,n) => a+n.vm_running,0)}/{data.proxmox.nodes.reduce((a,n) => a+n.vm_count,0)}</td>
                        <td className="px-4 py-2">{data.proxmox.nodes.reduce((a,n) => a+n.lxc_running,0)}/{data.proxmox.nodes.reduce((a,n) => a+n.lxc_count,0)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {/* ── Entra ID ── */}
            {data.entra?.list?.length > 0 && (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <AppWindow className="w-4 h-4 text-gray-400" />
                    <CardTitle>Entra ID App Registrations</CardTitle>
                    {data.entra.expiring_30 > 0 && (
                      <span className="text-xs bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300 px-2 py-0.5 rounded font-medium">{data.entra.expiring_30} expiring</span>
                    )}
                  </div>
                </CardHeader>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 dark:bg-gray-800/50">
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">App name</th>
                        <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 uppercase">Secret expiry</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                      {data.entra.list.map((a, i) => {
                        const days = a.secret_expiry ? Math.ceil((new Date(a.secret_expiry) - new Date()) / 86400000) : null
                        return (
                          <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                            <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-white">{a.app_name}</td>
                            <td className={cn('px-4 py-2.5 font-mono text-xs', days != null && days <= 30 ? 'text-red-500 font-semibold' : 'text-gray-500')}>
                              {a.secret_expiry || '—'} {days != null && days > 0 && days <= 60 ? `(${days}d)` : ''}
                            </td>
                          </tr>
                        )
                      })}
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
