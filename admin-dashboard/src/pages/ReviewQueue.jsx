import React, { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { notifyReviewQueueChanged, networkErrorMessage } from '../utils/events';

const PAGE_LIMIT = 50;

/** Stable id for a queue item: backend sends log_id = `${worker_id}#${log_date}` (older backends omit it). */
function logIdOf(item) {
    return item.log_id || `${item.worker_id}#${item.log_date}`;
}

function getConfidenceClass(c) {
    if (c >= 80) return 'high';
    if (c >= 60) return 'medium';
    return 'low';
}

function SignalConfidence({ label, value }) {
    const has = typeof value === 'number' && !Number.isNaN(value);
    const pct = has ? Math.max(0, Math.min(100, Math.round(value))) : 0;
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', marginBottom: '3px' }}>
            <span style={{ width: '38px', color: 'var(--text-muted)' }}>{label}</span>
            <div className="confidence-bar">
                <div className={`confidence-fill ${getConfidenceClass(pct)}`} style={{ width: `${pct}%` }} />
            </div>
            <span style={{ minWidth: '32px', textAlign: 'right' }}>{has ? `${pct}%` : '-'}</span>
        </div>
    );
}

export default function ReviewQueue() {
    const [reviews, setReviews] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [notice, setNotice] = useState('');
    const [rowErrors, setRowErrors] = useState({});
    const [selectedLog, setSelectedLog] = useState(null);
    const [modalError, setModalError] = useState('');
    const [justification, setJustification] = useState('');
    const [processingId, setProcessingId] = useState(null);

    const fetchReviews = useCallback(async () => {
        setLoading(true);
        setLoadError('');
        try {
            const res = await api.get(`/api/admin/review-queue?limit=${PAGE_LIMIT}`);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${res.status}`);
            }
            const data = await res.json();
            setReviews(data.items || []);
            setRowErrors({});
        } catch (err) {
            setLoadError(networkErrorMessage(err, 'Could not reach the server. Check your connection.'));
        }
        setLoading(false);
    }, []);

    useEffect(() => { fetchReviews(); }, [fetchReviews]);

    function removeRow(id) {
        setReviews(prev => prev.filter(r => logIdOf(r) !== id));
        setRowErrors(prev => { const next = { ...prev }; delete next[id]; return next; });
    }

    async function handleDecision(item, decision) {
        const id = logIdOf(item);
        setProcessingId(id);
        setRowErrors(prev => ({ ...prev, [id]: '' }));
        setModalError('');
        setNotice('');

        let outcome = 'error';
        let message = '';
        try {
            const res = await api.put(`/api/admin/review/${encodeURIComponent(id)}`, {
                action: decision,
                justification: justification || (decision === 'approve' ? 'Approved by admin' : ''),
                workerId: item.worker_id,
                logDate: item.log_date,
            });
            if (res.ok) {
                outcome = 'ok';
            } else {
                const err = await res.json().catch(() => ({}));
                if (res.status === 409) {
                    outcome = 'stale';
                    message = `${item.worker_name || item.worker_id} (${item.log_date}) was already reviewed — removed from the queue.`;
                } else if (res.status === 404) {
                    outcome = 'stale';
                    message = `${item.worker_name || item.worker_id} (${item.log_date}): attendance log not found — removed from the queue.`;
                } else {
                    message = err.error || `Request failed (HTTP ${res.status})`;
                }
            }
        } catch (err) {
            message = networkErrorMessage(err);
        }

        if (outcome === 'ok' || outcome === 'stale') {
            removeRow(id);
            setSelectedLog(null);
            setJustification('');
            if (outcome === 'stale') setNotice(message);
            notifyReviewQueueChanged();
        } else {
            // Keep the row so the admin can retry
            setRowErrors(prev => ({ ...prev, [id]: `${decision === 'approve' ? 'Approve' : 'Reject'} failed: ${message}` }));
            if (selectedLog) setModalError(message);
        }
        setProcessingId(null);
    }

    if (loading && reviews.length === 0 && !loadError) {
        return <div style={{ padding: '40px', color: 'var(--text-muted)' }}>Loading review queue...</div>;
    }

    return (
        <div>
            <div className="page-header">
                <h2>Review Queue</h2>
                <p>Flagged attendance logs requiring admin review — {reviews.length} items pending</p>
                {reviews.length >= PAGE_LIMIT && (
                    <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '4px' }}>
                        Showing the first {reviews.length} items. Review these to load more.
                    </p>
                )}
            </div>

            {loadError && (
                <div className="card" style={{ marginBottom: '16px', borderLeft: '4px solid var(--danger)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                    <span style={{ color: 'var(--danger)', fontSize: '14px' }}>Could not load the review queue: {loadError}</span>
                    <button className="btn btn-outline btn-sm" onClick={fetchReviews}>Retry</button>
                </div>
            )}

            {notice && (
                <div className="card" role="status" style={{ marginBottom: '16px', borderLeft: '4px solid var(--warning)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '14px' }}>{notice}</span>
                    <button className="btn btn-outline btn-sm" onClick={() => setNotice('')}>Dismiss</button>
                </div>
            )}

            <div className="card">
                <div className="table-container">
                    <table>
                        <thead>
                            <tr><th>Worker</th><th>Date</th><th>Site</th><th>Confidence</th><th>Flagged Reason</th><th>Actions</th></tr>
                        </thead>
                        <tbody>
                            {reviews.map(log => {
                                const key = logIdOf(log);
                                const reason = log.flagged_reason || log.review_reason;
                                return (
                                    <tr key={key}>
                                        <td>
                                            <div>
                                                <strong>{log.worker_name}</strong>
                                                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{log.worker_id}</div>
                                                {log.worker_phone && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{log.worker_phone}</div>}
                                            </div>
                                        </td>
                                        <td>{log.log_date}</td>
                                        <td>{log.site_name || '-'}</td>
                                        <td style={{ minWidth: '170px' }}>
                                            <SignalConfidence label="Face" value={log.face_confidence} />
                                            <SignalConfidence label="GPS" value={log.geo_confidence} />
                                            <SignalConfidence label="Voice" value={log.voice_confidence} />
                                        </td>
                                        <td style={{ maxWidth: '250px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                                            {reason
                                                ? reason.split(' | ').map((r, i) => <div key={i}>{r}</div>)
                                                : '-'}
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                {processingId === key ? (
                                                    <span style={{ fontSize: '13px', color: 'var(--text-muted)', padding: '4px 8px' }}>Processing...</span>
                                                ) : (
                                                    <>
                                                        <button className="btn btn-success btn-sm" disabled={!!processingId} onClick={() => handleDecision(log, 'approve')}>Approve</button>
                                                        <button className="btn btn-danger btn-sm" disabled={!!processingId} onClick={() => { setModalError(''); setSelectedLog(log); }}>Reject</button>
                                                    </>
                                                )}
                                            </div>
                                            {rowErrors[key] && (
                                                <div role="alert" style={{ fontSize: '12px', color: 'var(--danger)', marginTop: '6px', maxWidth: '220px' }}>
                                                    {rowErrors[key]}
                                                </div>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                            {reviews.length === 0 && !loadError && (
                                <tr><td colSpan="6" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No items pending review</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {selectedLog && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
                    <div className="card" style={{ width: '400px', maxWidth: 'calc(100vw - 32px)' }}>
                        <h3 style={{ marginBottom: '12px' }}>Rejection Justification</h3>
                        <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>Provide a reason for rejection (required for audit trail):</p>
                        <textarea className="search-input" style={{ width: '100%', height: '80px', resize: 'vertical' }}
                            value={justification} onChange={e => setJustification(e.target.value)}
                            placeholder="e.g., Face does not match registered photo..." />
                        {modalError && (
                            <p role="alert" style={{ fontSize: '13px', color: 'var(--danger)', marginTop: '8px' }}>Reject failed: {modalError}</p>
                        )}
                        <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
                            <button className="btn btn-outline btn-sm" disabled={!!processingId} onClick={() => { setSelectedLog(null); setJustification(''); setModalError(''); }}>Cancel</button>
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
