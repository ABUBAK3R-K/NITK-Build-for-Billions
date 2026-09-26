import React, { useState, useEffect } from 'react';
import {
    BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, Tooltip,
    ResponsiveContainer, Legend, AreaChart, Area, CartesianGrid,
} from 'recharts';
import api from '../utils/api';

const FALLBACK_CONFIDENCE = [
    { name: 'Auto-Approved (>=80%)', value: 85, color: '#138808' },
    { name: 'Pending Review (60-80%)', value: 10, color: '#ff9933' },
    { name: 'Rejected (<60%)', value: 5, color: '#dc2626' },
];

const FALLBACK_DAILY = [
    { day: 'Mon', logs: 0 }, { day: 'Tue', logs: 0 }, { day: 'Wed', logs: 0 },
    { day: 'Thu', logs: 0 }, { day: 'Fri', logs: 0 }, { day: 'Sat', logs: 0 }, { day: 'Sun', logs: 0 },
];

export default function Dashboard() {
    const [stats, setStats] = useState(null);
    const [isLive, setIsLive] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(null);
    const [confidenceData, setConfidenceData] = useState(FALLBACK_CONFIDENCE);
    const [dailyLogs, setDailyLogs] = useState(FALLBACK_DAILY);
    const [siteData, setSiteData] = useState([]);

    useEffect(() => {
        async function fetchAll() {
            try {
                const res = await api.get('/api/admin/dashboard');
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                setStats({
                    active_workers: data.activeWorkers,
                    total_workers: data.totalWorkers,
                    pending_reviews: data.pendingReviews,
                    total_days_logged: data.totalDaysLogged,
                    average_days: data.averageDaysPerWorker,
                    onboarding_workers: data.onboardingWorkers,
                });
                setIsLive(true);

                // Chart data included in the same response
                if (data.trends?.length) setDailyLogs(data.trends);
                if (data.distribution?.length) setConfidenceData(data.distribution);
                if (data.sites?.length) setSiteData(data.sites);
            } catch {
                setStats({
                    active_workers: 0, total_workers: 0, pending_reviews: 0,
                    total_days_logged: 0, average_days: 0, onboarding_workers: 0,
                });
                setIsLive(false);
            }
            setLastUpdated(new Date());
        }
        fetchAll();
    }, []);

    if (!stats) return <div style={{ padding: '40px', color: 'var(--text-muted)' }}>Loading...</div>;

    const SITE_COLORS = ['#138808', '#ff9933', '#000080', '#1a8c38', '#e67e22'];

    return (
        <div>
            <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                    <h2>Dashboard</h2>
                    <p>Real-time overview of Nirman Mitra platform activity</p>
                    {lastUpdated && (
                        <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                            Last Updated: {lastUpdated.toLocaleTimeString()}
                        </p>
                    )}
                </div>
                <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: '6px',
                    padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 600,
                    background: isLive ? 'rgba(19,136,8,0.1)' : 'rgba(255,153,51,0.1)',
                    color: isLive ? '#138808' : '#ff9933',
                    border: `1px solid ${isLive ? 'rgba(19,136,8,0.3)' : 'rgba(255,153,51,0.3)'}`,
                }}>
                    <span style={{
                        width: '8px', height: '8px', borderRadius: '50%',
                        background: isLive ? '#138808' : '#ff9933',
                        boxShadow: isLive ? '0 0 6px #138808' : '0 0 6px #ff9933',
                    }} />
                    {isLive ? 'Live' : 'Demo'}
                </span>
            </div>

            <div className="stat-grid">
                <div className="stat-card">
                    <div className="stat-icon workers">👷</div>
                    <div className="stat-info"><h3>{stats.active_workers}</h3><p>Active Workers</p></div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon attendance">📸</div>
                    <div className="stat-info"><h3>{stats.total_days_logged}</h3><p>Total Days Logged</p></div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon reviews">⏳</div>
                    <div className="stat-info"><h3>{stats.pending_reviews}</h3><p>Pending Reviews</p></div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon certificates">📜</div>
                    <div className="stat-info"><h3>{stats.total_workers}</h3><p>Total Registered</p></div>
                </div>
            </div>

            <div className="charts-grid">
                <div className="chart-card">
                    <h3>AI Confidence Distribution</h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <PieChart>
                            <Pie data={confidenceData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} dataKey="value"
                                label={({ value }) => `${value}%`}>
                                {confidenceData.map((entry, i) => (<Cell key={i} fill={entry.color} />))}
                            </Pie>
                            <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#1a1a2e' }} />
                            <Legend />
                        </PieChart>
                    </ResponsiveContainer>
                </div>

                <div className="chart-card">
                    <h3>Daily Attendance Logs (Last 7 Days)</h3>
                    <ResponsiveContainer width="100%" height={280}>
                        <AreaChart data={dailyLogs}>
                            <defs>
                                <linearGradient id="attendanceGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#138808" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#138808" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                            <XAxis dataKey="day" stroke="#8896a6" fontSize={12} />
                            <YAxis stroke="#8896a6" fontSize={12} />
                            <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#1a1a2e' }} />
                            <Area type="monotone" dataKey="logs" stroke="#138808" strokeWidth={2}
                                fill="url(#attendanceGradient)" />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>

            {siteData.length > 0 && (
                <div className="charts-grid" style={{ marginTop: '20px' }}>
                    <div className="chart-card">
                        <h3>Attendance by Site</h3>
                        <ResponsiveContainer width="100%" height={280}>
                            <BarChart data={siteData} layout="vertical">
                                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                <XAxis type="number" stroke="#8896a6" fontSize={12} />
                                <YAxis dataKey="site" type="category" stroke="#8896a6" fontSize={11} width={120} />
                                <Tooltip contentStyle={{ background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', color: '#1a1a2e' }} />
                                <Bar dataKey="logs" radius={[0, 6, 6, 0]}>
                                    {siteData.map((_, i) => (
                                        <Cell key={i} fill={SITE_COLORS[i % SITE_COLORS.length]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>

                    <div className="chart-card">
                        <h3>Platform Health</h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '24px', padding: '20px 0' }}>
                            <div>
                                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Average Days/Worker</p>
                                <p style={{ fontSize: '28px', fontWeight: 700, color: 'var(--success)' }}>{stats.average_days}</p>
                            </div>
                            <div>
                                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Onboarding</p>
                                <p style={{ fontSize: '28px', fontWeight: 700, color: 'var(--warning)' }}>{stats.onboarding_workers}</p>
                            </div>
                            <div>
                                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Total Registered</p>
                                <p style={{ fontSize: '28px', fontWeight: 700 }}>{stats.total_workers}</p>
                            </div>
                            <div>
                                <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>AWS Services Active</p>
                                <p style={{ fontSize: '28px', fontWeight: 700, color: 'var(--accent-primary)' }}>15</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {siteData.length === 0 && (
                <div className="card" style={{ marginTop: '20px' }}>
                    <h3 style={{ marginBottom: '16px' }}>Platform Health</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
                        <div>
                            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Average Days/Worker</p>
                            <p style={{ fontSize: '24px', fontWeight: 700, color: 'var(--success)' }}>{stats.average_days}</p>
                        </div>
                        <div>
                            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Total Registered</p>
                            <p style={{ fontSize: '24px', fontWeight: 700 }}>{stats.total_workers}</p>
                        </div>
                        <div>
                            <p style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>AWS Services Active</p>
                            <p style={{ fontSize: '24px', fontWeight: 700, color: 'var(--accent-primary)' }}>15</p>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
