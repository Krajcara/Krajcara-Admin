import { useState, useEffect, useRef, useCallback } from 'react'
import { Bell, X, CheckCheck, Trash2, AlertCircle, AlertTriangle, Info, CheckCircle } from 'lucide-react'
import { cn, timeAgo } from '../../lib/utils'
import { useSocket } from '../../hooks/useSocket'
import api from '../../lib/api'

const TYPE_ICON = {
  error:   <AlertCircle   className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />,
  warning: <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0 mt-0.5" />,
  info:    <Info          className="w-4 h-4 text-blue-500 flex-shrink-0 mt-0.5" />,
  success: <CheckCircle   className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />,
}
const TYPE_BG = {
  error:   'border-l-red-500',
  warning: 'border-l-yellow-500',
  info:    'border-l-blue-500',
  success: 'border-l-green-500',
}

export default function NotificationBell() {
  const [open,         setOpen]         = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unreadCount,  setUnreadCount]  = useState(0)
  const [loading,      setLoading]      = useState(false)
  const ref = useRef(null)

  const load = useCallback(() => {
    setLoading(true)
    api.get('/notifications?limit=30')
      .then(r => {
        setNotifications(r.data.notifications || [])
        setUnreadCount(r.data.unread_count || 0)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // Real-time updates
  useSocket({
    'notification:new':   (notif) => {
      setNotifications(prev => [notif, ...prev].slice(0, 30))
      setUnreadCount(c => c + 1)
    },
    'notification:count': ({ unread_count }) => setUnreadCount(unread_count),
  })

  // Close on outside click
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const markRead = async (id, e) => {
    e.stopPropagation()
    await api.put(`/notifications/${id}/read`)
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, read: 1 } : n))
    setUnreadCount(c => Math.max(0, c - 1))
  }

  const markAllRead = async () => {
    await api.put('/notifications/read-all')
    setNotifications(prev => prev.map(n => ({ ...n, read: 1 })))
    setUnreadCount(0)
  }

  const clearRead = async () => {
    await api.delete('/notifications/clear-all')
    setNotifications(prev => prev.filter(n => !n.read))
  }

  const unread = notifications.filter(n => !n.read)
  const read   = notifications.filter(n => n.read)

  return (
    <div className="relative" ref={ref}>
      {/* Bell button */}
      <button
        onClick={() => { setOpen(o => !o); if (!open) load() }}
        className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        title="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold px-1">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-10 w-80 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl z-50">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <span className="font-semibold text-gray-900 dark:text-white text-sm">Notifications</span>
              {unreadCount > 0 && (
                <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 font-bold">{unreadCount}</span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button onClick={markAllRead} className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors" title="Mark all as read">
                  <CheckCheck className="w-3.5 h-3.5" />
                </button>
              )}
              {read.length > 0 && (
                <button onClick={clearRead} className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors" title="Clear read">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              )}
              <button onClick={() => setOpen(false)} className="p-1.5 text-gray-400 hover:text-gray-600 rounded transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 && !loading && (
              <div className="text-center py-8 text-gray-400">
                <Bell className="w-8 h-8 mx-auto mb-2 text-gray-300 dark:text-gray-700" />
                <p className="text-sm">No notifications</p>
              </div>
            )}
            {loading && notifications.length === 0 && (
              <div className="text-center py-8 text-gray-400 text-sm">Loading...</div>
            )}

            {unread.length > 0 && (
              <div>
                <p className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 dark:bg-gray-800/50">
                  New
                </p>
                {unread.map(n => (
                  <NotifItem key={n.id} n={n} onMarkRead={markRead} />
                ))}
              </div>
            )}
            {read.length > 0 && (
              <div>
                <p className="px-4 py-2 text-xs font-semibold text-gray-400 uppercase tracking-wide bg-gray-50 dark:bg-gray-800/50">
                  Earlier
                </p>
                {read.map(n => (
                  <NotifItem key={n.id} n={n} onMarkRead={markRead} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function NotifItem({ n, onMarkRead }) {
  return (
    <div className={cn(
      'flex items-start gap-3 px-4 py-3 border-b border-gray-50 dark:border-gray-800/50 last:border-0 border-l-2 transition-colors',
      n.read ? 'border-l-transparent opacity-60' : TYPE_BG[n.type] || 'border-l-blue-500',
      !n.read && 'bg-blue-50/30 dark:bg-blue-900/10'
    )}>
      {TYPE_ICON[n.type] || TYPE_ICON.info}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-900 dark:text-white leading-tight">{n.title}</p>
        {n.message && <p className="text-xs text-gray-500 mt-0.5 leading-snug">{n.message}</p>}
        <p className="text-xs text-gray-400 mt-1">{timeAgo(n.created_at)}</p>
      </div>
      {!n.read && (
        <button onClick={(e) => onMarkRead(n.id, e)}
          className="p-1 text-gray-400 hover:text-brand rounded flex-shrink-0 transition-colors" title="Mark as read">
          <CheckCheck className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  )
}
