"use strict";

const state = {
  accessToken: null,
};

const $ = (selector) => document.querySelector(selector);

function setStatus(message, isError = false) {
  const el = $("#dashboard-status");
  if (!el) return;
  el.textContent = message;
  el.className = isError ? "mb-4 text-sm text-red-700" : "mb-4 text-sm text-emerald-700";
}

function formatRupiah(value) {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (state.accessToken) {
    headers.set("Authorization", `Bearer ${state.accessToken}`);
  }
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    ...options,
    headers,
    credentials: "same-origin",
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.message || "Permintaan gagal");
  }
  return result;
}

function switchTab(tab) {
  ["ai", "keuangan", "sosmed"].forEach((name) => {
    document.getElementById(`section-${name}`).classList.toggle("hidden", name !== tab);
  });

  document.querySelectorAll("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === tab;
    button.classList.toggle("bg-blue-600", active);
    button.classList.toggle("text-white", active);
    button.classList.toggle("text-slate-300", !active);
  });
}

async function loadFinance() {
  try {
    const summary = await api("/api/finance/summary");
    const transactions = await api("/api/finance/transactions");

    $("#stat-masuk").textContent = formatRupiah(summary.total_pemasukan);
    $("#stat-keluar").textContent = formatRupiah(summary.total_pengeluaran);
    $("#stat-saldo").textContent = formatRupiah(summary.saldo_akhir);

    const tbody = document.getElementById("tabel-keuangan");
    tbody.innerHTML = "";

    for (const item of transactions) {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td class="p-4">${new Date(item.occurred_at).toLocaleDateString("id-ID")}</td>
        <td class="p-4">${String(item.transaction_type).toUpperCase()}</td>
        <td class="p-4">${item.description || item.category}</td>
        <td class="p-4 font-semibold">${formatRupiah(item.amount)}</td>
        <td class="p-4">${item.status}</td>
      `;
      tbody.appendChild(row);
    }
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function generateAi() {
  const payload = {
    toolType: $("#ai-jenis").value,
    subject: $("#ai-mapel").value.trim(),
    gradeLevel: $("#ai-kelas").value.trim(),
    topic: $("#ai-topik").value.trim(),
    learningObjectives: $("#ai-catatan").value.trim(),
  };

  if (!payload.subject || !payload.topic) {
    setStatus("Mata pelajaran dan topik harus diisi.", true);
    return;
  }

  const button = $("#btn-generate-ai");
  const output = $("#ai-output");
  button.disabled = true;
  output.value = "Sedang membuat draf...";

  try {
    const result = await api("/api/ai-tools/generate", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    output.value = result.generatedContent || "";
    setStatus("Dokumen AI berhasil dibuat.");
  } catch (error) {
    output.value = "";
    setStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function addTransaction() {
  const type = $("#keu-tipe").value === "PEMASUKAN" ? "pemasukan" : "pengeluaran";
  const description = $("#keu-keterangan").value.trim();
  const amount = Number($("#keu-nominal").value);

  if (!description || !Number.isFinite(amount) || amount <= 0) {
    setStatus("Isi keterangan dan nominal dengan benar.", true);
    return;
  }

  try {
    await api("/api/finance/transactions", {
      method: "POST",
      body: JSON.stringify({
        transaction_type: type,
        category: description,
        description,
        amount,
      }),
    });

    $("#keu-keterangan").value = "";
    $("#keu-nominal").value = "";
    await loadFinance();
    setStatus("Transaksi berhasil disimpan.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function broadcast() {
  const title = $("#sos-judul").value.trim();
  const content = $("#sos-pesan").value.trim();
  const platforms = Array.from(document.querySelectorAll(".sos-target:checked"), (input) => input.value);

  if (!title || !content || platforms.length === 0) {
    setStatus("Judul, isi pengumuman, dan target wajib diisi.", true);
    return;
  }

  try {
    await api("/api/social/broadcast", {
      method: "POST",
      body: JSON.stringify({ title, content, platforms }),
    });
    setStatus("Pengumuman berhasil dikirim ke webhook.");
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function login() {
  const email = prompt("Masukkan email admin:");
  const password = prompt("Masukkan password admin:");
  if (!email || !password) return;

  try {
    const result = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    state.accessToken = result.data.access_token;
    setStatus(`Login berhasil sebagai ${result.data.user.name} (${result.data.user.role}).`);
    await loadFinance();
  } catch (error) {
    setStatus(error.message, true);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => switchTab(button.dataset.tab));
  });

  document.getElementById("btn-generate-ai")?.addEventListener("click", generateAi);
  document.querySelector('[data-action="copy-ai"]')?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(document.getElementById("ai-output").value);
      setStatus("Hasil berhasil disalin.");
    } catch {
      setStatus("Tidak dapat menyalin hasil.", true);
    }
  });
  document.querySelector('[data-action="add-transaction"]')?.addEventListener("click", addTransaction);
  document.querySelector('[data-action="broadcast"]')?.addEventListener("click", broadcast);

  switchTab("ai");
  login();
});
