import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import ReviewQueue from './pages/ReviewQueue';
import WorkerSearch from './pages/WorkerSearch';
import CertificateVerify from './pages/CertificateVerify';
import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';

export default function App() {
    return (
        <BrowserRouter>
            <AuthProvider>
                <Routes>
                    <Route path="/" element={<Navigate to="/home" replace />} />
                    <Route path="home" element={<LandingPage />} />
                    <Route path="login" element={<LoginPage />} />
                    <Route path="verify" element={<CertificateVerify />} />
                    <Route path="verify/:hash" element={<CertificateVerify />} />
                    <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                        <Route path="dashboard" element={<Dashboard />} />
                        <Route path="review" element={<ReviewQueue />} />
                        <Route path="workers" element={<WorkerSearch />} />
                        <Route path="workers/:id" element={<WorkerSearch />} />
                    </Route>
                </Routes>
            </AuthProvider>
        </BrowserRouter>
    );
}
