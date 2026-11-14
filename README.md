# School & Community Platform MVP

Express and PostgreSQL foundation for member onboarding/approval, role-based login, QR attendance, teacher AI drafts, and finance transactions.

## Local setup

1. Copy `.env.example` to `.env`. Set a random `JWT_SECRET` of at least 32 characters and leave `DEFAULT_ORG_ID` empty until you create the organization.
2. Start PostgreSQL: `docker compose up -d`.
3. Apply schema: `psql "$DATABASE_URL" -f database-schema.sql`.
4. Create an organization in the database, then put its UUID into `DEFAULT_ORG_ID` in `.env`.
5. Install dependencies: `npm install`.
6. Create the first admin: `node scripts/create-first-admin.js`.
7. Start the server: `npm run dev`.

Open dashboard at `/`, member registration at `/pendaftaran-member-upload.html`, and scanner at `/scanner-absensi.html`.

API routes include `/api/auth/login`, `/api/auth/me`, `/api/members/register`, `/api/members/pending`, `/api/members/:id/approve`, `/api/attendance/sessions`, `/api/attendance/scan`, `/api/ai-tools/generate`, and `/api/finance/`.

## Tests

Run `npm test` for unit tests. These do not replace integration tests against PostgreSQL or provider credentials.

## Scope and production caveats

This is an MVP. Social login, payment-provider verification, private document download authorization, notifications, and PDF/DOCX export are not implemented. Do not deploy with real student/financial data until integration/security tests, HTTPS, backups, secrets, and operational monitoring are configured.
