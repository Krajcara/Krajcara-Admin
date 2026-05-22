import { useState, useEffect } from 'react'
import { Users, Shield, Settings, BookOpen } from 'lucide-react'
import { StatCard, Card, CardHeader, CardTitle, CardContent, Spinner } from '../components/shared/UI'
import { timeAgo } from '../lib/utils'
import api from '../lib/api'

export default function DashboardPage() {
  const [stats,   setStats]   = useState(null)
  const [recent,  setRecent]  = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      api.get('/users').catch(() => ({ data: [] })),
      api.get('/audit?limit=8').catch(() => ({ data: { rows: [] } })),
    ]).then(([users, audit]) => {
      setStats({ users: users.data.length || 0 })
      setRecent(audit.data.rows || [])
    }).finally(() => setLoading(false))
  }, [])

  if (loading) return <div className="flex justify-center py-20"><Spinner className="w-8 h-8" /></div>

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900 dark:text-white">Dashboard</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">Krajcara Admin overview</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Users" value={stats?.users ?? 0} icon={Users} color="blue" />
        <StatCard label="Modules" value="Phase 1" icon={Shield} color="purple" sub="Foundation" />
        <StatCard label="Audit logs" value={recent.length > 0 ? recent.length + '+' : '0'} icon={BookOpen} color="green" />
        <StatCard label="Version" value="1.0.0" icon={Settings} color="yellow" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Recent activity</CardTitle>
        </CardHeader>
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {recent.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-8">No activity yet</p>
          )}
          {recent.map(entry => (
            <div key={entry.id} className="flex items-center gap-4 px-5 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-900 dark:text-white">
                  <span className="font-medium">{entry.username}</span>
                  {' '}<span className="text-gray-500">{entry.action}</span>
                  {entry.entity_name && <span className="text-gray-500"> · {entry.entity_name}</span>}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{entry.module} · {timeAgo(entry.created_at)}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded font-medium ${entry.status === 'success' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'}`}>
                {entry.status}
              </span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
