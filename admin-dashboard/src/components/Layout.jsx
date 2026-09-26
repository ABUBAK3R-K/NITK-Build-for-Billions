import React, { useState, useEffect } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';

export default function Layout() {
    const [reviewCount, setReviewCount] = useState(0);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const { admin, logout } = useAuth();
    const navigate = useNavigate();

    useEffect(() => {
        api.get('/api/admin/review-queue')
            .then(res => res.json())
            .then(data => setReviewCount(data.count || 0))
            .catch(() => {});
    }, []);

    const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

    async function handleLogout() {
        await logout();
        navigate('/login');
    }

    return (
        <div className="app-layout">
            {/* Mobile Sidebar Toggle */}
            <button className="sidebar-toggle" onClick={toggleSidebar} aria-label="Toggle Sidebar">
                {isSidebarOpen ? '\u2715' : '\u2630'}
            </button>

            {/* Mobile Backdrop */}
            {isSidebarOpen && (
                <div className="sidebar-backdrop" onClick={() => setIsSidebarOpen(false)} />
            )}

            <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
                <div className="sidebar-header">
                    <div className="sidebar-logo">
                        <div className="logo-icon">&#x1F3D7;&#xFE0F;</div>
                        <div>
                            <h1>Nirman Mitra</h1>
                            <span>Admin Dashboard</span>
                        </div>
                    </div>
                </div>
                <nav className="sidebar-nav">
                    <NavLink
                        to="/home"
                        className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                        onClick={() => setIsSidebarOpen(false)}
                    >
                        <span className="icon">&#x1F3E0;</span> Landing Page
                    </NavLink>
                    <NavLink
                        to="/dashboard"
                        className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                        onClick={() => setIsSidebarOpen(false)}
                    >
                        <span className="icon">&#x1F4CA;</span> Dashboard
                    </NavLink>
                    <NavLink
                        to="/review"
                        className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                        onClick={() => setIsSidebarOpen(false)}
                    >
                        <span className="icon">&#x1F4CB;</span> Review Queue
                        <span className="nav-badge">{reviewCount}</span>
                    </NavLink>
                    <NavLink
                        to="/workers"
                        className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                        onClick={() => setIsSidebarOpen(false)}
                    >
                        <span className="icon">&#x1F477;</span> Workers
                    </NavLink>
                    <NavLink
                        to="/verify"
                        className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                        onClick={() => setIsSidebarOpen(false)}
                    >
                        <span className="icon">&#x1F50D;</span> Verify Certificate
                    </NavLink>
                </nav>
                <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-color)', background: 'linear-gradient(to right, rgba(255,153,51,0.05), rgba(255,255,255,0.05), rgba(19,136,8,0.05))' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            {admin?.name || 'Admin'}<br />
                            <span style={{ fontSize: '11px', color: 'var(--green-india)' }}>{admin?.role || 'admin'}</span>
                        </div>
                        <button
                            onClick={handleLogout}
                            style={{
                                background: 'none',
                                border: '1px solid var(--border-color)',
                                borderRadius: '6px',
                                padding: '4px 10px',
                                fontSize: '12px',
                                color: 'var(--danger)',
                                cursor: 'pointer',
                                fontFamily: 'var(--font)',
                            }}
                        >
                            Logout
                        </button>
                    </div>
                </div>
            </aside>
            <main className="main-content">
                <div style={{
                    background: 'linear-gradient(135deg, rgba(255,153,51,0.08) 0%, rgba(255,255,255,0.9) 50%, rgba(19,136,8,0.08) 100%)',
                    border: '1px solid rgba(19,136,8,0.2)',
                    borderLeft: '4px solid #ff9933',
                    borderRadius: 'var(--border-radius-sm)',
                    padding: '14px 20px',
                    marginBottom: '24px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                }}>
                    <span style={{ fontSize: '22px', flexShrink: 0 }}>&#x1F4F1;</span>
                    <div>
                        <p style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '2px' }}>
                            Worker experience happens via WhatsApp. Watch the demo video for the full flow.
                        </p>
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                            This dashboard is the <strong>admin / welfare officer interface</strong> for managing registrations, reviewing AI-verified attendance, and issuing BOCW certificates.
                        </p>
                    </div>
                </div>
                <Outlet />
            </main>
        </div>
    );
}
