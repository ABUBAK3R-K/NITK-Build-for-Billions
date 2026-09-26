import React from 'react';
import { Link } from 'react-router-dom';

/** Page frame for public pages (no admin sidebar): brand bar and a centred content column */
export default function PublicShell({ children }) {
    return (
        <div className="public-shell">
            <header className="public-shell-bar">
                <Link to="/home" className="public-shell-brand">
                    <img src="/navbar-logo.png" alt="" height="28" />
                    <span>Nirman Mitra</span>
                </Link>
                <span className="public-shell-tag">Welfare Board Verification</span>
            </header>
            <main className="public-shell-main">{children}</main>
        </div>
    );
}
