import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

/** "1234" -> "XXXX XXXX 1234" */
function formatAadhaarLast4(last4) {
    const digits = String(last4 || '').replace(/\D/g, '').slice(-4);
    return digits.length === 4 ? `XXXX XXXX ${digits}` : null;
}

export default function CertificateVerify() {
    const { hash } = useParams();
    const navigate = useNavigate();
    // status: idle | loading | verified | notfound | error
    const [status, setStatus] = useState(hash ? 'loading' : 'idle');
    const [cert, setCert] = useState(null);
    const [errorMessage, setErrorMessage] = useState('');
    const [checkedHash, setCheckedHash] = useState('');
    const [manualHash, setManualHash] = useState(hash || '');
    const requestSeq = useRef(0);

    async function fetchCertificate(h) {
        const seq = ++requestSeq.current;
        setStatus('loading');
        setCert(null);
        setErrorMessage('');
        setCheckedHash(h);
        let res;
        try {
            res = await fetch(`${API_BASE_URL}/api/certificate/${encodeURIComponent(h)}/verify`);
        } catch {
            if (seq !== requestSeq.current) return;
            setErrorMessage('Could not reach the verification service. Check your connection and try again.');
            setStatus('error');
            return;
        }
        if (seq !== requestSeq.current) return;

        if (res.status === 404) {
            setStatus('notfound');
            return;
        }
        if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            if (seq !== requestSeq.current) return;
            setErrorMessage(`Could not reach the verification service (${body.error || `HTTP ${res.status}`}). Please try again.`);
            setStatus('error');
            return;
        }

        try {
            const data = await res.json();
            if (seq !== requestSeq.current) return;
            if (!data.verified || !data.certificate) {
                setStatus('notfound');
                return;
            }
            const c = data.certificate;
            const issued = c.issued_at ? new Date(c.issued_at) : null;
            setCert({
                workerName: c.worker_name,
                aadhaar: formatAadhaarLast4(c.aadhaar_last4),
                totalDays: c.total_verified_days,
                dateRange: c.date_range ? `${c.date_range.from} to ${c.date_range.to}` : '-',
                sites: (c.sites_worked || []).map(s => (typeof s === 'string' ? s : s.name || s.site_id)).filter(Boolean),
                bocwRef: c.bocw_reference || '-',
                issueDate: issued && !Number.isNaN(issued.getTime())
                    ? issued.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
                    : '-',
                hash: h,
            });
            setStatus('verified');
        } catch {
            if (seq !== requestSeq.current) return;
            setErrorMessage('The verification service returned an unexpected response. Please try again.');
            setStatus('error');
        }
    }

    useEffect(() => {
        if (hash) {
            setManualHash(hash);
            fetchCertificate(hash);
        } else {
            requestSeq.current++;
            setStatus('idle');
            setCert(null);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hash]);

    function handleManualVerify(e) {
        e.preventDefault();
        const h = manualHash.trim();
        if (!h) return;
        if (h === hash) fetchCertificate(h); // same URL: re-check without a route change
        else navigate(`/verify/${encodeURIComponent(h)}`);
    }

    const loading = status === 'loading';
    const verified = status === 'verified';

    return (
        <div>
            <div className="page-header">
                <h2>Verify Certificate</h2>
                <p>Validate a worker's Smart Certificate using the SHA-256 hash from the QR code</p>
            </div>

            {/* Manual Search: always available so another hash can be checked */}
            <div className="card" style={{ maxWidth: '640px', marginBottom: '20px' }}>
                <h3 style={{ marginBottom: '12px' }}>{status === 'idle' ? 'Enter Verification Hash' : 'Check Another Certificate'}</h3>
                <p style={{ fontSize: '13px', color: 'var(--text-secondary)', marginBottom: '16px' }}>
                    Paste the certificate hash from the QR code or certificate PDF:
                </p>
                <form onSubmit={handleManualVerify} style={{ display: 'flex', gap: '8px' }}>
                    <input
                        className="search-input"
                        type="text"
                        placeholder="Paste verification hash..."
                        aria-label="Verification hash"
                        value={manualHash}
                        onChange={e => setManualHash(e.target.value)}
                        style={{ flex: 1, minWidth: 0 }}
                    />
                    <button className="btn btn-primary btn-sm" type="submit" disabled={!manualHash.trim() || loading}>
                        Verify
                    </button>
                </form>
            </div>

            {/* Loading */}
            {loading && (
                <div className="card" style={{ maxWidth: '640px', textAlign: 'center', padding: '40px' }}>
                    <p style={{ color: 'var(--text-muted)' }}>Verifying certificate...</p>
                </div>
            )}

            {/* Network / API error: distinct from "not found" */}
            {status === 'error' && (
                <div className="card" role="alert" style={{ maxWidth: '640px', textAlign: 'center', padding: '32px 24px' }}>
                    <span className="badge pending" style={{ fontSize: '15px', padding: '8px 24px', borderRadius: '24px' }}>
                        Verification Unavailable
                    </span>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6, marginTop: '16px' }}>
                        {errorMessage}
                    </p>
                    <button className="btn btn-outline btn-sm" style={{ marginTop: '16px' }} onClick={() => fetchCertificate(checkedHash)}>
                        Retry
                    </button>
                </div>
            )}

            {/* Result Card */}
            {(status === 'verified' || status === 'notfound') && (
                <div className="card" style={{ maxWidth: '640px' }}>
                    {/* Status Badge */}
                    <div style={{ textAlign: 'center', marginBottom: '24px' }}>
                        {verified ? (
                            <span className="badge approved" style={{
                                fontSize: '15px',
                                padding: '8px 24px',
                                borderRadius: '24px',
                            }}>
                                Verified Certificate
                            </span>
                        ) : (
                            <span className="badge rejected" style={{
                                fontSize: '15px',
                                padding: '8px 24px',
                                borderRadius: '24px',
                            }}>
                                Certificate Not Found
                            </span>
                        )}
                    </div>

                    {verified && cert ? (
                        <>
                            <h2 style={{
                                textAlign: 'center',
                                fontSize: '20px',
                                fontWeight: 700,
                                marginBottom: '24px',
                            }}>
                                Work Attendance Certificate
                            </h2>

                            {/* Details Grid */}
                            <div style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr',
                                gap: '20px',
                                marginBottom: '24px',
                            }}>
                                <DetailItem label="Worker Name" value={cert.workerName} fullWidth={!cert.aadhaar} />
                                {cert.aadhaar && <DetailItem label="Aadhaar" value={cert.aadhaar} />}
                                <DetailItem label="Total Verified Days" value={`${cert.totalDays} days`} />
                                <DetailItem label="Date Range" value={cert.dateRange} />
                                <DetailItem label="BOCW Reference" value={cert.bocwRef} fullWidth />
                                <DetailItem label="Issue Date" value={cert.issueDate} />
                                <DetailItem label="Sites Worked" value={cert.sites.join('; ') || '-'} fullWidth />
                            </div>

                            {/* SHA-256 Hash */}
                            <div style={{
                                background: 'var(--bg-input)',
                                border: '1px solid var(--border-color)',
                                borderRadius: 'var(--border-radius-sm)',
                                padding: '12px 16px',
                                marginBottom: '24px',
                            }}>
                                <p style={{
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.5px',
                                    color: 'var(--text-muted)',
                                    marginBottom: '6px',
                                }}>
                                    SHA-256 Certificate Hash
                                </p>
                                <p style={{
                                    fontSize: '12px',
                                    fontFamily: 'monospace',
                                    color: 'var(--text-secondary)',
                                    wordBreak: 'break-all',
                                    lineHeight: 1.5,
                                }}>
                                    {cert.hash}
                                </p>
                            </div>

                            {/* Triple Verification Badge */}
                            <div style={{
                                background: 'rgba(19, 136, 8, 0.06)',
                                border: '1px solid rgba(19, 136, 8, 0.2)',
                                borderRadius: 'var(--border-radius-sm)',
                                padding: '16px',
                                textAlign: 'center',
                            }}>
                                <div style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    marginBottom: '6px',
                                }}>
                                    <span style={{ fontSize: '18px' }}>&#x1F6E1;</span>
                                    <span style={{
                                        fontSize: '14px',
                                        fontWeight: 700,
                                        color: '#138808',
                                    }}>
                                        Triple Verification&trade;
                                    </span>
                                </div>
                                <p style={{
                                    fontSize: '12px',
                                    color: 'var(--text-secondary)',
                                    lineHeight: 1.5,
                                }}>
                                    This certificate was verified through AI-powered facial recognition,
                                    GPS geofencing, and voice attestation via the Nirman Mitra platform.
                                </p>
                            </div>
                        </>
                    ) : (
                        <div style={{ textAlign: 'center', padding: '24px 0' }}>
                            <p style={{ fontSize: '48px', marginBottom: '16px' }}>&#x26A0;&#xFE0F;</p>
                            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', lineHeight: 1.6 }}>
                                Certificate not found. No certificate matches this hash.
                                <br />
                                Please check the QR code or hash and try again.
                            </p>
                            <p style={{ fontSize: '12px', fontFamily: 'monospace', color: 'var(--text-muted)', wordBreak: 'break-all', marginTop: '12px' }}>
                                {checkedHash}
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function DetailItem({ label, value, fullWidth }) {
    return (
        <div style={fullWidth ? { gridColumn: '1 / -1' } : {}}>
            <p style={{
                fontSize: '11px',
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                color: 'var(--text-muted)',
                marginBottom: '4px',
            }}>
                {label}
            </p>
            <p style={{ fontSize: '14px', color: 'var(--text-primary)' }}>
                {value}
            </p>
        </div>
    );
}
