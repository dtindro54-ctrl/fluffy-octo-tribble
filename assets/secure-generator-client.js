(function () {
  async function getSupabaseClient() {
    const url = window.__EDUPLAN_SUPABASE_URL || "YOUR_SUPABASE_PROJECT_URL";
    const anon = window.__EDUPLAN_SUPABASE_ANON_KEY || "YOUR_SUPABASE_ANON_KEY";
    if (!url.startsWith("https://") || url.includes("YOUR_") || anon.includes("YOUR_")) {
      throw new Error("Supabase URL dan anon key belum dikonfigurasi.");
    }
    return window.supabase.createClient(url, anon);
  }

  window.EduPlanSecureGenerate = {
    async generate(prompt, options = {}) {
      const { systemPrompt = "", generationConfig = {} } = options;
      const supabase = await getSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error("Silakan masuk ke akun terlebih dahulu.");
      }

      const res = await fetch(`${window.__EDUPLAN_SUPABASE_URL || "YOUR_SUPABASE_PROJECT_URL"}/functions/v1/generate-ai`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          prompt,
          systemPrompt,
          generationConfig,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || "Gagal menghasilkan AI.");
      }

      return json;
    },
  };
})();
