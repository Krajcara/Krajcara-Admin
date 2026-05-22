import { cn } from '../../lib/utils'
import { X, Loader2 } from 'lucide-react'

export function Badge({ children, className }) {
  return <span className={cn('inline-flex items-center px-2 py-0.5 rounded text-xs font-medium', className)}>{children}</span>
}

export function Button({ children, variant = 'primary', size = 'md', loading, className, ...props }) {
  const base     = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed'
  const variants = {
    primary:   'bg-brand text-white hover:bg-brand-dark focus:ring-brand',
    secondary: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 focus:ring-gray-400',
    danger:    'bg-red-600 text-white hover:bg-red-700 focus:ring-red-500',
    ghost:     'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 focus:ring-gray-400',
    outline:   'border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 focus:ring-gray-400'
  }
  const sizes = { sm: 'px-3 py-1.5 text-sm', md: 'px-4 py-2 text-sm', lg: 'px-5 py-2.5 text-base' }
  return (
    <button className={cn(base, variants[variant], sizes[size], className)} disabled={loading || props.disabled} {...props}>
      {loading && <Loader2 className="w-4 h-4 animate-spin" />}
      {children}
    </button>
  )
}

export function Card({ children, className, ...props }) {
  return <div className={cn('bg-white dark:bg-gray-900 rounded-xl border border-gray-200 dark:border-gray-800', className)} {...props}>{children}</div>
}
export function CardHeader({ children, className }) {
  return <div className={cn('px-5 py-4 border-b border-gray-100 dark:border-gray-800', className)}>{children}</div>
}
export function CardTitle({ children, className }) {
  return <h2 className={cn('font-semibold text-gray-900 dark:text-white', className)}>{children}</h2>
}
export function CardContent({ children, className }) {
  return <div className={cn('p-5', className)}>{children}</div>
}

// autoComplete="new-password" on sensitive fields prevents browser autofill
export function Input({ label, error, className, type, ...props }) {
  const isSensitive = ['password', 'email', 'username'].includes(type || props.name || '')
  return (
    <div className="space-y-1">
      {label && <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>}
      <input
        type={type}
        autoComplete={isSensitive ? 'new-password' : 'off'}
        className={cn('w-full px-3 py-2 text-sm rounded-lg border bg-white dark:bg-gray-800 text-gray-900 dark:text-white placeholder-gray-400 transition-colors border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent', error && 'border-red-500 focus:ring-red-500', className)}
        {...props}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

export function Select({ label, error, children, className, ...props }) {
  return (
    <div className="space-y-1">
      {label && <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>}
      <select
        autoComplete="off"
        className={cn('w-full px-3 py-2 text-sm rounded-lg border bg-white dark:bg-gray-800 text-gray-900 dark:text-white transition-colors border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent', error && 'border-red-500', className)}
        {...props}
      >
        {children}
      </select>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

export function Textarea({ label, error, className, ...props }) {
  return (
    <div className="space-y-1">
      {label && <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">{label}</label>}
      <textarea
        autoComplete="off"
        className={cn('w-full px-3 py-2 text-sm rounded-lg border bg-white dark:bg-gray-800 text-gray-900 dark:text-white resize-none transition-colors border-gray-300 dark:border-gray-600 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent', error && 'border-red-500', className)}
        {...props}
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  )
}

// Modal — closes ONLY via X button or Cancel, NOT on backdrop click
export function Modal({ open, onClose, title, children, size = 'md' }) {
  if (!open) return null
  const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl', full: 'max-w-6xl' }
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex min-h-full items-center justify-center p-4">
        {/* Backdrop — no onClick handler intentionally */}
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" />
        <div className={cn('relative w-full bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700', sizes[size])}>
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-800">
            <h3 className="font-semibold text-gray-900 dark:text-white">{title}</h3>
            <button onClick={onClose} className="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="p-5">{children}</div>
        </div>
      </div>
    </div>
  )
}

export function Table({ children, className }) {
  return <div className="overflow-x-auto"><table className={cn('w-full text-sm', className)}>{children}</table></div>
}
export function Th({ children, className }) {
  return <th className={cn('px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wider border-b border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50', className)}>{children}</th>
}
export function Td({ children, className }) {
  return <td className={cn('px-4 py-3 text-gray-700 dark:text-gray-300 border-b border-gray-100 dark:border-gray-800/50', className)}>{children}</td>
}

export function Empty({ icon: Icon, title, description, action }) {
  return (
    <div className="text-center py-12">
      {Icon && <Icon className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />}
      <p className="font-medium text-gray-600 dark:text-gray-400">{title}</p>
      {description && <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Spinner({ className }) {
  return <Loader2 className={cn('animate-spin text-brand', className)} />
}

export function StatCard({ label, value, icon: Icon, color = 'blue', sub }) {
  const colors = {
    blue:   'bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400',
    green:  'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400',
    yellow: 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-600 dark:text-yellow-400',
    red:    'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400',
    purple: 'bg-purple-50 dark:bg-purple-900/20 text-purple-600 dark:text-purple-400'
  }
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{value}</p>
          {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
        </div>
        {Icon && <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0', colors[color])}><Icon className="w-5 h-5" /></div>}
      </div>
    </Card>
  )
}

export function Toggle({ checked, onChange, label }) {
  return (
    <label className="inline-flex items-center gap-2 cursor-pointer">
      <div onClick={() => onChange(!checked)} className={cn('relative w-9 h-5 rounded-full transition-colors', checked ? 'bg-brand' : 'bg-gray-300 dark:bg-gray-600')}>
        <span className={cn('absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform', checked && 'translate-x-4')} />
      </div>
      {label && <span className="text-sm text-gray-700 dark:text-gray-300">{label}</span>}
    </label>
  )
}

export function AlertBox({ type = 'info', children }) {
  const styles = {
    info:    'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-800 dark:text-blue-300',
    error:   'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300',
    success: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-300',
    warning: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800 text-yellow-800 dark:text-yellow-300'
  }
  return <div className={cn('px-4 py-3 rounded-lg border text-sm', styles[type])}>{children}</div>
}

export function SectionTitle({ children, action }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-base font-semibold text-gray-900 dark:text-white">{children}</h2>
      {action}
    </div>
  )
}
