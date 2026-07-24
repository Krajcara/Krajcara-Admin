import { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom'
import NotificationBell from './NotificationBell'
import {
  LayoutDashboard, Shield, LogOut, Sun, Moon, Menu, User,
  Users, Settings, BookOpen, KeyRound, RefreshCw, Activity, Network, Globe,
  Server, Scan, CalendarClock, Wifi, Cloud, HardDrive, ChevronDown, MapPin, Layers, Monitor, Bell, FileText, Terminal
} from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { useThemeStore } from '../../store/themeStore'
import { cn, roleColor } from '../../lib/utils'

// ── Nav structure ─────────────────────────────────────────────────────────────
const NAV_GROUPS = [
  {
    key:   'inventory',
    label: 'Inventory',
    items: [
      { to: '/licences',   label: 'Licences',         icon: KeyRound },
    ],
  },
  {
    key:   'network',
    label: 'Network',
    items: [
      { to: '/monitors',   label: 'Uptime Monitor',   icon: Activity },
      { to: '/routers',    label: 'Routers',          icon: Network },
      { to: '/dns',        label: 'DNS',              icon: Globe },
      { to: '/netspeed',   label: 'Net Speed',        icon: Wifi },
    ],
  },
  {
    key:   'infrastructure',
    label: 'Infrastructure',
    items: [
      { to: '/proxmox',    label: 'Proxmox',          icon: Server },
      { to: '/scanner',    label: 'Network Scanner',  icon: Scan },
      { to: '/automation', label: 'Scan Automation',  icon: CalendarClock },
      { to: '/ipspace',    label: 'IP Space',          icon: MapPin },
      { to: '/patches',    label: 'Patch Management',  icon: Layers },
      { to: '/servers',    label: 'Servers & Scripts',icon: Terminal },
    ],
  },
  {
    key:   'advanced',
    label: 'Advanced',
    items: [
      { to: '/m365',       label: 'Microsoft 365',    icon: Cloud },
      { to: '/backup',     label: 'Backup',           icon: HardDrive, roles: ['superadmin'] },
    ],
  },
  {
    key:   'account',
    label: 'Account',
    items: [
      { to: '/profile',    label: 'Profile',          icon: User },
    ],
  },
  {
    key:   'admin',
    label: 'Admin',
    roles: ['superadmin', 'admin'],
    items: [
      { to: '/users',            label: 'Users',             icon: Users,    roles: ['superadmin', 'admin'] },
      { to: '/audit',            label: 'Audit Log',         icon: BookOpen, roles: ['superadmin', 'admin'] },
      { to: '/notification-log', label: 'Notification Log',  icon: Bell,     roles: ['superadmin', 'admin'] },
      { to: '/reports',          label: 'Reports',           icon: FileText, roles: ['superadmin', 'admin'] },
      { to: '/settings',         label: 'Settings',          icon: Settings, roles: ['superadmin', 'admin'] },
    ],
  },
]

export default function Layout() {
  const { user, logout } = useAuthStore()
  const { dark, toggle } = useThemeStore()
  const navigate         = useNavigate()
  const location         = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  // All groups closed by default — null means nothing open
  const [openGroup, setOpenGroup] = useState(null)

  // When route changes — open the group that contains the active route
  // but only if we're not on dashboard (dashboard has no group)
  useEffect(() => {
    const path = location.pathname
    if (path === '/') { setOpenGroup(null); return; }
    for (const group of NAV_GROUPS) {
      if (group.items.some(item => path.startsWith(item.to))) {
        setOpenGroup(group.key)
        return
      }
    }
  }, [location.pathname])

  const handleLogout = async () => { await logout(); navigate('/login') }

  const toggleGroup = (key) => {
    setOpenGroup(prev => prev === key ? null : key)
  }

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-200 dark:border-gray-800 flex-shrink-0">
        <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center flex-shrink-0">
          <Shield className="w-5 h-5 text-white" />
        </div>
        <span className="font-bold text-gray-900 dark:text-white text-lg tracking-tight">Krajcara Admin</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto space-y-0.5">

        {/* Dashboard — always visible, not in any group */}
        <NavLink
          to="/"
          end
          onClick={() => { setMobileOpen(false); setOpenGroup(null) }}
          className={({ isActive }) => cn(
            'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
            isActive
              ? 'bg-brand text-white'
              : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
          )}
        >
          <LayoutDashboard className="w-4 h-4 flex-shrink-0" />
          Dashboard
        </NavLink>

        {/* Groups */}
        {NAV_GROUPS.map(group => {
          // Filter items by role
          const visibleItems = group.items.filter(item =>
            !item.roles || item.roles.includes(user?.role)
          )
          // Hide group if no visible items
          if (visibleItems.length === 0) return null
          // Hide group itself if group has role restriction
          if (group.roles && !group.roles.includes(user?.role)) return null

          const isOpen   = openGroup === group.key
          const isActive = visibleItems.some(item => location.pathname.startsWith(item.to))

          return (
            <div key={group.key}>
              {/* Group header */}
              <button
                onClick={() => toggleGroup(group.key)}
                className={cn(
                  'w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-semibold uppercase tracking-wider transition-colors mt-1',
                  isActive && !isOpen
                    ? 'text-brand dark:text-brand-light bg-brand/5 dark:bg-brand/10'
                    : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800/50'
                )}
              >
                <span>{group.label}</span>
                <ChevronDown className={cn(
                  'w-3.5 h-3.5 transition-transform duration-200',
                  isOpen && 'rotate-180'
                )} />
              </button>

              {/* Group items */}
              {isOpen && (
                <div className="mt-0.5 space-y-0.5">
                  {visibleItems.map(item => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={() => setMobileOpen(false)}
                      className={({ isActive }) => cn(
                        'flex items-center gap-3 pl-6 pr-3 py-2 rounded-lg text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-brand text-white'
                          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
                      )}
                    >
                      <item.icon className="w-4 h-4 flex-shrink-0" />
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* User footer */}
      <div className="px-3 py-3 border-t border-gray-200 dark:border-gray-800 flex-shrink-0">
        <NavLink
          to="/profile"
          onClick={() => setMobileOpen(false)}
          className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <div className="w-8 h-8 rounded-full bg-brand/10 dark:bg-brand/20 flex items-center justify-center flex-shrink-0">
            <User className="w-4 h-4 text-brand" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{user?.full_name || user?.username}</p>
            <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', roleColor(user?.role))}>{user?.role}</span>
          </div>
        </NavLink>
        <button
          onClick={handleLogout}
          className="w-full mt-1 flex items-center gap-2 px-2 py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex lg:flex-col w-56 bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800 flex-shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <aside className="relative w-56 h-full bg-white dark:bg-gray-900">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-14 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center px-4 gap-3 flex-shrink-0">
          <button className="lg:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" onClick={() => setMobileOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1" />
          <a href="/status" target="_blank" rel="noopener noreferrer"
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="Status page">
            <Shield className="w-4 h-4" />
          </a>
          <a href="/tv" target="_blank" rel="noopener noreferrer"
            className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            title="TV Monitor">
            <Monitor className="w-4 h-4" />
          </a>
          <button onClick={toggle} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" title={dark ? 'Light mode' : 'Dark mode'}>
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <NotificationBell />
          <NavLink to="/profile" className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" title="Profile">
            <User className="w-4 h-4" />
          </NavLink>
        </header>

        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
