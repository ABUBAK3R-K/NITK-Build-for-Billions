import React, { useEffect, useRef, useState } from 'react';
import { Html5QrcodeScanner } from 'html5-qrcode';

export default function QRScanner({ onScanSuccess, onScanError }) {
    const scannerRef = useRef(null);
    const [isScanning, setIsScanning] = useState(false);

    useEffect(() => {
        if (!isScanning) return;

        const scanner = new Html5QrcodeScanner(
            'qr-reader',
            { fps: 10, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 },
            /* verbose= */ false
        );

        scannerRef.current = scanner;

        scanner.render(
            (decodedText, decodedResult) => {
                scanner.clear();
                setIsScanning(false);
                if (onScanSuccess) onScanSuccess(decodedText, decodedResult);
            },
            (error) => {
                if (onScanError) onScanError(error);
            }
        );

        return () => {
            if (scannerRef.current) {
                scannerRef.current.clear().catch(e => console.error('Failed to clear scanner', e));
                scannerRef.current = null;
            }
        };
    }, [isScanning, onScanSuccess, onScanError]);

    if (!isScanning) {
        return (
            <div style={{ textAlign: 'center' }}>
                <button className="btn btn-primary" onClick={() => setIsScanning(true)}>
                    Start QR Scanner
                </button>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: '400px', margin: '0 auto', textAlign: 'center' }}>
            <div id="qr-reader" style={{ width: '100%' }}></div>
            <button className="btn btn-outline btn-sm" style={{ marginTop: '12px' }} onClick={() => setIsScanning(false)}>
                Cancel Scan
            </button>
        </div>
    );
}
