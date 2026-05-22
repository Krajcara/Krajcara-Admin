import { useEffect, useRef } from 'react'
import { io } from 'socket.io-client'
import { useAuthStore } from '../store/authStore'

let socket = null

export function getSocket() {
  return socket
}

export function useSocket(handlers = {}) {
  const { accessToken } = useAuthStore()
  const handlersRef = useRef(handlers)
  handlersRef.current = handlers

  useEffect(() => {
    if (!accessToken) return

    if (!socket || !socket.connected) {
      socket = io('/', {
        auth: { token: accessToken },
        reconnectionAttempts: 5,
        reconnectionDelay: 2000
      })
    }

    const events = Object.keys(handlersRef.current)
    events.forEach(event => {
      socket.on(event, (...args) => handlersRef.current[event]?.(...args))
    })

    return () => {
      events.forEach(event => socket.off(event))
    }
  }, [accessToken])
}
