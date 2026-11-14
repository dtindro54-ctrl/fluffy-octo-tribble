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
  const systemPrompt = typeof body.systemPrompt === "string" ? body.systemPrompt.trim() : "";
  if (!prompt) return json({ error: "Prompt is required" }, 400);
  if (prompt.length > 100_000 || systemPrompt.length > 10_000) {
    return json({ error: "Prompt is too large" }, 413);
  }

  // Model and resource limits are fixed on the server so clients cannot choose a costlier model/config.
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
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({
          ...(systemPrompt ? { system_instruction: { parts: [{ text: systemPrompt }] } } : {}),
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, topP: 0.9, maxOutputTokens: 4000 },
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
