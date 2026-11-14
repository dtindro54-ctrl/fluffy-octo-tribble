# Xendit subscription setup (EduPlan AI)

The subscription checkout scaffold uses Xendit invoices and Supabase Auth/Postgres/Edge Functions. It supports the requested fixed prices: Rp199,000 for one month and Rp350,000 for one year. Renewals are manual: the customer pays a new invoice when the current term ends; this is not automatic recurring billing.

## Important

Do not treat the existing `localStorage` Premium toggle in `index-v2.html` as proof of payment. It is only a browser demo and can be altered by the user. This scaffold validates checkout and records payment server-side, but the existing generator still needs to be changed to require the server-side subscription status before production use. Also move Gemini requests and the Gemini secret off the browser before charging users. Do not collect a user's Gemini key as a substitute for a server-side key unless the product is explicitly BYOK.

## Setup

1. Create a Supabase project and enable Email/Password sign-in. Configure the allowed redirect URLs for your GitHub Pages site.
2. Install the Supabase CLI and link this repository/project. Apply the migration:
   ```sh
   supabase link --project-ref YOUR_PROJECT_REF
   supabase db push
   ```
3. Set function secrets (never commit these values):
   ```sh
   supabase secrets set XENDIT_SECRET_KEY=xnd_development_or_production_secret
   supabase secrets set XENDIT_CALLBACK_TOKEN=your_xendit_webhook_verification_token
   supabase secrets set APP_BASE_URL=https://YOUR_GITHUB_PAGES_HOST/YOUR_REPO
   supabase secrets set APP_ORIGIN=https://YOUR_GITHUB_PAGES_HOST
   ```
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are available in the Supabase Edge Function environment; if your deployment requires them to be configured manually, set them as secrets. Never expose the service-role key.
4. Put your Supabase project URL and public anon key into `subscription.html` where the `YOUR_SUPABASE_...` placeholders are.
5. Deploy functions:
   ```sh
   supabase functions deploy create-xendit-invoice
   supabase functions deploy xendit-webhook --no-verify-jwt
   ```
6. In Xendit Dashboard, configure the Invoice paid/expired webhook URL as `https://YOUR_PROJECT_REF.supabase.co/functions/v1/xendit-webhook`. Configure the same webhook verification token as `XENDIT_CALLBACK_TOKEN`.
7. Publish `subscription.html` on GitHub Pages. Test with Xendit test-mode credentials first; switch to live credentials only after webhook and entitlement tests pass.

## Payment flow

- A signed-in user selects monthly or yearly. `create-xendit-invoice` chooses the price on the server, creates a pending order, then requests an Xendit invoice.
- The browser is redirected to Xendit's `invoice_url`.
- Xendit calls `xendit-webhook`; the function validates `x-callback-token` and calls an idempotent database function. Only a `PAID` webhook activates/extends access. Expired invoices do not activate access.
- The subscription portal reads only the signed-in user's status using row-level security.

## Before launch

- Configure and test the Xendit webhook in test mode; validate real paid, expired, repeated, and out-of-order webhook events.
- Add privacy policy, terms, customer support/refund flow, and renewal/cancellation disclosures.
- Add server-side subscription checks to every paid action (especially AI generation and exports); never rely on a front-end badge/localStorage.
- Add rate limiting/abuse controls and monitoring for checkout and AI endpoints.
