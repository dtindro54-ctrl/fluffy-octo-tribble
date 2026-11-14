const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const jwt = require("jsonwebtoken");

function sendError(res, status, message) {
  return res.status(status).json({
    success: false,
    message,
    data: null,
  });
}

function createSecurity(pool) {
  async function verifyAuth(req, res, next) {
    try {
      const header = req.get("authorization") || "";
      const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";

      if (!token) {
        return sendError(res, 401, "Token autentikasi diperlukan.");
      }

      if (!process.env.JWT_SECRET || String(process.env.JWT_SECRET).length < 32) {
        return sendError(res, 500, "JWT_SECRET tidak valid.");
      }

      const claims = jwt.verify(token, process.env.JWT_SECRET, {
        issuer: "school-community-api",
      });

      const orgId = req.get("x-organization-id") || process.env.DEFAULT_ORG_ID;
      if (!orgId) {
        return sendError(res, 400, "Organisasi belum dipilih.");
      }

      const result = await pool.query(
        `SELECT
           u.id AS user_id,
           u.email,
           u.full_name,
           m.id AS membership_id,
           m.org_id,
           m.role,
           m.status
         FROM users u
         JOIN memberships m ON m.user_id = u.id
         WHERE u.id = $1
           AND m.org_id = $2
           AND u.is_active = true
           AND m.status = 'aktif'`,
        [claims.sub, orgId],
      );

      if (!result.rowCount) {
        return sendError(res, 403, "Akun atau keanggotaan tidak aktif.");
      }

      const row = result.rows[0];
      req.user = {
        id: row.user_id,
        email: row.email,
        name: row.full_name,
        membershipId: row.membership_id,
        orgId: row.org_id,
        role: row.role,
        status: row.status,
      };

      return next();
    } catch (error) {
      if (error.name === "TokenExpiredError" || error.name === "JsonWebTokenError") {
        return sendError(res, 401, "Token tidak valid atau kedaluwarsa.");
      }
      return next(error);
    }
  }

  function requireRole(allowedRoles = []) {
    return (req, res, next) => {
      if (!req.user) {
        return sendError(res, 401, "Autentikasi diperlukan.");
      }
      if (!allowedRoles.includes(req.user.role)) {
        return sendError(res, 403, "Akses ditolak untuk role ini.");
      }
      return next();
    };
  }

  return { verifyAuth, requireRole };
}

const SIGNATURES = {
  pdf: { bytes: [0x25, 0x50, 0x44, 0x46, 0x2d], ext: ".pdf", mime: "application/pdf" },
  jpg: { bytes: [0xff, 0xd8, 0xff], ext: ".jpg", mime: "image/jpeg" },
  png: { bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], ext: ".png", mime: "image/png" },
};

function detectFileTypeByMagicBytes(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;

  for (const [type, signature] of Object.entries(SIGNATURES)) {
    if (buffer.length < signature.bytes.length) continue;

    const matches = signature.bytes.every((byte, index) => buffer[index] === byte);
    if (matches) {
      return { type, ext: signature.ext, mime: signature.mime };
    }
  }

  return null;
}

function savePrivateFile(buffer, allowedTypes = ["pdf", "jpg", "png"]) {
  const detected = detectFileTypeByMagicBytes(buffer);

  if (!detected || !allowedTypes.includes(detected.type)) {
    const error = new Error("Format file tidak valid atau isi biner tidak cocok.");
    error.status = 400;
    throw error;
  }

  const privateDir = path.resolve(process.cwd(), "storage", "private");
  fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });

  const fileName = `${crypto.randomUUID()}${detected.ext}`;
  const fullPath = path.join(privateDir, fileName);
  fs.writeFileSync(fullPath, buffer, { flag: "wx", mode: 0o600 });

  return {
    storedFilename: fileName,
    detectedMime: detected.mime,
    sizeBytes: buffer.length,
  };
}

function createQrCredential() {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}

async function findActiveQrMembership(pool, token, orgId) {
  if (typeof token !== "string" || !token || !orgId) return null;

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const result = await pool.query(
    `SELECT
       m.id AS membership_id,
       m.org_id,
       m.member_no,
       m.role,
       u.full_name
     FROM id_credentials c
     JOIN memberships m ON m.id = c.membership_id
     JOIN users u ON u.id = m.user_id
     WHERE c.token_hash = $1
       AND c.revoked_at IS NULL
       AND m.org_id = $2
       AND m.status = 'aktif'
       AND u.is_active = true`,
    [tokenHash, orgId],
  );

  return result.rows[0] || null;
}

module.exports = {
  createSecurity,
  detectFileTypeByMagicBytes,
  savePrivateFile,
  createQrCredential,
  findActiveQrMembership,
};
