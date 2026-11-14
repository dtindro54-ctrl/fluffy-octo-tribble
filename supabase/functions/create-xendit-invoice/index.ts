import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const plans = {
  monthly: { amount: 199000, duration: 30 * 24 * 60 * 60 },
  yearly: { amount: 350000, duration: 365 * 24 * 60 * 60 },
} as const;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const xenditSecretKey = Deno.env.get("XENDIT_SECRET_KEY");
  const appBaseUrl = Deno.env.get("APP_BASE_URL");
  if (!supabaseUrl || !anonKey || !serviceRoleKey || !xenditSecretKey || !appBaseUrl) {
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

  let body: { plan?: string };
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const plan = body.plan as keyof typeof plans;
  if (!Object.hasOwn(plans, plan)) return json({ error: "Choose monthly or yearly plan" }, 400);
  if (!user.email) return json({ error: "Your account needs an email address" }, 400);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const externalId = `eduplan-${plan}-${crypto.randomUUID()}`;
  const { error: orderError } = await admin.from("eduplan_payment_orders").insert({
    user_id: user.id,
    external_id: externalId,
    plan,
    amount: plans[plan].amount,
    status: "PENDING",
  });
  if (orderError) return json({ error: "Could not create payment order" }, 500);

  const credentials = btoa(`${xenditSecretKey}:`);
  const invoiceResponse = await fetch("https://api.xendit.co/v2/invoices", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      external_id: externalId,
      amount: plans[plan].amount,
      description: `EduPlan AI ${plan === "monthly" ? "Bulanan" : "Tahunan"}`,
      invoice_duration: plans[plan].duration,
      currency: "IDR",
      customer: {
        given_names: user.user_metadata?.full_name ?? user.email.split("@")[0],
        email: user.email,
      },
      success_redirect_url: `${appBaseUrl}/subscription.html?payment=success`,
      failure_redirect_url: `${appBaseUrl}/subscription.html?payment=failed`,
      metadata: { user_id: user.id, plan },
    }),
  });

  const invoice = await invoiceResponse.json().catch(() => ({}));
  if (!invoiceResponse.ok || !invoice.invoice_url || !invoice.id) {
    await admin.from("eduplan_payment_orders").update({ status: "FAILED" }).eq("external_id", externalId);
    return json({ error: invoice.message ?? "Xendit could not create the invoice" }, 502);
  }

  const { error: updateError } = await admin.from("eduplan_payment_orders")
    .update({ xendit_invoice_id: invoice.id, invoice_url: invoice.invoice_url })
    .eq("external_id", externalId);
  if (updateError) return json({ error: "Invoice was created but could not be recorded" }, 500);

  return json({ invoice_url: invoice.invoice_url, external_id: externalId });
});
