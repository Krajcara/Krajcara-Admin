import { useState, useEffect, useCallback } from 'react'
import { RefreshCw, Shield, AlertTriangle, CheckCircle, ChevronDown, ChevronUp, Package, Clock, XCircle } from 'lucide-react'
import api from '../lib/api'
import { useSocket } from '../hooks/useSocket'
import { useAuthStore } from '../store/authStore'
import { Card, Button, Badge, Empty, Spinner, AlertBox } from '../components/shared/UI'
import { cn, formatDate } from '../lib/utils'

const OS_LABEL = {
  apt:     'Ubuntu/Debian',
  dnf:     'RHEL/CentOS',
  apk:     'Alpine',
  windows: 'Windows',
  linux:   'Linux',
  unknown: 'Unknown',
}
const OS_COLOR = {
  apt:     'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  dnf:     'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  apk:     'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-300',
  windows: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  unknown: 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}
const SEV_COLOR = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  security: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  unknown:  'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400',
}

// ── VM detail panel ───────────────────────────────────────────────────────────
function VMDetail({ vm, onClose }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [checking,setChecking]= useState(false)

  const load = useCallback(() => {
    setLoading(true)
    api.get(`/patches/${vm.node}/${vm.vm_id}`)
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [vm.node, vm.vm_id])

  useEffect(() => { load() }, [load])

  useSocket({
    'patches:done': ({ vm_id }) => {
      if (!vm_id || vm_id === vm.vm_id) load()
    }
  })

  const checkNow = async () => {
    setChecking(true)
    try { await api.post('/patches/check', { vm_id: vm.vm_id }) }
    catch {}
    finally { setChecking(false) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900 dark:text-white">{vm.vm_name}</h2>
          <p className="text-xs text-gray-400">{vm.node} · {vm.vm_type?.toUpperCase()} · {OS_LABEL[vm.os_type] || vm.os_type}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="secondary" loading={checking} onClick={checkNow}>
            <RefreshCw className="w-3.5 h-3.5" />Check now
          </Button>
          <Button size="sm" variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>

      {loading ? <div className="flex justify-center py-8"><Spinner className="w-5 h-5" /></div>
        : !data?.packages?.length ? (
          <div className="text-center py-8 space-y-2">
            <CheckCircle className="w-10 h-10 text-green-500 mx-auto" />
            <p className="font-medium text-gray-700 dark:text-gray-300">Up to date</p>
            {data?.last_check && <p className="text-xs text-gray-400">Last checked: {formatDate(data.last_check.checked_at)}</p>}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {data.packages.length} update{data.packages.length !== 1 ? 's' : ''} available
              </p>
              {data?.last_check && <p className="text-xs text-gray-400">Checked: {formatDate(data.last_check.checked_at)}</p>}
            </div>
            <div className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-800/50 border-b border-gray-200 dark:border-gray-700">
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Package</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Current</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Available</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {data.packages.map((pkg, i) => (
                    <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                      <td className="px-4 py-2 font-mono text-xs font-medium text-gray-900 dark:text-white">{pkg.package_name}</td>
                      <td className="px-4 py-2 font-mono text-xs text-gray-500">{pkg.current_version || '—'}</td>
                      <td className="px-4 py-2 font-mono text-xs text-green-600 dark:text-green-400 font-medium">{pkg.available_version}</td>
                      <td className="px-4 py-2">
                        <Badge className={cn('text-xs', SEV_COLOR[pkg.severity] || SEV_COLOR.unknown)}>
                          {pkg.severity}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )
      }
    </div>
  )
}

// ── VM card ───────────────────────────────────────────────────────────────────
function VMCard({ vm, onSelect, checking }) {
  const hasUpdates  = vm.update_count > 0
  const hasSecurity = vm.security_count > 0

  return (
    <Card className={cn('overflow-hidden cursor-pointer hover:shadow-md transition-shadow', hasSecurity && 'border-orange-300 dark:border-orange-700')}
      onClick={() => onSelect(vm)}>
      <div className={cn('h-1', hasSecurity ? 'bg-orange-500' : hasUpdates ? 'bg-yellow-400' : 'bg-green-500')} />
      <div className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0',
              hasSecurity ? 'bg-orange-500' : hasUpdates ? 'bg-yellow-400' : 'bg-green-500')} />
            <div>
              <p className="font-semibold text-gray-900 dark:text-white text-sm">{vm.vm_name}</p>
              <p className="text-xs text-gray-400">{vm.node} · {vm.vm_type?.toUpperCase()}</p>
            </div>
          </div>
          <Badge className={cn('text-xs', OS_COLOR[vm.os_type] || OS_COLOR.unknown)}>
            {OS_LABEL[vm.os_type] || vm.os_type}
          </Badge>
        </div>

        {vm.status === 'error' ? (
          <div className="flex items-center gap-1.5 text-xs text-red-500">
            <XCircle className="w-3.5 h-3.5" />
            <span>Check failed</span>
          </div>
        ) : !hasUpdates ? (
          <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
            <CheckCircle className="w-3.5 h-3.5" />
            <span>Up to date</span>
          </div>
        ) : (
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-gray-900 dark:text-white">
                <Package className="w-4 h-4 text-gray-400" />
                {vm.update_count} update{vm.update_count !== 1 ? 's' : ''}
              </div>
              {hasSecurity && (
                <div className="flex items-center gap-1 text-xs font-medium text-orange-600 dark:text-orange-400">
                  <Shield className="w-3.5 h-3.5" />
                  {vm.security_count} security
                </div>
              )}
            </div>
          </div>
        )}

        {vm.checked_at && (
          <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
            <Clock className="w-3 h-3" />{formatDate(vm.checked_at)}
          </p>
        )}
      </div>
    </Card>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function PatchManagementPage() {
  const [vms,       setVms]       = useState([])
  const [loading,   setLoading]   = useState(true)
  const [checking,  setChecking]  = useState(false)
  const [selected,  setSelected]  = useState(null)
  const [error,     setError]     = useState('')
  const [tab,       setTab]       = useState('overview')
  const { user } = useAuthStore()
  const canCheck = ['superadmin','admin'].includes(user?.role)

  const load = useCallback(() => {
    setLoading(true)
    api.get('/patches').then(r => setVms(r.data || [])).catch(() => {}).finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  useSocket({
    'patches:done': () => { setChecking(false); load() }
  })

  const checkAll = async () => {
    setChecking(true); setError('')
    try { await api.post('/patches/check', {}) }
    catch (e) { setError(e.response?.data?.error || 'Check failed'); setChecking(false) }
  }

  const totalUpdates   = vms.reduce((a, v) => a + (v.update_count  || 0), 0)
  const totalSecurity  = vms.reduce((a, v) => a + (v.security_count || 0), 0)
  const upToDate       = vms.filter(v => !v.update_count && v.status !== 'error').length
  const withUpdates    = vms.filter(v => v.update_count > 0).length
  const withErrors     = vms.filter(v => v.status === 'error').length

  // All packages flat list
  const allPackages = []
  for (const vm of vms) {
    // We don't have packages in summary — handled in detail view
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Patch Management</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Software updates via Proxmox Guest Agent · Auto-check daily at 04:00
          </p>
        </div>
        {canCheck && (
          <Button loading={checking} onClick={checkAll}>
            <RefreshCw className={cn('w-4 h-4', checking && 'animate-spin')} />
            {checking ? 'Checking...' : 'Check all VMs'}
          </Button>
        )}
      </div>

      {error && <AlertBox type="error">{error}</AlertBox>}

      {checking && (
        <AlertBox type="info">
          <div className="flex items-center gap-2">
            <Spinner className="w-4 h-4" />
            Patch check in progress — this may take a few minutes depending on the number of VMs.
          </div>
        </AlertBox>
      )}

      {/* Summary cards */}
      {!loading && vms.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Total updates',   value: totalUpdates,  color: totalUpdates  > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-green-600' },
            { label: 'Security updates',value: totalSecurity, color: totalSecurity > 0 ? 'text-orange-600 dark:text-orange-400' : 'text-green-600' },
            { label: 'Up to date',      value: upToDate,      color: 'text-green-600 dark:text-green-400' },
            { label: 'Need updates',    value: withUpdates,   color: withUpdates   > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-gray-500' },
          ].map(s => (
            <Card key={s.label} className="p-4 text-center">
              <p className={cn('text-2xl font-bold', s.color)}>{s.value}</p>
              <p className="text-xs text-gray-500 mt-1">{s.label}</p>
            </Card>
          ))}
        </div>
      )}

      {/* VM detail panel */}
      {selected && (
        <Card className="p-5">
          <VMDetail vm={selected} onClose={() => setSelected(null)} />
        </Card>
      )}

      {/* VM cards */}
      {loading
        ? <div className="flex justify-center py-12"><Spinner className="w-8 h-8" /></div>
        : vms.length === 0
          ? (
            <Card>
              <Empty icon={Package} title="No patch data"
                description={canCheck ? "Click 'Check all VMs' to scan for available updates. Requires Proxmox Guest Agent installed and running in each VM." : "No patch data available"}
                action={canCheck ? <Button onClick={checkAll} loading={checking}><RefreshCw className="w-4 h-4" />Check all VMs</Button> : null}
              />
            </Card>
          )
          : (
            <>
              {/* Filter */}
              <div className="flex gap-2">
                {[
                  { key: 'all',      label: `All (${vms.length})` },
                  { key: 'updates',  label: `Updates (${withUpdates})` },
                  { key: 'security', label: `Security (${vms.filter(v=>v.security_count>0).length})` },
                  { key: 'ok',       label: `OK (${upToDate})` },
                ].map(f => (
                  <button key={f.key} onClick={() => setTab(f.key)}
                    className={cn('px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                      tab === f.key ? 'bg-brand text-white' : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700')}>
                    {f.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {vms
                  .filter(vm => {
                    if (tab === 'updates')  return vm.update_count > 0
                    if (tab === 'security') return vm.security_count > 0
                    if (tab === 'ok')       return !vm.update_count && vm.status !== 'error'
                    return true
                  })
                  .map(vm => (
                    <VMCard key={`${vm.node}-${vm.vm_id}`} vm={vm} onSelect={setSelected} checking={checking} />
                  ))
                }
              </div>
            </>
          )
      }

      {/* Windows setup note */}
      {!loading && vms.some(v => v.os_type === 'windows' || v.os_type === 'unknown') && (
        <AlertBox type="info">
          <strong>Windows VMs:</strong> Requires PSWindowsUpdate module installed (<code className="bg-gray-100 dark:bg-gray-800 px-1 rounded text-xs">Install-Module PSWindowsUpdate -Force</code>) and QEMU Guest Agent service running.
          <br />
          <strong>Unknown OS:</strong> Guest Agent may not be installed or VM is stopped.
        </AlertBox>
      )}
    </div>
  )
}
