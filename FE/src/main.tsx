import {StrictMode, Suspense, lazy} from 'react';
import {createRoot} from 'react-dom/client';
import {BrowserRouter, Navigate, Route, Routes} from 'react-router-dom';
import App from './App.tsx';
import './index.css';

// Lazy so the parent-facing app never downloads the admin console.
const AdminApp = lazy(() => import('./admin/AdminApp'));
const SupportPage = lazy(() => import('./components/SupportPage'));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route
          path="/support"
          element={
            <Suspense fallback={<p className="min-h-screen bg-slate-950 p-6 text-slate-200">Đang tải…</p>}>
              <SupportPage />
            </Suspense>
          }
        />
        <Route
          path="/admin/*"
          element={
            <Suspense fallback={<p className="p-6">Đang tải…</p>}>
              <AdminApp />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);
