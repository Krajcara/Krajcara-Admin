import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { Button, Input, AlertBox } from '../components/shared/UI'

export default function LoginPage() {
  const [step,    setStep]    = useState('credentials') // 'credentials' | 'totp'
  const [form,    setForm]    = useState({ username: '', password: '', code: '' })
  const [userId,  setUserId]  = useState(null)
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const { login, loginWithTotp } = useAuthStore()
  const navigate = useNavigate()

  const handleCredentials = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const result = await login(form.username, form.password)
      if (result?.totp_required) {
        setUserId(result.user_id)
        setStep('totp')
        return
      }
      if (result?.first_login) {
        navigate('/change-password')
      } else {
        navigate('/')
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  const handleTotp = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const user = await loginWithTotp(userId, form.code)
      if (user?.first_login) {
        navigate('/change-password')
      } else {
        navigate('/')
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Invalid code')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-14 h-14 bg-brand rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Krajcara Admin</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">IT Infrastructure Management</p>
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-6">
          {step === 'credentials' && (
            <form onSubmit={handleCredentials} autoComplete="off" className="space-y-4">
              {error && <AlertBox type="error">{error}</AlertBox>}
              <Input
                label="Username"
                name="username"
                autoComplete="new-password"
                value={form.username}
                onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
                autoFocus
                required
              />
              <Input
                label="Password"
                type="password"
                name="password"
                autoComplete="new-password"
                value={form.password}
                onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
                required
              />
              <Button type="submit" loading={loading} className="w-full">Sign in</Button>
            </form>
          )}

          {step === 'totp' && (
            <form onSubmit={handleTotp} autoComplete="off" className="space-y-4">
              {error && <AlertBox type="error">{error}</AlertBox>}
              <div className="text-center mb-2">
                <p className="text-sm text-gray-600 dark:text-gray-400">Enter the 6-digit code from your authenticator app or a backup code.</p>
              </div>
              <Input
                label="Authentication code"
                name="totp_code"
                autoComplete="new-password"
                value={form.code}
                onChange={e => setForm(p => ({ ...p, code: e.target.value }))}
                placeholder="000000"
                autoFocus
                required
              />
              <Button type="submit" loading={loading} className="w-full">Verify</Button>
              <button type="button" onClick={() => { setStep('credentials'); setError('') }} className="w-full text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors mt-1">
                ← Back to login
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
