// src/main.tsx
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

// Aplicar tema guardado antes de renderizar (evita flash)
const savedTheme = (() => {
  try {
    const stored = JSON.parse(localStorage.getItem('sigint-theme') || '{}')
    return stored.state?.theme || 'system'
  } catch { return 'system' }
})()

const isDark =
  savedTheme === 'dark' ||
  (savedTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)

if (isDark) document.documentElement.classList.add('dark')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
