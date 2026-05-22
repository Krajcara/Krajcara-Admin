import { useState } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard, Shield, LogOut, Sun, Moon, Menu, User,
  Users, Settings, BookOpen, KeyRound, RefreshCw, Activity, Network, Globe,
  Server, Scan, CalendarClock, Wifi, Cloud, HardDrive
} from 'lucide-react'
import { useAuthStore } from '../../store/authStore'
import { useThemeStore } from '../../store/themeStore'
import { cn, roleColor } from '../../lib/utils'

const NAV_ITEMS = [
  { to: '/',          label: 'Dashboard', icon: LayoutDashboard, exact: true },
  { separator: true,  label: 'Inventory' },
  { to: '/licences',  label: 'Licences',  icon: KeyRound },
  { separator: true,  label: 'Network' },
  { to: '/monitors',  label: 'Uptime Monitor', icon: Activity },
  { to: '/routers',   label: 'Routers',   icon: Network },
  { to: '/dns',       label: 'DNS',       icon: Globe },
  { to: '/netspeed',  label: 'Net Speed',  icon: Wifi },
  { separator: true,  label: 'Advanced' },
  { to: '/m365',       label: 'Microsoft 365', icon: Cloud },
  { to: '/backup',     label: 'Backup',        icon: HardDrive, roles: ['superadmin'] },
  { separator: true,  label: 'Account' },
  { to: '/profile',   label: 'Profile',   icon: User },
  { separator: true,  label: 'Infrastructure' },
  { to: '/proxmox',    label: 'Proxmox',          icon: Server },
  { to: '/scanner',    label: 'Network Scanner',   icon: Scan },
  { to: '/automation', label: 'Scan Automation',   icon: CalendarClock },
  { separator: true,  label: 'Admin' },
  { to: '/users',     label: 'Users',     icon: Users,    roles: ['superadmin', 'admin'] },
  { to: '/audit',     label: 'Audit Log', icon: BookOpen, roles: ['superadmin', 'admin'] },
  { to: '/settings',  label: 'Settings',  icon: Settings, roles: ['superadmin', 'admin'] },
]

export default function Layout() {
  const { user, logout }  = useAuthStore()
  const { dark, toggle }  = useThemeStore()
  const navigate          = useNavigate()
  const [open, setOpen]   = useState(false)

  const handleLogout = async () => {
    await logout()
    navigate('/login')
  }

  const filteredNav = NAV_ITEMS.filter(item =>
    item.separator || !item.roles || item.roles.includes(user?.role)
  )

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-2 px-5 py-4 border-b border-gray-200 dark:border-gray-800">
        <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center flex-shrink-0">
          <Shield className="w-5 h-5 text-white" />
        </div>
        <span className="font-bold text-gray-900 dark:text-white text-lg tracking-tight">Krajcara Admin</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {filteredNav.map((item, i) => {
          if (item.separator) return (
              <div key={i} className="pt-2 pb-1">
                <div className="border-t border-gray-200 dark:border-gray-800 mb-1" />
                {item.label && <p className="px-3 text-xs font-semibold text-gray-400 uppercase tracking-wider mt-1">{item.label}</p>}
              </div>
            )
          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.exact}
              onClick={() => setOpen(false)}
              className={({ isActive }) => cn(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
                isActive
                  ? 'bg-brand text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-white'
              )}
            >
              <item.icon className="w-4 h-4 flex-shrink-0" />
              {item.label}
            </NavLink>
          )
        })}
      </nav>

      {/* User footer */}
      <div className="px-3 py-3 border-t border-gray-200 dark:border-gray-800">
        <NavLink to="/profile" onClick={() => setOpen(false)}
          className="flex items-center gap-3 px-2 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors group">
          <div className="w-8 h-8 rounded-full bg-brand/10 dark:bg-brand/20 flex items-center justify-center flex-shrink-0">
            <User className="w-4 h-4 text-brand" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{user?.full_name || user?.username}</p>
            <span className={cn('text-xs px-1.5 py-0.5 rounded font-medium', roleColor(user?.role))}>{user?.role}</span>
          </div>
        </NavLink>
        <button onClick={handleLogout}
          className="w-full mt-1 flex items-center gap-2 px-2 py-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
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

      {/* Mobile sidebar overlay */}
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <aside className="relative w-56 h-full bg-white dark:bg-gray-900">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top header */}
        <header className="h-14 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 flex items-center px-4 gap-3 flex-shrink-0">
          <button className="lg:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" onClick={() => setOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <div className="flex-1" />
          <button onClick={toggle} className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" title={dark ? 'Light mode' : 'Dark mode'}>
            {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <NavLink to="/profile" className="p-2 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors" title="Profile">
            <User className="w-4 h-4" />
          </NavLink>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto p-6">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
