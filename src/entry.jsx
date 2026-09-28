import React, { Suspense, lazy } from 'react'
import { createRoot } from 'react-dom/client'
import { installStorageGuard } from './safeStorage'
import { AccessGate, AppErrorBoundary, isLocalDevHost } from './access'
import './entry.css'

installStorageGuard()
const App = lazy(() => import('./main'))

if ('serviceWorker' in navigator && !isLocalDevHost()) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .catch(error => console.warn('[wwcxrl] service worker registration failed', error.message))
  }, { once: true })
}

createRoot(document.getElementById('root')).render(
  <AppErrorBoundary>
    <AccessGate>
      <Suspense fallback={<div className="app-loading" role="status">正在打开小星球…</div>}>
        <App />
      </Suspense>
    </AccessGate>
  </AppErrorBoundary>
)
