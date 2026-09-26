import React, { useState, useEffect, useCallback } from 'react';
import api from '../utils/api';
import { networkErrorMessage } from '../utils/events';

const EMPTY_FORM = { name: '', latitude: '', longitude: '', radius_meters: '200', is_active: true };

function pick(site, ...keys) {
    for (const k of keys) {
        const v = k.split('.').reduce((o, part) => (o == null ? undefined : o[part]), site);
        if (v !== undefined && v !== null && v !== '') return v;
    }
    return undefined;
}

function fmtCoord(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n.toFixed(5) : '-';
}

/** Client-side checks mirroring the backend's validation; the server remains authoritative. */
function validate(form) {
    const errors = {};
    if (!form.name.trim()) errors.name = 'Name is required';
    const lat = Number(form.latitude);
    if (form.latitude === '' || !Number.isFinite(lat) || lat < -90 || lat > 90) errors.latitude = 'Latitude must be between -90 and 90';
    const lng = Number(form.longitude);
    if (form.longitude === '' || !Number.isFinite(lng) || lng < -180 || lng > 180) errors.longitude = 'Longitude must be between -180 and 180';
    const r = Number(form.radius_meters);
    if (form.radius_meters === '' || !Number.isFinite(r) || r <= 0) errors.radius_meters = 'Radius must be a positive number of metres';
    return errors;
}

const labelStyle = { display: 'block', fontSize: '12px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' };
const fieldErrorStyle = { fontSize: '12px', color: 'var(--danger)', marginTop: '4px' };

