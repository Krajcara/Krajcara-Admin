import { useState, useEffect } from 'react'
import { Shield, RefreshCw } from 'lucide-react'
import { cn, statusDot, timeAgo } from '../lib/utils'

const STATUS_COLOR = {
  up:       'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  down:     'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  degraded: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  unknown:  'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
}
const STATUS_LABEL = { up: 'Operational', down: 'Down', degraded: 'Degraded', unknown: 'Unknown' }

export default function StatusPage() {
  const [items,       setItems]       = useState([])
  const [loading,     setLoading]     = useState(true)
  const [lastUpdated, setLastUpdated] = useState(null)

  const load = () => {
    fetch('/api/status/public')
      .then(r => r.json())
      .then(data => { setItems(data); setLastUpdated(new Date()) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    load()
    const interval = setInterval(load, 30000)
    return () => clearInterval(interval)
  }, [])

  const allUp    = items.length > 0 && items.every(i => i.status === 'up')
  const anyDown  = items.some(i => i.status === 'down')
  const overall  = anyDown ? 'down' : allUp ? 'up' : items.length === 0 ? 'unknown' : 'degraded'

  const overallLabel = { up: 'All systems operational', down: 'Outage detected', degraded: 'Partial outage', unknown: 'No monitors configured' }
  const overallBg    = {
    up:      'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
    down:    'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
    degraded:'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800',
    unknown: 'bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-700'
  }
  const overallText  = {
    up:      'text-green-700 dark:text-green-300',
    down:    'text-red-700 dark:text-red-300',
    degraded:'text-yellow-700 dark:text-yellow-300',
    unknown: 'text-gray-500'
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <div className="text-center mb-10">
          <div className="w-12 h-12 bg-brand rounded-xl flex items-center justify-center mx-auto mb-4 shadow">
            <Shield className="w-6 h-6 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Krajcara Admin</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Service Status</p>
        </div>

        {!loading && (
          <div className={cn('rounded-xl border p-5 mb-6 text-center', overallBg[overall])}>
            <div className="flex items-center justify-center gap-2">
              <span className={cn('w-3 h-3 rounded-full', statusDot(overall))} />
              <span className={cn('text-lg font-semibold', overallText[overall])}>{overallLabel[overall]}</span>
            </div>
          </div>
        )}

        <div className="bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800 divide-y divide-gray-100 dark:divide-gray-800">
          {loading && (
            <div className="flex items-center justify-center py-10">
              <RefreshCw className="w-5 h-5 text-gray-400 animate-spin" />
            </div>
          )}
          {!loading && items.length === 0 && (
            <p className="text-gray-400 text-sm text-center py-10">No status items configured</p>
          )}
          {items.map(item => (
            <div key={item.id} className="flex items-center gap-4 px-5 py-4">
              <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0', statusDot(item.status || 'unknown'))} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 dark:text-white">{item.name}</p>
                {item.description && <p className="text-xs text-gray-400 mt-0.5">{item.description}</p>}
              </div>
              <span className={cn('text-xs px-2 py-0.5 rounded font-medium flex-shrink-0', STATUS_COLOR[item.status || 'unknown'])}>
                {STATUS_LABEL[item.status || 'unknown']}
              </span>
            </div>
          ))}
        </div>

        <div className="text-center mt-6 text-xs text-gray-400">
          {lastUpdated && <span>Last updated: {lastUpdated.toLocaleTimeString('en')} · Auto-refresh every 30s</span>}
        </div>
      </div>
    </div>
  )
}
