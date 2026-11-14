CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  slug VARCHAR(120) UNIQUE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name VARCHAR(200) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_no VARCHAR(80) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'guru', 'siswa', 'bendahara')),
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'aktif', 'nonaktif', 'ditolak')),
  phone VARCHAR(40),
  guardian_phone VARCHAR(40),
  photo_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, user_id),
  UNIQUE (org_id, member_no)
);

CREATE TABLE id_credentials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  token_hash CHAR(64) UNIQUE NOT NULL,
  rfid_uid VARCHAR(120) UNIQUE,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  uploader_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  category VARCHAR(60) NOT NULL,
  storage_path TEXT NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes > 0),
  visibility VARCHAR(20) NOT NULL CHECK (visibility IN ('publik', 'guru', 'siswa', 'privat')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE attendance_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  title VARCHAR(200) NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  grace_minutes INT NOT NULL DEFAULT 10 CHECK (grace_minutes >= 0),
  is_open BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE attendances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  check_in_at TIMESTAMPTZ,
  check_out_at TIMESTAMPTZ,
  status VARCHAR(20) NOT NULL CHECK (status IN ('hadir', 'terlambat', 'izin', 'sakit', 'alpha')),
  metode_scan VARCHAR(20) NOT NULL DEFAULT 'qr_code' CHECK (metode_scan IN ('qr_code', 'rfid', 'manual')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, membership_id)
);

CREATE TABLE ai_teaching_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  guru_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  jenis_perangkat VARCHAR(40) NOT NULL CHECK (jenis_perangkat IN ('modul_ajar', 'bank_soal', 'rubrik_penilaian', 'ringkasan')),
  mata_pelajaran VARCHAR(120) NOT NULL,
  jenjang_kelas VARCHAR(80) NOT NULL,
  topik VARCHAR(200) NOT NULL,
  input_data JSONB NOT NULL,
  hasil_konten TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  membership_id UUID NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  invoice_code VARCHAR(80) NOT NULL,
  title VARCHAR(200) NOT NULL,
  amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  due_date DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'belum_lunas' CHECK (status IN ('lunas', 'belum_lunas', 'menunggu_konfirmasi', 'void')),
  provider VARCHAR(60),
  provider_reference VARCHAR(150) UNIQUE,
  paid_at TIMESTAMPTZ,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, invoice_code)
);

CREATE TABLE financial_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('pemasukan', 'pengeluaran')),
  category VARCHAR(120) NOT NULL,
  amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'lunas' CHECK (status IN ('lunas', 'belum_lunas', 'menunggu_konfirmasi', 'void')),
  description TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_memberships_org_status ON memberships(org_id, status);
CREATE INDEX idx_attendances_session ON attendances(session_id);
CREATE INDEX idx_invoices_org_status ON invoices(org_id, status);
CREATE INDEX idx_financial_org_date ON financial_transactions(org_id, occurred_at);
