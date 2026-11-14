import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expectedToken = Deno.env.get("XENDIT_CALLBACK_TOKEN");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!expectedToken || !supabaseUrl || !serviceRoleKey) {
    return json({ error: "Server configuration is incomplete" }, 500);
  }

  const receivedToken = request.headers.get("x-callback-token") ?? "";
  if (!receivedToken || receivedToken !== expectedToken) return json({ error: "Invalid callback token" }, 401);

  let payload: { external_id?: string; id?: string; status?: string };
  try {
    payload = await request.json();
  } catch {
    return json({ error: "Invalid webhook payload" }, 400);
  }

  if (!payload.external_id || !payload.status) return json({ error: "Missing invoice fields" }, 400);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  if (payload.status === "PAID") {
    const { error } = await admin.rpc("apply_paid_xendit_invoice", {
      p_external_id: payload.external_id,
      p_invoice_id: payload.id ?? "",
    });
    if (error) return json({ error: "Could not activate subscription" }, 500);
  } else if (payload.status === "EXPIRED") {
    await admin.from("eduplan_payment_orders")
      .update({ status: "EXPIRED" })
      .eq("external_id", payload.external_id)
      .eq("status", "PENDING");
  }

  return json({ received: true });
});
