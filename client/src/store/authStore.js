import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import api from '../lib/api'

export const useAuthStore = create(
  persist(
    (set) => ({
      user:            null,
      accessToken:     null,
      isAuthenticated: false,

      login: async (username, password) => {
        const { data } = await api.post('/auth/login', { username, password })
        // If TOTP required, return partial result — caller handles next step
        if (data.totp_required) return data
        set({ user: data.user, accessToken: data.token, isAuthenticated: true })
        api.defaults.headers.common['Authorization'] = `Bearer ${data.token}`
        return data.user
      },

      loginWithTotp: async (user_id, code) => {
        const { data } = await api.post('/totp/check', { user_id, code })
        set({ user: data.user, accessToken: data.token, isAuthenticated: true })
        api.defaults.headers.common['Authorization'] = `Bearer ${data.token}`
        return data.user
      },

      logout: async () => {
        try { await api.post('/auth/logout') } catch {}
        delete api.defaults.headers.common['Authorization']
        set({ user: null, accessToken: null, isAuthenticated: false })
      },

      setToken: (token) => {
        set({ accessToken: token })
        api.defaults.headers.common['Authorization'] = `Bearer ${token}`
      },

      updateUser: (updates) => {
        set(state => ({ user: { ...state.user, ...updates } }))
      }
    }),
    {
      name: 'krajcara-admin-auth',
      partialize: (state) => ({ user: state.user, accessToken: state.accessToken, isAuthenticated: state.isAuthenticated })
    }
  )
)
