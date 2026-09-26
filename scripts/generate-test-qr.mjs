import fs from 'fs';
import QRCode from 'qrcode';

// Simulated JWT for a credential
const demoJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ3LWRlbW8iLCJuYW1lIjoiRGVtbyBXb3JrZXIiLCJhYWRoYWFyX2xhc3Q0IjoiMTIzNCIsImRheXMiOjMwLCJpc3MiOiJOaXJtYW4gTWl0cmEifQ.demo_signature_12345';
const portalUrl = 'http://192.168.1.100:3000'; // Replace with local IP for mobile testing
const verificationUrl = `${portalUrl}/verify?token=${demoJwt}`;

async function main() {
  console.log(`Generating QR code pointing to: ${verificationUrl}`);
  
  // Create QR code as PNG buffer
  const qrPng = await QRCode.toBuffer(verificationUrl, { type: 'png', margin: 2, width: 600, errorCorrectionLevel: 'L' });
  
  // Save to file
  const outPath = 'test-credential-qr.png';
  fs.writeFileSync(outPath, qrPng);
  
  console.log(`Saved QR code to ${outPath}.`);
  console.log('You can now open this image on your laptop and scan it with your physical phone.');
}

main().catch(console.error);
