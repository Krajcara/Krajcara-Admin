import { useState, useEffect, useCallback } from 'react'
import { Plus, Play, Trash2, Pencil, History, GitCompare, ChevronDown, ChevronUp, Monitor, RefreshCw, Download } from 'lucide-react'
import api from '../lib/api'
import { useSocket } from '../hooks/useSocket'
import { useAuthStore } from '../store/authStore'
import { Card, CardContent, Button, Modal, Input, Select, Table, Th, Td, Badge, Empty, Spinner, AlertBox } from '../components/shared/UI'
import { cn, formatDate } from '../lib/utils'

const TARGET_TYPES = ['ip', 'subnet', 'hostname', 'range']
const PROFILES = [
  { value: 'quick',   label: 'Quick',   desc: '-T4 -F --host-timeout 30s' },
  { value: 'full',    label: 'Full',    desc: '-T4 -p- --host-timeout 120s' },
  { value: 'service', label: 'Service', desc: '-T4 -sV -sC --host-timeout 60s' },
  { value: 'stealth', label: 'Stealth', desc: '-T2 -sS --host-timeout 120s' },
  { value: 'os',      label: 'OS',      desc: '-T4 -O --osscan-guess' },
  { value: 'custom',  label: 'Custom',  desc: '' },
]
const TYPE_COLOR = {
  ip:       'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  subnet:   'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  hostname: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  range:    'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
}
const STATUS_COLOR = {
  done:    'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  running: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  queued:  'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400',
  error:   'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
}

function fmtDuration(started, finished) {
  if (!started || !finished) return '—'
  const ms = new Date(finished) - new Date(started)
  if (ms < 60000) return `${Math.round(ms/1000)}s`
  return `${Math.round(ms/60000)}m`
}

