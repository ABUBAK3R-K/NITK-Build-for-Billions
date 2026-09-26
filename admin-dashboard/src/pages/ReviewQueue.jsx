import React, { useState, useEffect } from 'react';
import api from '../utils/api';

export default function ReviewQueue() {
    const [reviews, setReviews] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedLog, setSelectedLog] = useState(null);
    const [justification, setJustification] = useState('');
    const [processingId, setProcessingId] = useState(null);

    useEffect(() => {
        async function fetchReviews() {
            try {
                const res = await api.get('/api/admin/review-queue');
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                setReviews(data.items || []);
            } catch (err) {
                console.error('Failed to fetch review queue:', err);
            }
            setLoading(false);
        }
        fetchReviews();
    }, []);

    async function handleDecision(item, decision) {
        setProcessingId(item.worker_id + item.log_date);
        try {
            const res = await api.put(`/api/admin/review/${item.worker_id}`, {
                action: decision,
                justification: justification || (decision === 'approve' ? 'Approved by admin' : ''),
                workerId: item.worker_id,
                logDate: item.log_date,
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || `HTTP ${res.status}`);
            }
        } catch (err) {
            console.error(`Review action failed:`, err.message);
        }
        setReviews(prev => prev.filter(r => !(r.worker_id === item.worker_id && r.log_date === item.log_date)));
        setSelectedLog(null);
        setJustification('');
        setProcessingId(null);
    }

    function getConfidenceClass(c) {
        if (c >= 80) return 'high';
        if (c >= 60) return 'medium';
        return 'low';
    }

    if (loading) return <div style={{ padding: '40px', color: 'var(--text-muted)' }}>Loading review queue...</div>;

    return (
        <div>
            <div className="page-header">
                <h2>Review Queue</h2>
                <p>Flagged attendance logs requiring admin review — {reviews.length} items pending</p>
            </div>
            <div className="card">
                <div className="table-container">
                    <table>
                        <thead>
                            <tr><th>Worker</th><th>Date</th><th>Site</th><th>Confidence</th><th>Flagged Reason</th><th>Actions</th></tr>
                        </thead>
                        <tbody>
                            {reviews.map(log => {
                                const key = log.worker_id + log.log_date;
                                return (
                                    <tr key={key}>
                                        <td><div><strong>{log.worker_name}</strong><div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{log.worker_id}</div></div></td>
                                        <td>{log.log_date}</td>
                                        <td>{log.site_name || '-'}</td>
                                        <td>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <span>{log.face_confidence ? Math.round(log.face_confidence) : '-'}%</span>
                                                <div className="confidence-bar">
                                                    <div className={`confidence-fill ${getConfidenceClass(log.face_confidence || 0)}`} style={{ width: `${log.face_confidence || 0}%` }} />
                                                </div>
                                            </div>
                                        </td>
                                        <td style={{ maxWidth: '250px', fontSize: '13px', color: 'var(--text-secondary)' }}>{log.review_reason || '-'}</td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                {processingId === key ? (
                                                    <span style={{ fontSize: '13px', color: 'var(--text-muted)', padding: '4px 8px' }}>Processing...</span>
                                                ) : (
                                                    <>
                                                        <button className="btn btn-success btn-sm" disabled={!!processingId} onClick={() => handleDecision(log, 'approve')}>Approve</button>
                                                        <button className="btn btn-danger btn-sm" disabled={!!processingId} onClick={() => setSelectedLog(log)}>Reject</button>
                                                    </>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            {reviews.length === 0 && (
                                <tr><td colSpan="6" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No items pending review</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {selectedLog && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div className="card" style={{ width: '400px' }}>
                        <h3 style={{ marginBottom: '12px' }}>Rejection Justification</h3>
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>Provide a reason for rejection (required for audit trail):</p>
                        <textarea className="search-input" style={{ width: '100%', height: '80px', resize: 'vertical' }}
                            value={justification} onChange={e => setJustification(e.target.value)}
                            placeholder="e.g., Face does not match registered photo..." />
                        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
                            <button className="btn btn-outline btn-sm" disabled={!!processingId} onClick={() => { setSelectedLog(null); setJustification(''); }}>Cancel</button>
                            <button className="btn btn-danger btn-sm" disabled={!justification.trim() || !!processingId} onClick={() => handleDecision(selectedLog, 'reject')}>
                                {processingId ? 'Processing...' : 'Confirm Rejection'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
