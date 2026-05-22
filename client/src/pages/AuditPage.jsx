import { useState, useEffect } from 'react'
import { Download, Search, RefreshCw } from 'lucide-react'
import api from '../lib/api'
import { Card, Input, Select, Button, Table, Th, Td, Badge, Spinner, Empty } from '../components/shared/UI'
import { formatDate } from '../lib/utils'
import { cn } from '../lib/utils'

const ACTION_BADGE = {
  create: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  update: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  delete: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  login:  'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  logout: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
}

export default function AuditPage() {
  const [rows,    setRows]    = useState([])
  const [total,   setTotal]   = useState(0)
  const [pages,   setPages]   = useState(1)
  const [page,    setPage]    = useState(1)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState({ search: '', module: '', action: '', status: '' })
  const [modules, setModules] = useState([])

  const load = async (p = page) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page: p, limit: 50, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) })
      const r = await api.get(`/audit?${params}`)
      setRows(r.data.rows)
      setTotal(r.data.total)
      setPages(r.data.pages)
      setPage(p)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    api.get('/audit/modules').then(r => setModules(r.data)).catch(() => {})
  }, [])

  useEffect(() => { load(1) }, [filters])

  const handleExport = () => {
    const params = new URLSearchParams(Object.fromEntries(Object.entries(filters).filter(([, v]) => v)))
    window.open(`/api/audit/export/csv?${params}`, '_blank')
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Audit Log</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{total} entries</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => load(1)}><RefreshCw className="w-4 h-4" /></Button>
          <Button variant="secondary" onClick={handleExport}><Download className="w-4 h-4" />Export CSV</Button>
        </div>
      </div>

      {/* Filters */}
      <Card className="p-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="relative lg:col-span-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              autoComplete="off"
              placeholder="Search..."
              value={filters.search}
              onChange={e => setFilters(p => ({ ...p, search: e.target.value }))}
              className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand"
            />
          </div>
          <Select value={filters.module} onChange={e => setFilters(p => ({ ...p, module: e.target.value }))}>
            <option value="">All modules</option>
            {modules.map(m => <option key={m} value={m}>{m}</option>)}
          </Select>
          <Select value={filters.action} onChange={e => setFilters(p => ({ ...p, action: e.target.value }))}>
            <option value="">All actions</option>
            {['login', 'logout', 'create', 'update', 'delete', 'change_password'].map(a => <option key={a} value={a}>{a}</option>)}
          </Select>
          <Select value={filters.status} onChange={e => setFilters(p => ({ ...p, status: e.target.value }))}>
            <option value="">All statuses</option>
            <option value="success">Success</option>
            <option value="error">Error</option>
          </Select>
        </div>
      </Card>

      <Card>
        {loading ? (
          <div className="flex justify-center py-12"><Spinner className="w-6 h-6" /></div>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Time</Th>
                <Th>User</Th>
                <Th>Module</Th>
                <Th>Action</Th>
                <Th>Entity</Th>
                <Th>IP</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={7}><Empty title="No audit entries" description="Actions will appear here" /></td></tr>
              )}
              {rows.map(row => (
                <tr key={row.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <Td className="whitespace-nowrap text-xs">{formatDate(row.created_at)}</Td>
                  <Td><span className="font-medium">{row.username}</span></Td>
                  <Td><span className="text-xs text-gray-500">{row.module}</span></Td>
                  <Td><Badge className={ACTION_BADGE[row.action] || 'bg-gray-100 text-gray-600'}>{row.action}</Badge></Td>
                  <Td className="max-w-xs truncate">{row.entity_name || row.entity_id || '—'}</Td>
                  <Td className="text-xs text-gray-400 font-mono">{row.ip_address || '—'}</Td>
                  <Td>
                    <span className={cn('text-xs px-2 py-0.5 rounded font-medium', row.status === 'success' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300')}>
                      {row.status}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100 dark:border-gray-800">
            <p className="text-sm text-gray-500">Page {page} of {pages}</p>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => load(page - 1)}>Previous</Button>
              <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => load(page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
