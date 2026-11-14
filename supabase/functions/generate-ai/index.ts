import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function trimGeminiText(data: any): string {
  const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
  const text = candidates
    .map((candidate: any) =>
      Array.isArray(candidate?.content?.parts)
        ? candidate.content.parts.map((part: any) => part?.text ?? "").join("")
        : ""
    )
    .join("\n\n")
    .trim();

  return text || "";
}

Deno.serve(async (request) => {
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
  if (!authorization?.startsWith("Bearer ")) {
    return json({ error: "Sign in is required" }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  });

  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) {
    return json({ error: "Invalid or expired session" }, 401);
  }

  let body: { prompt?: string; systemPrompt?: string; generationConfig?: Record<string, unknown> };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const prompt = String(body.prompt ?? "").trim();
  if (!prompt) {
    return json({ error: "Prompt is required" }, 400);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: quotaData, error: quotaError } = await admin.rpc("consume_eduplan_generation", {
    p_user_id: user.id,
  });

  if (quotaError) {
    return json({ error: "Could not check generation quota" }, 500);
  }

  const quota = quotaData as {
    allowed: boolean;
    reason?: string;
    plan?: string;
    used?: number;
    limit?: number;
    period_end?: string;
  };

  if (!quota?.allowed) {
    return json(
      {
        error: quota?.reason === "quota_exhausted" ? "Kuota generate Anda sudah habis." : quota?.reason === "trial_used" ? "Uji coba gratis Anda sudah dipakai." : "Akses generate tidak tersedia.",
        reason: quota?.reason ?? "forbidden",
        plan: quota?.plan ?? "none",
        used: quota?.used ?? 0,
        limit: quota?.limit ?? 0,
        period_end: quota?.period_end ?? null,
      },
      429,
    );
  }

  const model = "gemini-2.0-flash";
  const systemPrompt = String(body.systemPrompt ?? "").trim();

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(geminiApiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        system_instruction: systemPrompt
          ? { parts: [{ text: systemPrompt }] }
          : undefined,
        contents: [{
          role: "user",
          parts: [{ text: prompt }],
        }],
        generationConfig: body.generationConfig ?? {
          temperature: 0.4,
          topP: 0.9,
          maxOutputTokens: 4000,
        },
      }),
    },
  );

  const jsonBody = await response.json().catch(() => ({}));

  if (!response.ok) {
    return json({ error: jsonBody?.error?.message ?? "Gemini request failed" }, 502);
  }

  const text = trimGeminiText(jsonBody);
  if (!text) {
    return json({ error: "Gemini returned an empty result" }, 502);
  }

  return json({
    ok: true,
    text,
    quota,
    model,
  });
});
