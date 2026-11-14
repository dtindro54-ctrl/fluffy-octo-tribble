# EduPlan AI — Xendit + Supabase setup

This repository includes a Supabase/Xendit checkout scaffold. Prices: Rp199,000 monthly and Rp350,000 yearly. Payments use Xendit Invoice/Virtual Account; renewal is manual (not automatic recurring billing). Confirm the VA banks enabled on your Xendit account before launch.

## Quotas

- Trial: 1 AI generation per Supabase account, once only.
- Monthly plan: up to 8 AI generations in the active subscription term.
- Yearly plan: up to 15 AI generations in the active subscription term.
- PostgreSQL reserves quotas atomically. The authenticated `generate-ai` function checks/consumes quota on the server before calling Gemini. Never use localStorage as proof of subscription.
- A successful paid renewal resets quota for the new term.

## Configure and deploy

1. Create a Supabase project. Enable Email/Password Auth and add the GitHub Pages site URL to Supabase Auth's allowed redirect URLs.
2. Apply migrations:
   ```sh
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```
3. Set Edge Function secrets; do not commit real credentials:
   ```sh
   supabase secrets set GEMINI_API_KEY=your_gemini_server_key
   supabase secrets set XENDIT_SECRET_KEY=xnd_test_or_live_secret
   supabase secrets set XENDIT_CALLBACK_TOKEN=your_xendit_webhook_verification_token
   supabase secrets set APP_BASE_URL=https://YOUR_GITHUB_PAGES_HOST/YOUR_REPO
   supabase secrets set APP_ORIGIN=https://YOUR_GITHUB_PAGES_HOST
   ```
   Supabase provides its project URL and keys to Edge Functions. Do not expose the service-role key. `APP_ORIGIN` must be the exact browser origin (scheme + host + optional port), not a path.
4. Configure the public frontend values in `index-v2.html` and `subscription.html`:
   - `window.__EDUPLAN_SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co"`
   - `window.__EDUPLAN_SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY"`
   - `SUPABASE_URL` and `SUPABASE_ANON_KEY` in `subscription.html`
   These are public client values only. Never put Gemini, Xendit, or service-role secrets in frontend files.
5. Deploy functions:
   ```sh
   supabase functions deploy generate-ai
   supabase functions deploy create-xendit-invoice
   supabase functions deploy xendit-webhook --no-verify-jwt
   ```
   `consume-generation` is not meant to be called directly by the browser; `generate-ai` performs the quota call as part of the server request.
6. In Xendit Dashboard, configure Invoice paid/expired webhook URL:
   `https://YOUR_PROJECT_REF.supabase.co/functions/v1/xendit-webhook`
   Set the same webhook verification token as `XENDIT_CALLBACK_TOKEN`.
7. Test with Xendit test-mode credentials first. Verify amount, invoice ID, repeated webhook, expired invoice, and payment renewal cases before switching live.

## End-user flow

1. User creates an account or signs in from `subscription.html`.
2. User selects monthly/yearly checkout. The server chooses the fixed plan price and creates a Xendit invoice.
3. Xendit sends a signed-by-token webhook; only a pending order with matching external ID, invoice ID, amount, and `PAID` status activates/extends access.
4. User returns to `index-v2.html`. The server-side generate endpoint authenticates the user, checks quota, calls Gemini using the server secret, and returns generated HTML.

## Before launch

- Apply database migrations and deploy Edge Functions; GitHub writes do not deploy Supabase automatically.
- Replace frontend placeholders with your own Supabase URL and public anon key. These have not been provided to Copilot and must not be guessed.
- Test GitHub Pages and Supabase Auth on the actual site. Free trial is one per account; email/account creation abuse may still require rate limits or email verification.
- The generate function counts a permitted attempt before contacting Gemini; a Gemini/network failure might still consume one quota. For refunds-on-failure semantics, add a reservation/refund ledger before launch.
- Use production Xendit only after checkout channels/VA bank availability are confirmed in your Xendit account.
- Publish terms, privacy policy, cancellation/renewal and refund rules, and a support contact.
