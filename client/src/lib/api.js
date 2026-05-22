import axios from 'axios'

const api = axios.create({
  baseURL: '/api',
  timeout: 30000
})

// Attach token on startup from persisted store
try {
  const stored = JSON.parse(localStorage.getItem('krajcara-admin-auth') || '{}')
  const token  = stored?.state?.accessToken
  if (token) api.defaults.headers.common['Authorization'] = `Bearer ${token}`
} catch {}

let isRefreshing = false
let failedQueue  = []

const processQueue = (error, token = null) => {
  failedQueue.forEach(p => error ? p.reject(error) : p.resolve(token))
  failedQueue = []
}

api.interceptors.response.use(
  res => res,
  async err => {
    const original      = err.config
    const isAuthEndpoint = original?.url?.includes('/auth/') || original?.url?.includes('/totp/')

    if (err.response?.status === 401 && !original._retry && !isAuthEndpoint) {
      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject })
        }).then(token => {
          original.headers['Authorization'] = `Bearer ${token}`
          return api(original)
        })
      }

      original._retry = true
      isRefreshing    = true

      try {
        const { useAuthStore } = await import('../store/authStore')
        await useAuthStore.getState().logout()
      } catch {}

      isRefreshing = false
      processQueue(err, null)
      window.location.href = '/login'
    }

    return Promise.reject(err)
  }
)

export default api