export default function Sites() {
    const [sites, setSites] = useState([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState('');
    const [form, setForm] = useState(EMPTY_FORM);
    const [fieldErrors, setFieldErrors] = useState({});
    const [submitError, setSubmitError] = useState('');
    const [success, setSuccess] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const fetchSites = useCallback(async () => {
        setLoading(true);
        setLoadError('');
        try {
            const res = await api.get('/api/admin/sites');
            if (res.status === 404) throw new Error('The sites API is not available on this backend yet.');
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${res.status}`);
            }
            const data = await res.json();
            setSites(Array.isArray(data) ? data : (data.sites || data.items || []));
        } catch (err) {
            setLoadError(networkErrorMessage(err));
        }
        setLoading(false);
    }, []);

    useEffect(() => { fetchSites(); }, [fetchSites]);

    function update(field, value) {
        setForm(prev => ({ ...prev, [field]: value }));
        setFieldErrors(prev => ({ ...prev, [field]: undefined }));
        setSuccess('');
    }

    async function handleSubmit(e) {
        e.preventDefault();
        setSubmitError('');
        setSuccess('');
        const errors = validate(form);
        setFieldErrors(errors);
        if (Object.keys(errors).length) return;

        setSubmitting(true);
        try {
            const res = await api.post('/api/admin/sites', {
                name: form.name.trim(),
                latitude: Number(form.latitude),
                longitude: Number(form.longitude),
                radius_meters: Number(form.radius_meters),
                is_active: !!form.is_active,
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error || (res.status === 404
                    ? 'The sites API is not available on this backend yet.'
                    : `HTTP ${res.status}`));
            }
            setSuccess(`Site "${form.name.trim()}" saved.`);
            setForm(EMPTY_FORM);
            fetchSites();
        } catch (err) {
            setSubmitError(networkErrorMessage(err));
        }
        setSubmitting(false);
    }

    return (
        <div>
            <div className="page-header">
                <h2>Sites</h2>
                <p>Construction sites and their geofences used for GPS attendance verification</p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '20px', alignItems: 'start' }}>
                <div className="card">
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                        <h3>All Sites ({sites.length})</h3>
                        <button className="btn btn-outline btn-sm" onClick={fetchSites} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button>
                    </div>
                    {loadError && (
                        <p role="alert" style={{ fontSize: '13px', color: 'var(--danger)', marginBottom: '12px' }}>
                            Could not load sites: {loadError}
                        </p>
                    )}
                    <div className="table-container">
                        <table>
                            <thead><tr><th>Name</th><th>Latitude</th><th>Longitude</th><th>Radius</th><th>Status</th></tr></thead>
                            <tbody>
                                {sites.map((s, i) => {
                                    const active = pick(s, 'is_active', 'active');
                                    return (
                                        <tr key={s.site_id || i}>
                                            <td>
                                                <strong>{pick(s, 'name', 'site_name') || '-'}</strong>
                                                {s.site_id && <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>{s.site_id}</div>}
                                            </td>
                                            <td>{fmtCoord(pick(s, 'latitude', 'lat', 'location.latitude', 'location.lat'))}</td>
                                            <td>{fmtCoord(pick(s, 'longitude', 'lng', 'lon', 'location.longitude', 'location.lng'))}</td>
                                            <td>{pick(s, 'radius_meters', 'radius') ?? '-'} m</td>
                                            <td>
                                                <span className={`badge ${active === false ? 'rejected' : 'active'}`}>
                                                    {active === false ? 'inactive' : 'active'}
                                                </span>
                                            </td>
                                        </tr>
                                    );
                                })}
                                {!loading && sites.length === 0 && !loadError && (
                                    <tr><td colSpan="5" style={{ textAlign: 'center', padding: '40px', color: 'var(--text-muted)' }}>No sites yet. Add one using the form.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="card">
                    <h3 style={{ marginBottom: '16px' }}>Add Site</h3>
                    <form onSubmit={handleSubmit} noValidate>
                        <div style={{ marginBottom: '12px' }}>
                            <label style={labelStyle} htmlFor="site-name">Name</label>
                            <input id="site-name" className="search-input" style={{ width: '100%' }} value={form.name}
                                onChange={e => update('name', e.target.value)} placeholder="e.g. Greenfield Metro Station" />
                            {fieldErrors.name && <div style={fieldErrorStyle}>{fieldErrors.name}</div>}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }}>
                            <div>
                                <label style={labelStyle} htmlFor="site-lat">Latitude</label>
                                <input id="site-lat" className="search-input" style={{ width: '100%' }} inputMode="decimal" value={form.latitude}
                                    onChange={e => update('latitude', e.target.value)} placeholder="12.9716" />
                                {fieldErrors.latitude && <div style={fieldErrorStyle}>{fieldErrors.latitude}</div>}
                            </div>
                            <div>
                                <label style={labelStyle} htmlFor="site-lng">Longitude</label>
                                <input id="site-lng" className="search-input" style={{ width: '100%' }} inputMode="decimal" value={form.longitude}
                                    onChange={e => update('longitude', e.target.value)} placeholder="77.5946" />
                                {fieldErrors.longitude && <div style={fieldErrorStyle}>{fieldErrors.longitude}</div>}
                            </div>
                        </div>
                        <div style={{ marginBottom: '12px' }}>
                            <label style={labelStyle} htmlFor="site-radius">Radius (m)</label>
                            <input id="site-radius" className="search-input" style={{ width: '100%' }} inputMode="numeric" value={form.radius_meters}
                                onChange={e => update('radius_meters', e.target.value)} />
                            {fieldErrors.radius_meters && <div style={fieldErrorStyle}>{fieldErrors.radius_meters}</div>}
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', marginBottom: '16px' }}>
                            <input type="checkbox" checked={form.is_active} onChange={e => update('is_active', e.target.checked)} />
                            Active
                        </label>
                        {submitError && <p role="alert" style={{ fontSize: '13px', color: 'var(--danger)', marginBottom: '12px' }}>{submitError}</p>}
                        {success && <p role="status" style={{ fontSize: '13px', color: 'var(--success)', marginBottom: '12px' }}>{success}</p>}
                        <button className="btn btn-primary btn-sm" type="submit" disabled={submitting}>
                            {submitting ? 'Saving...' : 'Add Site'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
