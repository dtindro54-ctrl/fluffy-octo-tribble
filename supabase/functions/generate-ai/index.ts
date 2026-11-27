import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const appOrigin = Deno.env.get("APP_ORIGIN") ?? "";
const corsHeaders = {
  "Access-Control-Allow-Origin": appOrigin,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function sanitizeHtml(html: string): string {
  const allowedTags = new Set([
    "H1", "H2", "H3", "H4", "P", "DIV", "SPAN", "BR", "HR",
    "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "TH", "TD",
    "UL", "OL", "LI", "STRONG", "B", "EM", "I", "U", "BLOCKQUOTE",
  ]);
  const allowedClasses = new Set(["no-border", "page-break"]);
  const template = document.createElement("template");
  template.innerHTML = html;

  const clean = (node: Node) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as Element;
        if (!allowedTags.has(element.tagName)) {
          element.replaceWith(document.createTextNode(element.textContent ?? ""));
          continue;
        }
        for (const attribute of Array.from(element.attributes)) {
          if (attribute.name === "class") {
            const classes = attribute.value.split(/\s+/).filter((value) => allowedClasses.has(value));
            if (classes.length) element.setAttribute("class", classes.join(" "));
            else element.removeAttribute("class");
          } else if (attribute.name === "colspan" || attribute.name === "rowspan") {
            const value = Number(attribute.value);
            if (!Number.isInteger(value) || value < 1 || value > 20) element.removeAttribute(attribute.name);
          } else {
            element.removeAttribute(attribute.name);
          }
        }
        clean(element);
      } else if (child.nodeType !== Node.TEXT_NODE) {
        child.remove();
      }
    }
  };

  clean(template.content);
  return template.innerHTML;
}

const DEFAULT_DETAIL_INSTRUCTION = `
Anda adalah Pakar Kurikulum Merdeka dan Penyusun Perangkat Ajar Profesional di Indonesia.
ATURAN PENULISAN WAJIB (SANGAT PENTING):
1. Tulis seluruh perangkat ajar secara SANGAT PANJANG, MENDALAM, LENGKAP, dan SIAP CETAK. DILARANG meringkas, memotong, atau menggunakan kalimat singkatan seperti "dan seterusnya" atau "sesuaikan dengan kondisi sekolah".
2. Jabarkan setiap komponen secara utuh dan operasional:
   - Identitas Lengkap (Satuan Pendidikan, Penyusun, Tahun Ajaran, Jenjang/Fase, Kelas/Semester, Mata Pelajaran, Alokasi Waktu).
   - Capaian Pembelajaran (CP), Tujuan Pembelajaran (TP) yang terukur (ABCD/KKO Taksonomi Bloom), dan Alur Tujuan Pembelajaran (ATP) dalam bentuk tabel terstruktur.
   - Program Tahunan (PROTA) & Program Semester (PROSEM) lengkap dengan distribusi alokasi waktu/minggu efektif dalam format tabel HTML rapi.
   - Modul Ajar Lengkap: Kompetensi Awal, Profil Pelajar Pancasila (jelaskan penerapannya), Sarana & Prasarana, Target Peserta Didik, Model Pembelajaran (misal PBL/PjBL/Discovery Learning).
   - Langkah Kegiatan Pembelajaran Terperinci per Pertemuan (Pendahuluan, Kegiatan Inti berdasarkan sintaks model pembelajaran secara langkah demi langkah, dan Penutup) beserta estimasi menit di tiap tahapan.
   - Asesmen Lengkap: Asesmen Diagnostik, Formatif, dan Sumatif beserta instrumen soal (minimal 5-10 soal HOTS pilihan ganda/uraian + kunci jawaban) dan Rubrik Penilaian (tabel kriteria & skor).
   - Lembar Kerja Peserta Didik (LKPD) lengkap dengan judul, petunjuk kerja, langkah kegiatan siswa, dan tabel/pertanyaan diskusi, serta Bahan Bacaan Guru & Peserta Didik, Glosarium, dan Daftar Pustaka.
3. Gunakan format HTML murni yang rapi (tag <h1>, <h2>, <h3>, <table>, <thead>, <tbody>, <tr>, <th>, <td>, <ul>, <ol>, <li>, <p>, <strong>) tanpa pembungkus markdown \`\`\`html.
`.trim();

Deno.serve(async (request) => {
  if (!appOrigin) return json({ error: "APP_ORIGIN secret is required" }, 500);
  if (request.headers.get("origin") && request.headers.get("origin") !== appOrigin) {
    return json({ error: "Origin is not allowed" }, 403);
  }
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !geminiApiKey) {
    return json({ error: "Server configuration is incomplete" }, 500);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return json({ error: "Sign in is required" }, 401);

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: "Invalid or expired session" }, 401);

  let body: { prompt?: unknown; systemPrompt?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const clientSystemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt.trim() : "";
  if (!prompt) return json({ error: "Prompt is required" }, 400);
  if (prompt.length > 100_000 || clientSystemPrompt.length > 10_000) {
    return json({ error: "Prompt is too large" }, 413);
  }

  const combinedSystemPrompt = clientSystemPrompt
    ? `${clientSystemPrompt}\n\n${DEFAULT_DETAIL_INSTRUCTION}`
    : DEFAULT_DETAIL_INSTRUCTION;

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: quotaData, error: quotaError } = await admin.rpc("consume_eduplan_generation", {
    p_user_id: user.id,
  });
  if (quotaError) return json({ error: "Could not check generation quota" }, 500);

  const quota = quotaData as {
    allowed: boolean;
    reason?: string;
    plan?: string;
    used?: number;
    limit?: number;
    period_end?: string;
  };
  if (!quota?.allowed) {
    return json({
      error: quota?.reason === "quota_exhausted"
        ? "Kuota generate Anda sudah habis. Silakan perpanjang atau pilih paket lain."
        : quota?.reason === "trial_used"
          ? "Uji coba gratis Anda sudah digunakan. Pilih paket untuk melanjutkan."
          : "Akses generate tidak tersedia.",
      reason: quota?.reason ?? "forbidden",
      plan: quota?.plan ?? "none",
      used: quota?.used ?? 0,
      limit: quota?.limit ?? 0,
      period_end: quota?.period_end ?? null,
    }, 429);
  }

  let geminiResponse: Response;
  try {
    geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          system_instruction: { parts: [{ text: combinedSystemPrompt }] },
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.45, topP: 0.9, maxOutputTokens: 8192 },
        }),
      },
    );
  } catch {
    return json({ error: "AI service is temporarily unavailable. The generation attempt may have used one quota." }, 502);
  }

  const geminiJson = await geminiResponse.json().catch(() => ({}));
  if (!geminiResponse.ok) {
    return json({ error: geminiJson?.error?.message ?? "Gemini request failed" }, 502);
  }
  const rawText = (geminiJson?.candidates ?? [])
    .flatMap((candidate: any) => candidate?.content?.parts ?? [])
    .map((part: any) => typeof part?.text === "string" ? part.text : "")
    .join("\n")
    .trim();
  if (!rawText) return json({ error: "Gemini returned an empty result" }, 502);

  return json({
    ok: true,
    text: sanitizeHtml(rawText),
    quota,
    model: "gemini-2.0-flash",
  });
});