// ── Host form ─────────────────────────────────────────────────────────────────
function HostForm({ initial, onSave, onCancel }) {
  const isEdit = !!initial?.id
  const [form, setForm] = useState(initial || { label: '', target: '', target_type: 'ip', description: '' })
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      isEdit ? await api.put(`/scanner/hosts/${initial.id}`, form) : await api.post('/scanner/hosts', form)
      onSave()
    } catch (err) { setError(err.response?.data?.error || 'Error saving host') }
    finally { setLoading(false) }
  }

  return (
    <form onSubmit={submit} autoComplete="off" className="space-y-4">
      {error && <AlertBox type="error">{error}</AlertBox>}
      <Input label="Label *" autoComplete="off" value={form.label} onChange={f('label')} required />
      <Select label="Type" value={form.target_type} onChange={f('target_type')} disabled={isEdit}>
        {TARGET_TYPES.map(t => <option key={t}>{t}</option>)}
      </Select>
      <Input label="Target *" autoComplete="off" value={form.target} onChange={f('target')}
        placeholder={form.target_type === 'subnet' ? '192.168.1.0/24' : form.target_type === 'range' ? '192.168.1.1-50' : '192.168.1.1'}
        required disabled={isEdit} />
      <Input label="Description" autoComplete="off" value={form.description || ''} onChange={f('description')} />
      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={loading}>{isEdit ? 'Save' : 'Add host'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

// ── Active scan panel ─────────────────────────────────────────────────────────
function ActiveScan({ scanId, onDone }) {
  const [progress, setProgress] = useState(0)
  const [status,   setStatus]   = useState('running')
  const [results,  setResults]  = useState([])
  const [error,    setError]    = useState('')

  useSocket({
    'scan:progress': ({ scanId: id, progress: p }) => { if (id === scanId) setProgress(p) },
    'scan:result':   ({ scanId: id, result })      => { if (id === scanId) setResults(prev => [...prev, result]) },
    'scan:complete': ({ scanId: id })               => { if (id === scanId) { setStatus('done'); setProgress(100); onDone() } },
    'scan:error':    ({ scanId: id, error: err })   => { if (id === scanId) { setStatus('error'); setError(err) } },
  })

  return (
    <Card className="mt-4">
      <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {status === 'running' && <Spinner className="w-4 h-4" />}
          <span className="font-medium text-sm text-gray-900 dark:text-white">
            {status === 'running' ? 'Scanning...' : status === 'done' ? 'Scan complete' : 'Scan error'}
          </span>
        </div>
        <span className="text-xs text-gray-400">{progress}%</span>
      </div>
      <CardContent className="space-y-3">
        <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
          <div className="h-full bg-brand rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
        </div>
        {error && <AlertBox type="error">{error}</AlertBox>}
        {results.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-gray-500 uppercase">{results.length} host{results.length !== 1 ? 's' : ''} found</p>
            {results.map((r, i) => (
              <div key={i} className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-1.5">
                  <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 text-xs">up</Badge>
                  <span className="font-mono text-sm font-medium">{r.ip_address}</span>
                  {r.hostname && <span className="text-xs text-gray-400">({r.hostname})</span>}
                </div>
                {(r.ports || []).filter(p => p.state === 'open').length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {r.ports.filter(p => p.state === 'open').slice(0, 10).map((p, j) => (
                      <span key={j} className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded font-mono">
                        {p.port_number}/{p.protocol}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function NetworkScannerPage() {
  const [tab,       setTab]       = useState('hosts')
  const [hosts,     setHosts]     = useState([])
  const [scans,     setScans]     = useState([])
  const [total,     setTotal]     = useState(0)
  const [page,      setPage]      = useState(0)
  const [hostFilter,setHostFilter]= useState('')
  const [loading,   setLoading]   = useState(true)
  const [modal,     setModal]     = useState(null)
  const [expandedScans, setExpandedScans] = useState({})
  const [scanDetails,   setScanDetails]   = useState({})
  const [loadingDetail, setLoadingDetail] = useState({})
  const [delTarget, setDelTarget] = useState(null)
  // Scan form state
  const [scanHostId,   setScanHostId]   = useState('')
  const [scanProfile,  setScanProfile]  = useState('quick')
  const [customArgs,   setCustomArgs]   = useState('')
  const [scanning,     setScanning]     = useState(false)
  const [activeScanId, setActiveScanId] = useState(null)
  const [scanError,    setScanError]    = useState('')
  // Diff modal
  const [diffScanId, setDiffScanId] = useState(null)
  const [diffData,   setDiffData]   = useState(null)
  const [diffLoading,setDiffLoading]= useState(false)

  const { user } = useAuthStore()
  const canEdit = ['superadmin','admin','operator'].includes(user?.role)
  const LIMIT = 20

  const loadHosts = useCallback(() => {
    setLoading(true)
    api.get('/scanner/hosts').then(r => setHosts(r.data)).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const loadScans = useCallback(() => {
    const p = new URLSearchParams({ limit: LIMIT, offset: page * LIMIT, status: 'done' })
    if (hostFilter) p.set('host_id', hostFilter)
    api.get(`/scanner/scans?${p}`)
      .then(r => { setScans(r.data.scans || []); setTotal(r.data.total || 0) })
      .catch(() => {})
  }, [page, hostFilter])

  useEffect(() => { loadHosts() }, [loadHosts])
  useEffect(() => { if (tab === 'history') loadScans() }, [tab, loadScans])

  const toggleScanDetail = async (scanId) => {
    if (expandedScans[scanId]) {
      setExpandedScans(p => ({ ...p, [scanId]: false }))
      return
    }
    setExpandedScans(p => ({ ...p, [scanId]: true }))
    if (scanDetails[scanId]) return // already loaded
    setLoadingDetail(p => ({ ...p, [scanId]: true }))
    try {
      const r = await api.get(`/scanner/scans/${scanId}`)
      setScanDetails(p => ({ ...p, [scanId]: r.data }))
    } catch {}
    finally { setLoadingDetail(p => ({ ...p, [scanId]: false })) }
  }

  const startScan = async () => {
    if (!scanHostId) return setScanError('Please select a host')
    setScanError(''); setScanning(true)
    try {
      const { data } = await api.post('/scanner/scans', {
        host_id: parseInt(scanHostId),
        profile: scanProfile,
        nmap_args: scanProfile === 'custom' ? customArgs : undefined
      })
      setActiveScanId(data.id)
    } catch (err) {
      setScanError(err.response?.data?.error || 'Failed to start scan')
    } finally { setScanning(false) }
  }

  const loadDiff = async (scanId) => {
    setDiffScanId(scanId); setDiffLoading(true); setDiffData(null)
    try {
      // Compare open ports with previous scan
      const scan = await api.get(`/scanner/scans/${scanId}`)
      const allScans = await api.get(`/scanner/scans?host_id=${scan.data.host_id}&limit=50`)
      const sortedDone = (allScans.data.scans || []).filter(s => s.status === 'done').sort((a,b) => b.id - a.id)
      const currentIdx = sortedDone.findIndex(s => s.id === scanId)
      const prev = sortedDone[currentIdx + 1]

      if (!prev) { setDiffData({ hasPrevious: false }); return }

      const prevScan = await api.get(`/scanner/scans/${prev.id}`)
      const currentPorts = (scan.data.results || []).flatMap(r => (r.ports||[]).filter(p=>p.state==='open').map(p=>`${p.port_number}/${p.protocol}`))
      const prevPorts    = (prevScan.data.results || []).flatMap(r => (r.ports||[]).filter(p=>p.state==='open').map(p=>`${p.port_number}/${p.protocol}`))
      const newPorts     = currentPorts.filter(p => !prevPorts.includes(p))
      const closedPorts  = prevPorts.filter(p => !currentPorts.includes(p))

      setDiffData({
        hasPrevious: true,
        summary: { new: newPorts.length, closed: closedPorts.length },
        changes: [
          ...newPorts.map(p => ({ port: p, change: 'new' })),
          ...closedPorts.map(p => ({ port: p, change: 'closed' })),
        ]
      })
    } catch { setDiffData({ hasPrevious: false }) }
    finally { setDiffLoading(false) }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Network Scanner</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{hosts.length} host{hosts.length !== 1 ? 's' : ''} configured</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700">
        {[
          { key: 'hosts',   label: 'Hosts',        icon: Monitor  },
          { key: 'scan',    label: 'New Scan',      icon: Play     },
          { key: 'history', label: 'Scan History',  icon: History  },
        ].map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={cn('flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors',
              tab === t.key ? 'border-brand text-brand dark:text-brand-light' : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300')}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>

      {/* ── HOSTS ── */}
      {tab === 'hosts' && (
        <>
          <div className="flex justify-between items-center">
            <p className="text-sm text-gray-500">{hosts.length} host{hosts.length !== 1 ? 's' : ''}</p>
            {canEdit && <Button onClick={() => setModal('add')}><Plus className="w-4 h-4" />Add host</Button>}
          </div>
          <Card>
            {loading ? <div className="flex justify-center py-12"><Spinner className="w-6 h-6" /></div>
              : hosts.length === 0 ? <Empty icon={Monitor} title="No hosts" description="Add a host to start scanning"
                  action={canEdit ? <Button onClick={() => setModal('add')}><Plus className="w-4 h-4" />Add host</Button> : null} />
              : <Table>
                  <thead><tr>
                    <Th>Label</Th><Th>Target</Th><Th>Type</Th><Th>Added</Th><Th />
                  </tr></thead>
                  <tbody>
                    {hosts.map(h => (
                      <tr key={h.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                        <Td className="font-medium text-gray-900 dark:text-white">{h.label}</Td>
                        <Td className="font-mono text-xs">{h.target}</Td>
                        <Td><Badge className={TYPE_COLOR[h.target_type] || ''}>{h.target_type}</Badge></Td>
                        <Td className="text-xs text-gray-400">{formatDate(h.created_at)}</Td>
                        <Td>
                          <div className="flex items-center justify-end gap-1">
                            {canEdit && (
                              <button onClick={() => { setScanHostId(String(h.id)); setTab('scan') }}
                                className="p-1.5 text-gray-400 hover:text-green-500 rounded transition-colors" title="Scan now">
                                <Play className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {canEdit && <button onClick={() => setModal(h)} className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors"><Pencil className="w-3.5 h-3.5" /></button>}
                            {user?.role === 'superadmin' && <button onClick={() => setDelTarget(h)} className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>}
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
            }
          </Card>
        </>
      )}

      {/* ── NEW SCAN ── */}
      {tab === 'scan' && (
        <div className="max-w-xl space-y-4">
          {!activeScanId && (
            <Card>
              <CardContent className="space-y-4">
                {scanError && <AlertBox type="error">{scanError}</AlertBox>}
                <Select label="Host" value={scanHostId} onChange={e => setScanHostId(e.target.value)}>
                  <option value="">-- Select host --</option>
                  {hosts.map(h => <option key={h.id} value={h.id}>{h.label} ({h.target})</option>)}
                </Select>
                <div className="space-y-1">
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">Scan profile</label>
                  <div className="space-y-2">
                    {PROFILES.map(p => (
                      <label key={p.value}
                        className={cn('flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                          scanProfile === p.value ? 'border-brand bg-brand/5 dark:bg-brand/10' : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600')}>
                        <input type="radio" name="profile" value={p.value} checked={scanProfile === p.value} onChange={e => setScanProfile(e.target.value)} className="mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{p.label}</p>
                          {p.desc && <p className="text-xs font-mono text-gray-400 mt-0.5">{p.desc}</p>}
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
                {scanProfile === 'custom' && (
                  <Input label="Nmap arguments" autoComplete="off" value={customArgs} onChange={e => setCustomArgs(e.target.value)} placeholder="-T4 -sV -p 80,443,8080" />
                )}
                <Button onClick={startScan} loading={scanning} className="w-full"><Play className="w-4 h-4" />Start scan</Button>
              </CardContent>
            </Card>
          )}
          {activeScanId && (
            <ActiveScan scanId={activeScanId} onDone={() => { setTimeout(() => { setActiveScanId(null); setTab('history'); loadScans() }, 1500) }} />
          )}
        </div>
      )}

      {/* ── HISTORY ── */}
      {tab === 'history' && (
        <>
          <div className="flex items-center gap-3">
            <Select value={hostFilter} onChange={e => { setHostFilter(e.target.value); setPage(0) }} className="max-w-xs">
              <option value="">All hosts</option>
              {hosts.map(h => <option key={h.id} value={h.id}>{h.label}</option>)}
            </Select>
            <Button variant="secondary" size="sm" onClick={loadScans}><RefreshCw className="w-3.5 h-3.5" /></Button>
            <span className="text-sm text-gray-400 ml-auto">{total} scan{total !== 1 ? 's' : ''}</span>
          </div>
          <Card>
            {scans.length === 0 ? <Empty icon={History} title="No scans" description="Run your first scan to see history" />
              : <>
                <Table>
                  <thead><tr>
                    <Th>Host</Th><Th>Finished</Th><Th>Duration</Th><Th>Profile</Th><Th>Status</Th><Th />
                  </tr></thead>
                  <tbody>
                    {scans.map(s => (
                      <>
                        <tr key={s.id}
                          className="hover:bg-gray-50 dark:hover:bg-gray-800/50 cursor-pointer"
                          onClick={() => toggleScanDetail(s.id)}>
                          <Td>
                            <div className="flex items-center gap-2">
                              {expandedScans[s.id]
                                ? <ChevronUp className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                                : <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />}
                              <div>
                                <p className="font-medium text-gray-900 dark:text-white">{s.host_label}</p>
                                <p className="text-xs font-mono text-gray-400">{s.host_target}</p>
                              </div>
                            </div>
                          </Td>
                          <Td className="text-xs">{formatDate(s.finished_at)}</Td>
                          <Td className="text-xs text-gray-500">{fmtDuration(s.started_at, s.finished_at)}</Td>
                          <Td><Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 text-xs">{s.profile}</Badge></Td>
                          <Td><Badge className={cn('text-xs', STATUS_COLOR[s.status] || '')}>{s.status}</Badge></Td>
                          <Td>
                            <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                              <button onClick={() => loadDiff(s.id)} className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors" title="Diff"><GitCompare className="w-3.5 h-3.5" /></button>
                            </div>
                          </Td>
                        </tr>
                        {expandedScans[s.id] && (
                          <tr key={`${s.id}-detail`}>
                            <td colSpan={6} className="px-4 py-0 bg-gray-50/50 dark:bg-gray-800/20">
                              {loadingDetail[s.id]
                                ? <div className="py-4 flex justify-center"><Spinner className="w-4 h-4" /></div>
                                : scanDetails[s.id]?.results?.length > 0
                                  ? (
                                    <div className="py-3 space-y-2">
                                      {scanDetails[s.id].results.map((r, ri) => {
                                        const openPorts = (r.ports || []).filter(p => p.state === 'open')
                                        return (
                                          <div key={ri} className="bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 p-3">
                                            <div className="flex items-center gap-2 mb-2">
                                              <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300 text-xs">up</Badge>
                                              <span className="font-mono text-sm font-semibold text-gray-900 dark:text-white">{r.ip_address}</span>
                                              {r.hostname && <span className="text-xs text-gray-400">({r.hostname})</span>}
                                              {r.os_guess && <span className="text-xs text-gray-400 italic">{r.os_guess}</span>}
                                              <span className="text-xs text-gray-400 ml-auto">{openPorts.length} open port{openPorts.length !== 1 ? 's' : ''}</span>
                                            </div>
                                            {openPorts.length > 0 ? (
                                              <div className="overflow-x-auto">
                                                <table className="w-full text-xs">
                                                  <thead>
                                                    <tr className="text-gray-400 border-b border-gray-100 dark:border-gray-800">
                                                      <th className="text-left py-1 pr-4 font-medium">Port</th>
                                                      <th className="text-left py-1 pr-4 font-medium">Protocol</th>
                                                      <th className="text-left py-1 pr-4 font-medium">Service</th>
                                                      <th className="text-left py-1 font-medium">Version</th>
                                                    </tr>
                                                  </thead>
                                                  <tbody>
                                                    {openPorts.map((p, pi) => (
                                                      <tr key={pi} className="border-b border-gray-50 dark:border-gray-800/50 last:border-0">
                                                        <td className="py-1 pr-4 font-mono font-semibold text-brand">{p.port_number}</td>
                                                        <td className="py-1 pr-4 text-gray-500">{p.protocol}</td>
                                                        <td className="py-1 pr-4 text-gray-700 dark:text-gray-300">{p.service || '—'}</td>
                                                        <td className="py-1 text-gray-400 truncate max-w-48">{[p.product, p.version].filter(Boolean).join(' ') || '—'}</td>
                                                      </tr>
                                                    ))}
                                                  </tbody>
                                                </table>
                                              </div>
                                            ) : (
                                              <p className="text-xs text-gray-400">No open ports found</p>
                                            )}
                                          </div>
                                        )
                                      })}
                                    </div>
                                  )
                                  : <p className="py-3 text-xs text-gray-400 text-center">No results found for this scan</p>
                              }
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </Table>
                {total > LIMIT && (
                  <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-800">
                    <span className="text-xs text-gray-500">{page*LIMIT+1}–{Math.min((page+1)*LIMIT,total)} of {total}</span>
                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm" disabled={page===0} onClick={() => setPage(p=>p-1)}>Previous</Button>
                      <Button variant="secondary" size="sm" disabled={(page+1)*LIMIT>=total} onClick={() => setPage(p=>p+1)}>Next</Button>
                    </div>
                  </div>
                )}
              </>
            }
          </Card>
        </>
      )}

      {/* Host modals */}
      <Modal open={modal === 'add'} onClose={() => setModal(null)} title="Add host">
        <HostForm onSave={() => { setModal(null); loadHosts() }} onCancel={() => setModal(null)} />
      </Modal>
      {modal && modal !== 'add' && (
        <Modal open onClose={() => setModal(null)} title={`Edit — ${modal.label}`}>
          <HostForm initial={modal} onSave={() => { setModal(null); loadHosts() }} onCancel={() => setModal(null)} />
        </Modal>
      )}
      <Modal open={!!delTarget} onClose={() => setDelTarget(null)} title="Delete host" size="sm">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Delete <strong>{delTarget?.label}</strong>? All scan history will also be deleted.</p>
        <div className="flex gap-3">
          <Button variant="danger" onClick={async () => { await api.delete(`/scanner/hosts/${delTarget.id}`); setDelTarget(null); loadHosts() }}>Delete</Button>
          <Button variant="secondary" onClick={() => setDelTarget(null)}>Cancel</Button>
        </div>
      </Modal>

      {/* Diff modal */}
      <Modal open={!!diffScanId} onClose={() => setDiffScanId(null)} title="Changes since previous scan" size="md">
        {diffLoading && <div className="flex justify-center py-8"><Spinner className="w-6 h-6" /></div>}
        {diffData && !diffLoading && (
          !diffData.hasPrevious ? <p className="text-sm text-gray-500 py-4">No previous scan to compare.</p>
          : diffData.changes.length === 0 ? <p className="text-sm text-gray-500 py-4 text-center">No changes detected.</p>
          : (
            <div className="space-y-3">
              <div className="flex gap-4 text-sm">
                <span>New: <strong className="text-green-600">{diffData.summary.new}</strong></span>
                <span>Closed: <strong className="text-red-600">{diffData.summary.closed}</strong></span>
              </div>
              {diffData.changes.map((c, i) => (
                <div key={i} className={cn('px-4 py-2.5 rounded-r-lg text-sm border-l-4',
                  c.change === 'new' ? 'bg-green-50 dark:bg-green-900/20 border-green-500' : 'bg-red-50 dark:bg-red-900/20 border-red-500')}>
                  <div className="flex items-center gap-2">
                    <Badge className={c.change === 'new' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'}>
                      {c.change}
                    </Badge>
                    <span className="font-mono font-medium">{c.port}</span>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </Modal>
    </div>
  )
}
