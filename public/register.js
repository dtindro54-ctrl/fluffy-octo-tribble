document.getElementById('register-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.getElementById('status');
  status.textContent = 'Mengirim pendaftaran...';
  try {
    const response = await fetch('/api/members/register', { method: 'POST', body: new FormData(form) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Pendaftaran gagal');
    status.textContent = `${result.message} Nomor anggota: ${result.data.member_no}`;
    form.reset();
  } catch (error) { status.textContent = error.message || 'Server tidak dapat dihubungi'; }
});
