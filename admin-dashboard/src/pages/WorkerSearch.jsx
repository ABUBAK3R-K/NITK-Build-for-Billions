import React, { useState, useEffect } from 'react';
import api from '../utils/api';
const LANGUAGE_MAP = { hi: 'Hindi', en: 'English', te: 'Telugu', ta: 'Tamil', bn: 'Bengali', gu: 'Gujarati', kn: 'Kannada', ml: 'Malayalam', mr: 'Marathi' };

export default function WorkerSearch() {
    const [query, setQuery] = useState('');
    const [workers, setWorkers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedWorker, setSelectedWorker] = useState(null);

    useEffect(() => {
        async function fetchWorkers() {
            try {
                const res = await api.get('/api/admin/workers');
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                setWorkers(data.workers || []);
            } catch (err) {
                console.error('Failed to fetch workers:', err);
            }
            setLoading(false);
        }
        fetchWorkers();
    }, []);

    const filtered = workers.filter(w =>
        (w.name || '').toLowerCase().includes(query.toLowerCase()) ||
        (w.worker_id || '').toLowerCase().includes(query.toLowerCase()) ||
        (w.phone_number || '').includes(query)
    );

    const threshold = 90;

    if (loading) return <div style={{ padding: '40px', color: 'var(--text-muted)' }}>Loading workers...</div>;

    return (
        <div>
            <div className="page-header">
                <h2>Worker Search</h2>
                <p>Search by worker ID, name, or phone number</p>
            </div>
            <div className="search-bar">
                <input className="search-input" type="text" placeholder="Search workers by ID, name, or phone..."
                    value={query} onChange={e => setQuery(e.target.value)} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: selectedWorker ? '1fr 1fr' : '1fr', gap: '20px' }}>
                <div className="card">
                    <h3 style={{ marginBottom: '16px' }}>Workers ({filtered.length})</h3>
                    <div className="table-container">
                        <table>
                            <thead><tr><th>Name</th><th>Language</th><th>Days</th><th>Status</th><th>Docs</th></tr></thead>
                            <tbody>
                                {filtered.map(w => (
                                    <tr key={w.worker_id} onClick={() => setSelectedWorker(w)} style={{ cursor: 'pointer' }}>
                                        <td><div><strong>{w.name}</strong><div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{w.worker_id}</div></div></td>
                                        <td>{LANGUAGE_MAP[w.preferred_language] || w.preferred_language}</td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span style={{ fontWeight: 600, color: w.total_days_logged >= threshold ? 'var(--success)' : 'var(--text-primary)' }}>{w.total_days_logged}</span>
                                                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>/ {threshold}</span>
                                            </div>
                                        </td>
                                        <td><span className={`badge ${w.profile_status}`}>{w.profile_status}</span></td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '4px' }}>
                                                <span title="Aadhaar">{w.aadhaar_verified ? '\u2705' : '\u274C'}</span>
                                                <span title="Selfie">{w.selfie_verified ? '\u2705' : '\u274C'}</span>
                                                <span title="Bank">{w.bank_verified ? '\u2705' : '\u274C'}</span>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                                {filtered.length === 0 && (
                                    <tr><td colSpan="5" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No workers found</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {selectedWorker && (
                    <div className="card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h3>Worker Profile</h3>
                            <button className="btn btn-outline btn-sm" onClick={() => setSelectedWorker(null)}>Close</button>
                        </div>
                        <div style={{ marginBottom: '20px' }}>
                            <div style={{ fontSize: '20px', fontWeight: 700 }}>{selectedWorker.name}</div>
                            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }}>{selectedWorker.worker_id} | {selectedWorker.phone_number}</div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                            <div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Status</div>
                                <span className={`badge ${selectedWorker.profile_status}`}>{selectedWorker.profile_status}</span>
                            </div>
                            <div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Language</div>
                                <span>{LANGUAGE_MAP[selectedWorker.preferred_language] || selectedWorker.preferred_language}</span>
                            </div>
                            <div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Days Logged</div>
                                <span style={{ fontSize: '20px', fontWeight: 700 }}>{selectedWorker.total_days_logged}</span>
                                <span style={{ fontSize: '13px', color: 'var(--text-muted)' }}> / {threshold}</span>
                            </div>
                            <div>
                                <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginBottom: '4px' }}>Days Remaining</div>
                                <span style={{ fontSize: '20px', fontWeight: 700, color: selectedWorker.total_days_logged >= threshold ? 'var(--success)' : 'var(--warning)' }}>
                                    {Math.max(0, threshold - selectedWorker.total_days_logged)}
                                </span>
                            </div>
                        </div>
                        <div style={{ marginBottom: '20px' }}>
                            <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Document Verification</div>
                            {[
                                { label: 'Aadhaar Card', verified: selectedWorker.aadhaar_verified },
                                { label: 'Selfie (Face)', verified: selectedWorker.selfie_verified },
                                { label: 'Bank Passbook', verified: selectedWorker.bank_verified },
                            ].map((doc, i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--border-color)' }}>
                                    <span style={{ fontSize: '13px' }}>{doc.label}</span>
                                    <span className={`badge ${doc.verified ? 'approved' : 'rejected'}`}>{doc.verified ? 'Verified' : 'Missing'}</span>
                                </div>
                            ))}
                        </div>
                        <div>
                            <div style={{ fontSize: '14px', fontWeight: 600, marginBottom: '8px' }}>Progress to Certificate</div>
                            <div style={{ background: 'var(--bg-primary)', borderRadius: '8px', height: '12px', overflow: 'hidden' }}>
                                <div style={{
                                    width: `${Math.min(100, (selectedWorker.total_days_logged / threshold) * 100)}%`, height: '100%',
                                    background: selectedWorker.total_days_logged >= threshold ? 'var(--success)' : 'var(--accent-gradient)',
                                    borderRadius: '8px', transition: 'width 0.5s ease',
                                }} />
                            </div>
                            <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                                {Math.round((selectedWorker.total_days_logged / threshold) * 100)}% complete
                                {selectedWorker.total_days_logged >= threshold && ' - Certificate Eligible!'}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
