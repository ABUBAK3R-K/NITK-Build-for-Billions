import React, { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const NAV = [
    { to: '/company', end: true, icon: '\u{1F4CA}', label: 'Overview' },
    { to: '/company/roster', icon: '\u{1F477}', label: "Today's Roster" },
    { to: '/company/flags', icon: '\u{1F6A9}', label: 'Flagged Check-ins' },
];

/** Frame for construction-company users: their own sites only, read-only */
export default function CompanyLayout() {
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const { admin, logout } = useAuth();
    const navigate = useNavigate();

    async function handleLogout() {
        await logout();
        navigate('/login');
    }

    return (
        <div className="app-layout">
            <button className="sidebar-toggle" onClick={() => setIsSidebarOpen(!isSidebarOpen)} aria-label="Toggle Sidebar">
                {isSidebarOpen ? '✕' : '☰'}
            </button>
            {isSidebarOpen && <div className="sidebar-backdrop" onClick={() => setIsSidebarOpen(false)} />}

            <aside className={`sidebar ${isSidebarOpen ? 'open' : ''}`}>
                <div className="sidebar-header">
                    <div className="sidebar-logo">
                        <div className="logo-icon">&#x1F3D7;&#xFE0F;</div>
                        <div>
                            <h1>Nirman Mitra</h1>
                            <span>Company Dashboard</span>
                        </div>
                    </div>
                </div>
                <nav className="sidebar-nav">
                    {NAV.map((item) => (
                        <NavLink
                            key={item.to}
                            to={item.to}
                            end={item.end}
                            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
                            onClick={() => setIsSidebarOpen(false)}
                        >
                            <span className="icon">{item.icon}</span> {item.label}
                        </NavLink>
                    ))}
                </nav>
                <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                            {admin?.company_name || admin?.name || 'Company'}<br />
                            <span style={{ fontSize: '11px', color: 'var(--green-india)' }}>company · view only</span>
                        </div>
                        <button className="btn btn-outline btn-sm" onClick={handleLogout} style={{ color: 'var(--danger)' }}>
                            Logout
                        </button>
                    </div>
                </div>
            </aside>

            <main className="main-content">
                <div className="card" style={{ borderLeft: '4px solid var(--saffron)', marginBottom: '24px', padding: '14px 20px' }}>
                    <p style={{ fontSize: '14px', fontWeight: 600, marginBottom: '2px' }}>View only</p>
                    <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                        Attendance at your sites is verified independently (face, location and voice) and reviewed by
                        the welfare board. Companies can see and export it, but cannot approve, reject or change it.
                    </p>
                </div>
                <Outlet />
            </main>
        </div>
    );
}
