import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuthStore }  from './store/authStore'
import { useThemeStore } from './store/themeStore'
import Layout            from './components/shared/Layout'
import LoginPage         from './pages/LoginPage'
import ChangePasswordPage from './pages/ChangePasswordPage'
import DashboardPage     from './pages/DashboardPage'
import StatusPage        from './pages/StatusPage'
import UsersPage         from './pages/UsersPage'
import AuditPage         from './pages/AuditPage'
import SettingsPage      from './pages/SettingsPage'
import ProfilePage       from './pages/ProfilePage'
import LicencesPage      from './pages/LicencesPage'
import MonitorsPage      from './pages/MonitorsPage'
import RoutersPage       from './pages/RoutersPage'
import DnsPage           from './pages/DnsPage'
import ProxmoxPage       from './pages/ProxmoxPage'
import NetworkScannerPage from './pages/NetworkScannerPage'
import ScanAutomationPage from './pages/ScanAutomationPage'
import IPSpacePage        from './pages/IPSpacePage'
import PatchManagementPage from './pages/PatchManagementPage'
import NotificationLogPage from './pages/NotificationLogPage'
import ReportsPage         from './pages/ReportsPage'
import TVPage              from './pages/TVPage'
import NetSpeedPage        from './pages/NetSpeedPage'
import M365Page            from './pages/M365Page'
import BackupPage          from './pages/BackupPage'
// Faza 1 — Servers & Scripts
import ServersPage         from './pages/ServersPage'
import TerminalPage        from './pages/TerminalPage'
// Faza 2 — Metrics History
import MetricsPage         from './pages/MetricsPage'
// Faza 3 — Windows Servers / WinRM
import WinRMPage           from './pages/WinRMPage'

function ProtectedRoute({ children, roles }) {
  const { isAuthenticated, user } = useAuthStore()
  if (!isAuthenticated) return <Navigate to="/login" replace />
  if (user?.first_login) return <Navigate to="/change-password" replace />
  if (roles && !roles.includes(user?.role)) return <Navigate to="/" replace />
  return children
}

export default function App() {
  const { init } = useThemeStore()
  useEffect(() => { init() }, [init])

  return (
    <BrowserRouter>
      <Routes>
        {/* Public routes */}
        <Route path="/login"           element={<LoginPage />} />
        <Route path="/change-password" element={<ChangePasswordPage />} />
        <Route path="/status"          element={<StatusPage />} />
        <Route path="/tv"              element={<TVPage />} />
        {/* Faza 1 — Terminal opens in new window, no Layout */}
        <Route path="/terminal/:serverId" element={<TerminalPage />} />

        {/* Protected routes */}
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<DashboardPage />} />
          <Route path="profile"          element={<ProfilePage />} />
          <Route path="licences"         element={<LicencesPage />} />
          <Route path="monitors"         element={<MonitorsPage />} />
          <Route path="routers"          element={<RoutersPage />} />
          <Route path="dns"              element={<DnsPage />} />
          <Route path="proxmox"          element={<ProxmoxPage />} />
          <Route path="scanner"          element={<NetworkScannerPage />} />
          <Route path="automation"       element={<ScanAutomationPage />} />
          <Route path="ipspace"          element={<IPSpacePage />} />
          <Route path="patches"          element={<PatchManagementPage />} />
          <Route path="notification-log" element={<NotificationLogPage />} />
          <Route path="reports"          element={<ReportsPage />} />
          <Route path="netspeed"         element={<NetSpeedPage />} />
          <Route path="m365"             element={<M365Page />} />
          {/* Faza 1 */}
          <Route path="servers"          element={<ServersPage />} />
          {/* Faza 2 */}
          <Route path="metrics"          element={<MetricsPage />} />
          {/* Faza 3 */}
          <Route path="winrm"            element={<WinRMPage />} />
          {/* Protected by role */}
          <Route path="backup"   element={<ProtectedRoute roles={['superadmin']}><BackupPage /></ProtectedRoute>} />
          <Route path="users"    element={<ProtectedRoute roles={['superadmin', 'admin']}><UsersPage /></ProtectedRoute>} />
          <Route path="audit"    element={<ProtectedRoute roles={['superadmin', 'admin']}><AuditPage /></ProtectedRoute>} />
          <Route path="settings" element={<ProtectedRoute roles={['superadmin', 'admin']}><SettingsPage /></ProtectedRoute>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
