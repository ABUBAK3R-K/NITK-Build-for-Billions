import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import ReviewQueue from './pages/ReviewQueue';
import WorkerSearch from './pages/WorkerSearch';
import CertificateVerify from './pages/CertificateVerify';
import LoginPage from './pages/LoginPage';
import Sites from './pages/Sites';

// Heavy routes are split into their own chunks: Dashboard pulls in recharts,
// LandingPage carries a large amount of markup and CSS.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const LandingPage = lazy(() => import('./pages/LandingPage'));

function PageFallback() {
    return <div style={{ padding: '40px', color: 'var(--text-muted)' }}>Loading...</div>;
}

export default function App() {
    return (
        <BrowserRouter>
            <AuthProvider>
                <Suspense fallback={<PageFallback />}>
                    <Routes>
                        <Route path="/" element={<Navigate to="/home" replace />} />
                        <Route path="home" element={<LandingPage />} />
                        <Route path="login" element={<LoginPage />} />
                        <Route path="verify" element={<CertificateVerify />} />
                        <Route path="verify/:hash" element={<CertificateVerify />} />
                        <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                            <Route path="dashboard" element={<Suspense fallback={<PageFallback />}><Dashboard /></Suspense>} />
                            <Route path="review" element={<ReviewQueue />} />
                            <Route path="workers" element={<WorkerSearch />} />
                            <Route path="workers/:id" element={<WorkerSearch />} />
                            <Route path="sites" element={<Sites />} />
                        </Route>
                    </Routes>
                </Suspense>
            </AuthProvider>
        </BrowserRouter>
    );
}
