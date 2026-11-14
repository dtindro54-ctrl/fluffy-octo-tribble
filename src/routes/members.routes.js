const express = require("express");
const multer = require("multer");
const bcrypt = require("bcrypt");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { detectFileTypeByMagicBytes } = require("../middlewares/security");

module.exports = function membersRoutes(pool, security) {
  const router = express.Router();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 2 } });
  const privateDir = path.resolve(process.cwd(), "storage", "private");

  router.post("/register", upload.fields([{ name: "photo", maxCount: 1 }, { name: "document", maxCount: 1 }]), async (req, res, next) => {
    const client = await pool.connect();
    const written = [];
    try {
      const fullName = String(req.body.full_name || "").trim();
      const email = String(req.body.email || "").trim().toLowerCase();
      const phone = String(req.body.phone || "").trim();
      const password = String(req.body.password || "");
      const photo = req.files?.photo?.[0];
      const document = req.files?.document?.[0];
      if (!fullName || fullName.length > 150 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || !phone || !photo || !document) {
        return res.status(400).json({ success: false, message: "Nama, email, telepon, password minimal 8 karakter, foto, dan PDF wajib diisi." });
      }
      const photoType = detectFileTypeByMagicBytes(photo.buffer);
      const docType = detectFileTypeByMagicBytes(document.buffer);
      if (!photoType || !["jpg", "png"].includes(photoType.type) || photo.size > 2 * 1024 * 1024 || !docType || docType.type !== "pdf") {
        return res.status(400).json({ success: false, message: "Foto harus JPG/PNG maksimal 2MB dan dokumen harus PDF." });
      }
      fs.mkdirSync(privateDir, { recursive: true, mode: 0o700 });
      const photoName = `${crypto.randomUUID()}${photoType.ext}`;
      const docName = `${crypto.randomUUID()}.pdf`;
      fs.writeFileSync(path.join(privateDir, photoName), photo.buffer, { flag: "wx", mode: 0o600 }); written.push(photoName);
      fs.writeFileSync(path.join(privateDir, docName), document.buffer, { flag: "wx", mode: 0o600 }); written.push(docName);

      await client.query("BEGIN");
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await client.query("INSERT INTO users (email,password_hash,full_name) VALUES ($1,$2,$3) RETURNING id", [email, passwordHash, fullName]);
      const memberNo = `MBR-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;
      const membership = await client.query(
        `INSERT INTO memberships (org_id,user_id,member_no,role,status,phone,photo_path) VALUES ($1,$2,$3,'siswa','pending',$4,$5) RETURNING id,member_no,status`,
        [process.env.DEFAULT_ORG_ID, user.rows[0].id, memberNo, phone, photoName]);
      await client.query(
        `INSERT INTO documents (org_id,uploader_id,title,category,storage_path,mime_type,size_bytes,visibility) VALUES ($1,$2,$3,'administrasi',$4,'application/pdf',$5,'privat')`,
        [process.env.DEFAULT_ORG_ID, user.rows[0].id, `Berkas pendaftaran ${fullName}`, docName, document.size]);
      await client.query("COMMIT");
      res.status(201).json({ success: true, message: "Pendaftaran menunggu persetujuan Admin.", data: { id: membership.rows[0].id, member_no: memberNo, status: membership.rows[0].status } });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      for (const name of written) { try { fs.unlinkSync(path.join(privateDir, name)); } catch {} }
      if (error.code === "23505") return res.status(409).json({ success: false, message: "Email sudah terdaftar." });
      next(error);
    } finally { client.release(); }
  });

  router.get("/pending", security.verifyAuth, security.requireRole(["admin"]), async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT m.id,m.member_no,m.role,m.created_at,u.full_name,u.email FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=$1 AND m.status='pending' ORDER BY m.created_at`, [req.user.orgId]);
      res.json({ success: true, data: result.rows });
    } catch (error) { next(error); }
  });

  router.post("/:id/approve", security.verifyAuth, security.requireRole(["admin"]), async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const member = await client.query(`UPDATE memberships SET status='aktif' WHERE id=$1 AND org_id=$2 AND status='pending' RETURNING id,member_no,role,status`, [req.params.id, req.user.orgId]);
      if (!member.rowCount) { await client.query("ROLLBACK"); return res.status(404).json({ success: false, message: "Anggota tidak ditemukan atau sudah diproses." }); }
      const token = crypto.randomBytes(32).toString("base64url");
      const hash = crypto.createHash("sha256").update(token).digest("hex");
      await client.query("INSERT INTO id_credentials (membership_id,token_hash) VALUES ($1,$2)", [member.rows[0].id, hash]);
      await client.query("COMMIT");
      res.json({ success: true, message: "Anggota disetujui. Simpan token QR sekarang.", data: { membership: member.rows[0], qr_secret_token: token } });
    } catch (error) { await client.query("ROLLBACK").catch(() => {}); next(error); }
    finally { client.release(); }
  });
  return router;
};
