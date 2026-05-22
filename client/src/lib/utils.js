import { clsx }          from 'clsx'
import { twMerge }        from 'tailwind-merge'
import { formatDistanceToNow, format } from 'date-fns'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatDate(date) {
  if (!date) return '—'
  return format(new Date(date), 'dd.MM.yyyy HH:mm')
}

export function timeAgo(date) {
  if (!date) return '—'
  return formatDistanceToNow(new Date(date), { addSuffix: true })
}

export function roleColor(role) {
  return {
    superadmin: 'bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300',
    admin:      'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
    operator:   'bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300',
    viewer:     'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300'
  }[role] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
}

export function statusDot(status) {
  return {
    up:       'bg-green-500',
    down:     'bg-red-500 animate-pulse',
    degraded: 'bg-yellow-400 animate-pulse',
    unknown:  'bg-gray-300'
  }[status] || 'bg-gray-300'
}
