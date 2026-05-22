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

        {/* Protected routes */}
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<DashboardPage />} />
          <Route path="profile"   element={<ProfilePage />} />
          <Route path="licences"   element={<LicencesPage />} />
          <Route path="monitors"   element={<MonitorsPage />} />
          <Route path="routers"    element={<RoutersPage />} />
          <Route path="dns"        element={<DnsPage />} />
          <Route path="proxmox"     element={<ProxmoxPage />} />
          <Route path="scanner"     element={<NetworkScannerPage />} />
          <Route path="automation"  element={<ScanAutomationPage />} />
          <Route path="users"    element={<ProtectedRoute roles={['superadmin', 'admin']}><UsersPage /></ProtectedRoute>} />
          <Route path="audit"    element={<ProtectedRoute roles={['superadmin', 'admin']}><AuditPage /></ProtectedRoute>} />
          <Route path="settings" element={<ProtectedRoute roles={['superadmin', 'admin']}><SettingsPage /></ProtectedRoute>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
