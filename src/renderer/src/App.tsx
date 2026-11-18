import { lazy, Suspense, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ToastProvider } from './components/Toast'
import { api } from './lib/api'

const Dashboard = lazy(() => import('./pages/Dashboard'))
const History = lazy(() => import('./pages/History'))
const Monitors = lazy(() => import('./pages/Monitors'))
const Alerts = lazy(() => import('./pages/Alerts'))
const Audit = lazy(() => import('./pages/Audit'))
const Assistant = lazy(() => import('./pages/Assistant'))
const Settings = lazy(() => import('./pages/Settings'))
const Acceptance = lazy(() => import('./pages/Acceptance'))

export default function App() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const offData = api.onDataChanged(() => {
      void queryClient.invalidateQueries()
    })
    const offRealtime = api.onRealtimeUpdated(() => {
      void queryClient.invalidateQueries({ queryKey: ['realtime'] })
    })
    return () => {
      offData()
      offRealtime()
    }
  }, [queryClient])

  return (
    <ToastProvider>
      <Layout>
        <Suspense fallback={<div className="panel px-4 py-10 text-center text-sm text-slate-500">加载页面…</div>}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/history" element={<History />} />
            <Route path="/monitors" element={<Monitors />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/assistant" element={<Assistant />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="/acceptance" element={<Acceptance />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Layout>
    </ToastProvider>
  )
}
