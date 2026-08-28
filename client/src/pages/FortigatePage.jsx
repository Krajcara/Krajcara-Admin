import { useState, useEffect, useRef } from 'react'
import { RefreshCw, Cpu, MemoryStick, Activity, Network, Globe, Shield } from 'lucide-react'
import api from '../lib/api'
import { Card, CardHeader, CardTitle, CardContent, Spinner, AlertBox } from '../components/shared/UI'
import { cn } from '../lib/utils'

const REFRESH_MS = 30000

function fmtBytes(b) {
  if (!b) return '0 B'
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GB'
  if (b >= 1048576)    return (b / 1048576).toFixed(1) + ' MB'
  if (b >= 1024)       return (b / 1024).toFixed(1) + ' KB'
  return b + ' B'
}

function fmtUptime(secs) {
  if (!secs) return '—'
  const d = Math.floor(secs / 86400)
  const h = Math.floor((secs % 86400) / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (d > 0) return `${d}d ${h}h ${m}m`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function GaugeBar({ pct, color }) {
  const c = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-yellow-500' : color
  return (
    <div className="w-full bg-gray-100 dark:bg-gray-800 rounded-full h-2 mt-2">
      <div className={cn('h-2 rounded-full transition-all', c)} style={{ width: `${Math.min(100, pct || 0)}%` }} />
    </div>
  )
}

function StatCard({ icon: Icon, label, value, sub, color, pct }) {
  const colors = {
    blue:   'text-blue-500 bg-blue-50 dark:bg-blue-900/20',
    green:  'text-green-500 bg-green-50 dark:bg-green-900/20',
    purple: 'text-purple-500 bg-purple-50 dark:bg-purple-900/20',
    amber:  'text-amber-500 bg-amber-50 dark:bg-amber-900/20',
    red:    'text-red-500 bg-red-50 dark:bg-red-900/20',
  }
  return (
    <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl p-4">
      <div className="flex items-center gap-3 mb-1">
        <div className={cn('p-2 rounded-lg', colors[color])}><Icon className="w-4 h-4" /></div>
        <p className="text-xs text-gray-400">{label}</p>
      </div>
      <p className="text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      {pct != null && <GaugeBar pct={pct} color={color === 'blue' ? 'bg-blue-500' : 'bg-purple-500'} />}
    </div>
  )
}

export default function FortigatePage() {
  const [status,   setStatus]   = useState(null)
  const [sessions, setSessions] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [lastUpd,  setLastUpd]  = useState(null)
  const ref = useRef(null)

  const load = async () => {
    setError(null)
    try {
      const [st, se] = await Promise.all([
        api.get('/fortigate/status'),
        api.get('/fortigate/sessions?count=50'),
      ])
      setStatus(st.data)
      setSessions(se.data || [])
      setLastUpd(new Date())
    } catch (e) {
      setError(e.response?.data?.error || 'Failed to load FortiGate data')
    } finally { setLoading(false) }
  }

  useEffect(() => {
    load()
    ref.current = setInterval(load, REFRESH_MS)
    return () => clearInterval(ref.current)
  }, [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">FortiGate</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {lastUpd
              ? `Updated ${lastUpd.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', second: '2-digit' })} · auto-refresh 30s`
              : 'Loading...'}
          </p>
        </div>
        <button onClick={load} disabled={loading}
          className="p-2 text-gray-400 hover:text-brand rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {error && <AlertBox type="error">{error}</AlertBox>}

      {loading && !status ? (
        <div className="flex justify-center py-16"><Spinner className="w-6 h-6" /></div>
      ) : status && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <StatCard icon={Cpu}      label="CPU"          value={`${status.cpu_pct}%`}   color="blue"   pct={status.cpu_pct} />
            <StatCard icon={MemoryStick} label="Memory"    value={`${status.mem_pct}%`}   color="purple" pct={status.mem_pct} />
            <StatCard icon={Activity} label="Sessions"     value={status.sessions?.toLocaleString()} color="green" />
            <StatCard icon={Activity} label="Setup rate"   value={`${status.setup_rate}/s`} color="amber" />
            <StatCard icon={Cpu}      label="Uptime"       value={fmtUptime(status.uptime)} color="blue" />
          </div>

          {/* Interfaces */}
          {status.interfaces?.length > 0 && (
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800">
                <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Interface traffic</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 dark:bg-gray-800/50">
                    <tr>
                      {['Interface', 'Status', 'Speed', 'RX', 'TX'].map(h => (
                        <th key={h} className="px-4 py-2 text-left text-xs font-medium text-gray-500 dark:text-gray-400">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                    {status.interfaces.map(iface => (
                      <tr key={iface.name} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                        <td className="px-4 py-2 font-medium text-gray-900 dark:text-white font-mono">{iface.name}</td>
                        <td className="px-4 py-2">
                          <span className={cn('w-2 h-2 rounded-full inline-block mr-1.5', iface.link ? 'bg-green-500' : 'bg-gray-400')} />
                          <span className="text-xs text-gray-500">{iface.link ? 'Up' : 'Down'}</span>
                        </td>
                        <td className="px-4 py-2 text-gray-500 text-xs">{iface.speed ? `${iface.speed} Mbps` : '—'}</td>
                        <td className="px-4 py-2 text-blue-600 dark:text-blue-400 font-mono text-xs">{fmtBytes(iface.rx_bytes)}</td>
                        <td className="px-4 py-2 text-green-600 dark:text-green-400 font-mono text-xs">{fmtBytes(iface.tx_bytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Live sessions */}
          <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Live sessions</h3>
              <span className="text-xs text-gray-400">{sessions.length} shown</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 dark:bg-gray-800/50">
                  <tr>
                    {['Proto', 'Source', 'Destination', 'Port', 'Country', 'Application', 'Duration'].map(h => (
                      <th key={h} className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {sessions.slice(0, 50).map((s, i) => (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                      <td className="px-3 py-1.5">
                        <span className={cn('px-1.5 py-0.5 rounded text-xs font-medium',
                          s.proto === 'tcp' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                          s.proto === 'udp' ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400' :
                          'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400')}>
                          {s.proto?.toUpperCase()}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 font-mono text-gray-700 dark:text-gray-300">{s.src}</td>
                      <td className="px-3 py-1.5 font-mono text-gray-700 dark:text-gray-300">{s.dst}</td>
                      <td className="px-3 py-1.5 text-gray-500">{s.dport}</td>
                      <td className="px-3 py-1.5 text-gray-500">{s.country || '—'}</td>
                      <td className="px-3 py-1.5 text-gray-600 dark:text-gray-400">{s.app || '—'}</td>
                      <td className="px-3 py-1.5 text-gray-500">{s.duration ? `${Math.round(s.duration / 60)}m` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
