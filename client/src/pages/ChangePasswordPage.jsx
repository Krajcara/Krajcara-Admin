import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shield } from 'lucide-react'
import { useAuthStore } from '../store/authStore'
import { Button, Input, AlertBox } from '../components/shared/UI'
import api from '../lib/api'

export default function ChangePasswordPage() {
  const [form,    setForm]    = useState({ current_password: '', new_password: '', confirm: '' })
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const { user, updateUser }  = useAuthStore()
  const navigate              = useNavigate()

  const isFirst = user?.first_login

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    if (form.new_password !== form.confirm) { setError('Passwords do not match'); return }
    if (form.new_password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    try {
      await api.post('/auth/change-password', {
        current_password: form.current_password,
        new_password:     form.new_password
      })
      updateUser({ first_login: false })
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to change password')
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {isFirst ? 'Set your password' : 'Change password'}
          </h1>
          {isFirst && <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">Please set a new password before continuing.</p>}
        </div>

        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-800 p-6">
          <form onSubmit={handleSubmit} autoComplete="off" className="space-y-4">
            {error && <AlertBox type="error">{error}</AlertBox>}
            {!isFirst && (
              <Input label="Current password" type="password" autoComplete="new-password" value={form.current_password} onChange={e => setForm(p => ({ ...p, current_password: e.target.value }))} required />
            )}
            <Input label="New password" type="password" autoComplete="new-password" value={form.new_password} onChange={e => setForm(p => ({ ...p, new_password: e.target.value }))} required />
            <Input label="Confirm new password" type="password" autoComplete="new-password" value={form.confirm} onChange={e => setForm(p => ({ ...p, confirm: e.target.value }))} required />
            <Button type="submit" loading={loading} className="w-full">Save password</Button>
          </form>
        </div>
      </div>
    </div>
  )
}
