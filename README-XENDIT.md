# Xendit subscription setup (EduPlan AI)

Checkout scaffold uses Xendit invoices and Supabase Auth/Postgres/Edge Functions. Prices are Rp199,000 for one month and Rp350,000 for one year. Renewals are manual; this does not create automatic recurring charges.

## Generation quotas

- Free trial: 1 AI generation per account, one time.
- Monthly subscription: up to 8 AI generations during the active subscription term.
- Yearly subscription: up to 15 AI generations during the active subscription term.
- The quota is stored and atomically enforced by Postgres. `consume-generation` authenticates the Supabase user and calls the quota function; the client cannot choose a user ID.
- Paid Xendit webhooks activate or extend the subscription and reset `generations_used` for the newly granted term.

**Important:** The current static `index-v2.html` generator still calls Gemini directly and its localStorage plan toggle is only a demo. It does not yet call `consume-generation`, so it is not protected by these server-side quotas. Do not launch paid access until the AI generation path is moved behind an authenticated server endpoint that consumes quota before calling Gemini. Never rely on front-end localStorage for subscription/quota validation, and do not expose Gemini or Xendit secret keys in the browser.

## Setup

1. Create a Supabase project and enable Email/Password sign-in. Configure allowed redirect URLs for your GitHub Pages site.
2. Link this repository with Supabase CLI and apply the migrations:
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
   Supabase supplies its URL and keys in Edge Function environments; configure them manually as secrets only if your deployment requires it. Never expose the service-role key.
4. Put your Supabase project URL and public anon key into `subscription.html` where the `YOUR_SUPABASE_...` placeholders are.
5. Deploy functions:
   ```sh
   supabase functions deploy create-xendit-invoice
   supabase functions deploy consume-generation
   supabase functions deploy xendit-webhook --no-verify-jwt
   ```
6. In Xendit Dashboard, configure Invoice paid/expired webhook URL as `https://YOUR_PROJECT_REF.supabase.co/functions/v1/xendit-webhook` and set the matching verification token as `XENDIT_CALLBACK_TOKEN`.
7. Publish `subscription.html` on GitHub Pages. Test with Xendit test-mode credentials first; switch to live credentials only after paid, expired, repeated, and out-of-order webhook tests pass.

## Payment and quota flow

- Signed-in user chooses a plan; `create-xendit-invoice` selects the price server-side, saves a pending order, then requests an invoice.
- User pays through the Xendit invoice URL.
- Xendit calls `xendit-webhook`; the callback token is checked. Only `PAID` activates/extends access. Repeated paid notifications are idempotent.
- To reserve one generation, the authenticated client calls `consume-generation` before generation. A production `generate-ai` endpoint should perform this quota call and the Gemini request in the same server-side flow so users cannot skip the quota endpoint.

## Before launch

- Move Gemini calls behind an authenticated server endpoint, consume quota there, and keep Gemini API key only in server secrets.
- Add rate limiting/abuse controls and monitoring.
- Add privacy policy, terms, support/refund flow, and renewal/cancellation disclosures.
