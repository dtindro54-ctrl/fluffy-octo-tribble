# School & Community Platform MVP

Platform web untuk manajemen sekolah dan komunitas terpadu dengan fitur:

- autentikasi dan RBAC
- pendaftaran anggota
- absensi QR ID Card
- AI guru untuk modul ajar, soal, dan rubrik
- dashboard dasar

## Quick start

1. Copy env example:

```bash
cp .env.example .env
```

2. Start PostgreSQL:

```bash
docker compose up -d
```

3. Add organization data:

```sql
INSERT INTO organizations (name, slug)
VALUES ('Sekolah Demo', 'sekolah-demo');
```

4. Set DEFAULT_ORG_ID in `.env` to the UUID generated in the insert result.

5. Apply schema:

```bash
psql "postgresql://school:school_local_password@localhost:5432/school_platform" -f database-schema.sql
```

6. Create first admin:

```bash
node scripts/create-first-admin.js
```

7. Start server:

```bash
npm install
npm run dev
```

Open:
- `http://localhost:3000/`
- `http://localhost:3000/pendaftaran-member-upload.html`
- `http://localhost:3000/scanner-absensi.html`

## Notes

- This is a foundation MVP, not a full production-ready system.
- Payment integration, social login, export PDF/DOCX, and file storage integration must be implemented as a next phase.
