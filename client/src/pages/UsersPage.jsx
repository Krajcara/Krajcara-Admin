import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Users } from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../store/authStore'
import { Card, Button, Modal, Input, Select, Table, Th, Td, Badge, Empty, Spinner, AlertBox } from '../components/shared/UI'
import { roleColor, formatDate } from '../lib/utils'

const ROLES = ['superadmin', 'admin', 'operator', 'viewer']

function UserForm({ initial, onSave, onCancel }) {
  const [form,    setForm]    = useState(initial || { username: '', password: '', full_name: '', email: '', role: 'viewer' })
  const [error,   setError]   = useState('')
  const [loading, setLoading] = useState(false)
  const isEdit = !!initial?.id
  const f = k => e => setForm(p => ({ ...p, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const payload = { ...form }
      if (isEdit && !payload.password) delete payload.password
      isEdit ? await api.put(`/users/${initial.id}`, payload) : await api.post('/users', payload)
      onSave()
    } catch (err) {
      setError(err.response?.data?.error || 'Error saving user')
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={submit} autoComplete="off" className="space-y-4">
      {error && <AlertBox type="error">{error}</AlertBox>}
      <Input label="Username" name="new-username" autoComplete="new-password" value={form.username} onChange={f('username')} required disabled={isEdit} />
      <Input label={isEdit ? 'New password (leave blank to keep)' : 'Password'} type="password" name="new-password" autoComplete="new-password" value={form.password} onChange={f('password')} required={!isEdit} />
      <Input label="Full name" name="full-name" autoComplete="new-password" value={form.full_name || ''} onChange={f('full_name')} />
      <Input label="Email" type="email" name="new-email" autoComplete="new-password" value={form.email || ''} onChange={f('email')} />
      <Select label="Role" value={form.role} onChange={f('role')}>
        {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
      </Select>
      <div className="flex gap-3 pt-2">
        <Button type="submit" loading={loading}>{isEdit ? 'Save changes' : 'Create user'}</Button>
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </form>
  )
}

export default function UsersPage() {
  const [users,   setUsers]   = useState([])
  const [loading, setLoading] = useState(true)
  const [modal,   setModal]   = useState(null) // null | 'create' | user object
  const [delId,   setDelId]   = useState(null)
  const { user: me }          = useAuthStore()

  const load = () => api.get('/users').then(r => setUsers(r.data)).finally(() => setLoading(false))
  useEffect(() => { load() }, [])

  const handleDelete = async () => {
    try { await api.delete(`/users/${delId}`); setDelId(null); load() } catch {}
  }

  if (loading) return <div className="flex justify-center py-20"><Spinner className="w-8 h-8" /></div>

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-white">Users</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{users.length} user{users.length !== 1 ? 's' : ''}</p>
        </div>
        <Button onClick={() => setModal('create')}><Plus className="w-4 h-4" />Add user</Button>
      </div>

      <Card>
        <Table>
          <thead>
            <tr>
              <Th>Username</Th>
              <Th>Full name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Status</Th>
              <Th>Last login</Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr><td colSpan={7}><Empty icon={Users} title="No users" /></td></tr>
            )}
            {users.map(u => (
              <tr key={u.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                <Td><span className="font-medium text-gray-900 dark:text-white">{u.username}</span></Td>
                <Td>{u.full_name || '—'}</Td>
                <Td>{u.email || '—'}</Td>
                <Td><Badge className={roleColor(u.role)}>{u.role}</Badge></Td>
                <Td>
                  <span className={`text-xs px-2 py-0.5 rounded font-medium ${u.is_active ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-500'}`}>
                    {u.is_active ? 'Active' : 'Inactive'}
                  </span>
                </Td>
                <Td>{u.last_login ? formatDate(u.last_login) : '—'}</Td>
                <Td>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setModal(u)} className="p-1.5 text-gray-400 hover:text-brand rounded transition-colors"><Pencil className="w-3.5 h-3.5" /></button>
                    {u.id !== me?.id && me?.role === 'superadmin' && (
                      <button onClick={() => setDelId(u.id)} className="p-1.5 text-gray-400 hover:text-red-500 rounded transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {/* Create/Edit modal */}
      <Modal open={!!modal} onClose={() => setModal(null)} title={modal === 'create' ? 'Add user' : `Edit — ${modal?.username}`}>
        {modal && <UserForm initial={modal === 'create' ? null : modal} onSave={() => { setModal(null); load() }} onCancel={() => setModal(null)} />}
      </Modal>

      {/* Delete confirm */}
      <Modal open={!!delId} onClose={() => setDelId(null)} title="Delete user" size="sm">
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">Are you sure you want to delete this user? This cannot be undone.</p>
        <div className="flex gap-3">
          <Button variant="danger" onClick={handleDelete}>Delete</Button>
          <Button variant="secondary" onClick={() => setDelId(null)}>Cancel</Button>
        </div>
      </Modal>
    </div>
  )
}
