document.addEventListener('DOMContentLoaded', () => {
  const loginSection = document.getElementById('login-section');
  const appSection = document.getElementById('app-section');
  const statusBanner = document.getElementById('status-banner');
  const tokenKey = 'auth_token';
  const userKey = 'auth_user';

  function showMessage(message, isError = false) {
    statusBanner.textContent = message;
    statusBanner.classList.remove('hidden');
    statusBanner.style.background = isError ? '#fee2e2' : '#dcfce7';
    statusBanner.style.color = isError ? '#991b1b' : '#166534';
    setTimeout(() => statusBanner.classList.add('hidden'), 7000);
  }
  function token() { return sessionStorage.getItem(tokenKey); }
  async function apiFetch(url, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (!(options.body instanceof FormData) && options.body) headers['Content-Type'] = 'application/json';
    if (token()) headers.Authorization = `Bearer ${token()}`;
    const response = await fetch(url, { ...options, headers });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message || 'Permintaan gagal');
    return body;
  }
  function initSession() {
    const savedToken = token();
    let user = null;
    try { user = JSON.parse(sessionStorage.getItem(userKey) || 'null'); } catch { user = null; }
    if (savedToken && user) {
      loginSection.classList.add('hidden'); appSection.classList.remove('hidden');
      document.getElementById('user-greeting').textContent = `Halo, ${user.name || user.email}`;
      document.getElementById('user-role-badge').textContent = `Peran: ${user.role}`;
      loadPendingMembers(); loadFinance();
    } else { loginSection.classList.remove('hidden'); appSection.classList.add('hidden'); }
  }

  document.getElementById('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await apiFetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: document.getElementById('login-email').value, password: document.getElementById('login-password').value }) });
      sessionStorage.setItem(tokenKey, result.data.access_token);
      sessionStorage.setItem(userKey, JSON.stringify(result.data.user));
      initSession();
    } catch (error) { showMessage(error.message, true); }
  });

  document.getElementById('logout-btn').addEventListener('click', () => { sessionStorage.removeItem(tokenKey); sessionStorage.removeItem(userKey); initSession(); });

  async function loadPendingMembers() {
    const tbody = document.getElementById('pending-tbody'); tbody.replaceChildren();
    try {
      const result = await apiFetch('/api/members/pending');
      if (!result.data.length) { const tr = document.createElement('tr'); const td = document.createElement('td'); td.colSpan = 4; td.textContent = 'Tidak ada pendaftaran menunggu persetujuan.'; tr.appendChild(td); tbody.appendChild(tr); return; }
      result.data.forEach((member) => {
        const tr = document.createElement('tr');
        for (const value of [member.full_name, member.email, member.role]) { const td = document.createElement('td'); td.textContent = value; tr.appendChild(td); }
        const action = document.createElement('td'); const button = document.createElement('button'); button.textContent = 'Setujui & Terbitkan QR'; button.className = 'btn-success'; button.addEventListener('click', () => approveMember(member.id)); action.appendChild(button); tr.appendChild(action); tbody.appendChild(tr);
      });
    } catch (error) { showMessage(error.message, true); }
  }
  async function approveMember(id) {
    try {
      const result = await apiFetch(`/api/members/${encodeURIComponent(id)}/approve`, { method: 'POST' });
      showMessage(`${result.message} QR token (simpan sekarang): ${result.data.qr_secret_token}`);
      loadPendingMembers();
    } catch (error) { showMessage(error.message, true); }
  }
  document.getElementById('refresh-pending-btn').addEventListener('click', loadPendingMembers);

  async function loadFinance() {
    const tbody = document.getElementById('finance-tbody'); tbody.replaceChildren();
    try {
      const result = await apiFetch('/api/finance/');
      const { summary, transactions } = result.data;
      document.getElementById('finance-summary-text').textContent = `Pemasukan: Rp ${summary.total_income.toLocaleString('id-ID')} | Pengeluaran: Rp ${summary.total_expense.toLocaleString('id-ID')} | Saldo: Rp ${summary.balance.toLocaleString('id-ID')}`;
      transactions.forEach((tx) => {
        const tr = document.createElement('tr');
        const values = [tx.type === 'income' ? 'Pemasukan' : 'Pengeluaran', tx.category, tx.description || '-', `Rp ${Number(tx.amount).toLocaleString('id-ID')}`];
        values.forEach((value) => { const td = document.createElement('td'); td.textContent = value; tr.appendChild(td); }); tbody.appendChild(tr);
      });
    } catch (error) { showMessage(error.message, true); }
  }
  document.getElementById('finance-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await apiFetch('/api/finance/', { method: 'POST', body: JSON.stringify({ type: document.getElementById('fin-type').value, category: document.getElementById('fin-category').value, amount: document.getElementById('fin-amount').value, description: document.getElementById('fin-desc').value }) });
      event.target.reset(); showMessage('Transaksi berhasil dicatat.'); await loadFinance();
    } catch (error) { showMessage(error.message, true); }
  });
  initSession();
});
