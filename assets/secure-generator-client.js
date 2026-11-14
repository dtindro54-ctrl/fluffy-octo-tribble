(function () {
  const CONFIG_URL = () => window.__EDUPLAN_SUPABASE_URL || "";
  const CONFIG_ANON = () => window.__EDUPLAN_SUPABASE_ANON_KEY || "";
  let clientPromise;

  async function getSupabaseClient() {
    const url = CONFIG_URL();
    const anon = CONFIG_ANON();
    if (!url.startsWith("https://") || !anon || url.includes("YOUR_") || anon.includes("YOUR_")) {
      throw new Error("Konfigurasi Supabase belum diisi. Lengkapi URL project dan anon key publik.");
    }
    if (!window.supabase?.createClient) throw new Error("Library Supabase belum termuat.");
    if (!clientPromise) clientPromise = Promise.resolve(window.supabase.createClient(url, anon));
    return clientPromise;
  }

  function setBadge(text, premium) {
    const badge = document.getElementById("subscription-status-badge");
    if (!badge) return;
    badge.textContent = text;
    badge.className = premium
      ? "bg-emerald-500/20 border border-emerald-300 text-xs px-3 py-2 rounded font-semibold text-emerald-100"
      : "bg-white/10 border border-white/20 text-xs px-3 py-2 rounded font-semibold text-indigo-100";
  }

  async function refreshSubscriptionBadge() {
    try {
      const client = await getSupabaseClient();
      const { data: { session } } = await client.auth.getSession();
      if (!session) {
        setBadge("Status: Belum masuk", false);
        return;
      }

      const { data: subscription, error } = await client
        .from("eduplan_subscriptions")
        .select("plan,status,current_period_end,generations_used")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (error) throw error;

      const active = subscription?.status === "active" && new Date(subscription.current_period_end) > new Date();
      if (active) {
        const limit = subscription.plan === "yearly" ? 15 : 8;
        const used = Number(subscription.generations_used || 0);
        const planLabel = subscription.plan === "yearly" ? "Tahunan" : "Bulanan";
        setBadge(`Premium ${planLabel}: ${Math.max(0, limit - used)}/${limit} generate`, true);
        return;
      }

      const { data: trialClaim, error: trialError } = await client
        .from("eduplan_trial_claims")
        .select("used_at")
        .eq("user_id", session.user.id)
        .maybeSingle();
      if (trialError) throw trialError;
      setBadge(trialClaim ? "Status: Uji coba sudah digunakan" : "Status: Uji coba tersedia 1x", false);
    } catch (error) {
      setBadge("Status: Periksa konfigurasi/login", false);
      console.error("EduPlan subscription status:", error);
    }
  }

  window.EduPlanSecureGenerate = {
    async generate(prompt, options = {}) {
      const { systemPrompt = "" } = options;
      const client = await getSupabaseClient();
      const { data: { session } } = await client.auth.getSession();
      if (!session?.access_token) throw new Error("Silakan masuk ke akun terlebih dahulu.");

      const response = await fetch(`${CONFIG_URL()}/functions/v1/generate-ai`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: CONFIG_ANON(),
        },
        body: JSON.stringify({ prompt, systemPrompt }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 429) refreshSubscriptionBadge();
        throw new Error(result?.error || "Gagal menghasilkan dokumen.");
      }
      refreshSubscriptionBadge();
      return result;
    },
  };

  document.addEventListener("DOMContentLoaded", () => {
    const printableArea = document.getElementById("printable-area");
    // The paper itself must remain visible for print/export; only its controls should be hidden.
    printableArea?.classList.remove("no-print");
    refreshSubscriptionBadge();
    getSupabaseClient().then((client) => {
      client.auth.onAuthStateChange(() => refreshSubscriptionBadge());
    }).catch(() => {});

    const subscriptionButton = document.querySelector("[onclick='toggleSubscriptionModal()']");
    if (subscriptionButton) {
      subscriptionButton.addEventListener("click", () => {
        window.location.href = "./subscription.html";
      });
    }
  });
})();
