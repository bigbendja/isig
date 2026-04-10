// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Suspense, lazy } from 'react'
import { AppShell } from '@/components/layout/AppShell'
import { Login } from '@/pages/Login'
import { Overview } from '@/pages/Overview'

// Lazy loading de páginas pesadas
const Personas      = lazy(() => import('@/pages/Personas').then(m => ({ default: m.Personas })))
const PersonaDetalle = lazy(() => import('@/pages/PersonaDetalle').then(m => ({ default: m.PersonaDetalle })))
const PersonaNueva   = lazy(() => import('@/pages/PersonaNueva').then(m => ({ default: m.PersonaNueva })))
const PersonaEditar      = lazy(() => import('@/pages/PersonaEditar').then(m => ({ default: m.PersonaEditar })))
const InstitucionEditar  = lazy(() => import('@/pages/InstitucionEditar').then(m => ({ default: m.InstitucionEditar })))
const Instituciones  = lazy(() => import('@/pages/Instituciones').then(m => ({ default: m.Instituciones })))
const InstitucionDet = lazy(() => import('@/pages/OtrasPages').then(m => ({ default: m.InstitucionDetalle })))
const InstitucionNueva = lazy(() => import('@/pages/InstitucionNueva').then(m => ({ default: m.InstitucionNueva })))
const Mapa           = lazy(() => import('@/pages/Mapa').then(m => ({ default: m.Mapa })))
const GrafoVinculos  = lazy(() => import('@/pages/GrafoVinculos').then(m => ({ default: m.GrafoVinculos })))
const Alertas        = lazy(() => import('@/pages/Alertas').then(m => ({ default: m.Alertas })))
const Investigaciones = lazy(() => import('@/pages/Investigaciones').then(m => ({ default: m.Investigaciones })))
const InvestigacionDetallePage = lazy(() => import('@/pages/InvestigacionDetalle').then(m => ({ default: m.InvestigacionDetalle })))
const InvestigacionDetalle = lazy(() => import('@/pages/InvestigacionDetalle').then(m => ({ default: m.InvestigacionDetalle })))
const AsistenteIA    = lazy(() => import('@/pages/AsistenteIA').then(m => ({ default: m.AsistenteIA })))
const Configuracion  = lazy(() => import('@/pages/Configuracion').then(m => ({ default: m.Configuracion })))
const Auditoria      = lazy(() => import('@/pages/Auditoria').then(m => ({ default: m.Auditoria })))
const Analytics      = lazy(() => import('@/pages/Analytics').then(m => ({ default: m.Analytics })))
const Usuarios       = lazy(() => import('@/pages/Usuarios').then(m => ({ default: m.Usuarios })))
const OSINTIngesta   = lazy(() => import('@/pages/OSINT').then(m => ({ default: m.OSINT })))
const Archivos       = lazy(() => import('@/pages/Archivos').then(m => ({ default: m.Archivos })))

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

function PageLoader() {
  return (
    <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-tertiary)' }}>
      <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--brand)' }} />
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<AppShell />}>
            <Route index element={<Overview />} />
            <Route path="personas" element={
              <Suspense fallback={<PageLoader />}><Personas /></Suspense>
            } />
            <Route path="personas/:id/editar" element={
              <Suspense fallback={<PageLoader />}><PersonaEditar /></Suspense>
            } />
            <Route path="instituciones/:id/editar" element={
              <Suspense fallback={<PageLoader />}><InstitucionEditar /></Suspense>
            } />
            <Route path="personas/nueva" element={
              <Suspense fallback={<PageLoader />}><PersonaNueva /></Suspense>
            } />
            <Route path="personas/:id" element={
              <Suspense fallback={<PageLoader />}><PersonaDetalle /></Suspense>
            } />
            <Route path="instituciones" element={
              <Suspense fallback={<PageLoader />}><Instituciones /></Suspense>
            } />
            <Route path="instituciones/nueva" element={
              <Suspense fallback={<PageLoader />}><InstitucionNueva /></Suspense>
            } />
            <Route path="instituciones/:id" element={
              <Suspense fallback={<PageLoader />}><InstitucionDet /></Suspense>
            } />
            <Route path="mapa" element={
              <Suspense fallback={<PageLoader />}><Mapa /></Suspense>
            } />
            <Route path="vinculos" element={
              <Suspense fallback={<PageLoader />}><GrafoVinculos /></Suspense>
            } />
            <Route path="alertas" element={
              <Suspense fallback={<PageLoader />}><Alertas /></Suspense>
            } />
            <Route path="investigaciones/:id" element={
              <Suspense fallback={<PageLoader />}><InvestigacionDetalle /></Suspense>
            } />
            <Route path="investigaciones" element={
              <Suspense fallback={<PageLoader />}><Investigaciones /></Suspense>
            } />
            <Route path="ia" element={
              <Suspense fallback={<PageLoader />}><AsistenteIA /></Suspense>
            } />
            <Route path="configuracion" element={
              <Suspense fallback={<PageLoader />}><Configuracion /></Suspense>
            } />
            <Route path="auditoria" element={
              <Suspense fallback={<PageLoader />}><Auditoria /></Suspense>
            } />
            <Route path="analytics" element={
              <Suspense fallback={<PageLoader />}><Analytics /></Suspense>
            } />
            <Route path="usuarios" element={
              <Suspense fallback={<PageLoader />}><Usuarios /></Suspense>
            } />
            <Route path="osint" element={
              <Suspense fallback={<PageLoader />}><OSINTIngesta /></Suspense>
            } />
            <Route path="archivos" element={
              <Suspense fallback={<PageLoader />}><Archivos /></Suspense>
            } />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}
