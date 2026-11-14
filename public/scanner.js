(() => {
  const status = document.getElementById('scan-status');
  let busy = false;
  function message(text) { status.textContent = text; }
  async function sendScan(cardCode) {
    if (busy) return;
    busy = true;
    try {
      const response = await fetch('/api/attendance/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${document.getElementById('access-token').value.trim()}` },
        body: JSON.stringify({ card_code: cardCode, session_id: document.getElementById('session-id').value.trim(), action: document.getElementById('action').value }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || 'Scan gagal');
      message(`${result.data.name} (${result.data.member_no}) — ${result.data.action}: ${result.data.status}`);
    } catch (error) { message(error.message || 'Scan gagal'); }
    finally { setTimeout(() => { busy = false; }, 1500); }
  }
  function start() {
    if (!window.Html5Qrcode) { message('Library scanner tidak berhasil dimuat.'); return; }
    const scanner = new Html5Qrcode('reader');
    scanner.start({ facingMode: 'environment' }, { fps: 10, qrbox: { width: 240, height: 240 } }, sendScan, () => {})
      .catch(() => message('Kamera tidak dapat diakses. Pastikan memakai HTTPS atau localhost.'));
  }
  window.addEventListener('DOMContentLoaded', start);
})();
