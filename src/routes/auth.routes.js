const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

module.exports = function authRoutes(pool, security) {
  const router = express.Router();

  router.post("/login", async (req, res, next) => {
    try {
      const email = String(req.body.email || "").trim().toLowerCase();
      const password = String(req.body.password || "");
      const orgId = String(req.body.org_id || process.env.DEFAULT_ORG_ID);

      if (!email || !password) {
        return res.status(400).json({
          success: false,
          message: "Email dan password wajib diisi.",
          data: null,
        });
      }

      const result = await pool.query(
        `SELECT
           u.id,
           u.email,
           u.full_name,
           u.password_hash,
           m.role,
           m.status,
           m.org_id
         FROM users u
         JOIN memberships m ON m.user_id = u.id
         WHERE u.email = $1
           AND m.org_id = $2
           AND u.is_active = true`,
        [email, orgId],
      );

      const account = result.rows[0];
      if (!account || account.status !== "aktif") {
        return res.status(401).json({
          success: false,
          message: "Akun belum aktif atau tidak ditemukan.",
          data: null,
        });
      }

      const valid = await bcrypt.compare(password, account.password_hash);
      if (!valid) {
        return res.status(401).json({
          success: false,
          message: "Email atau password salah.",
          data: null,
        });
      }

      const accessToken = jwt.sign(
        { sub: account.id, org_id: account.org_id },
        process.env.JWT_SECRET,
        { expiresIn: "15m", issuer: "school-community-api" },
      );

      return res.json({
        success: true,
        message: "Login berhasil",
        data: {
          access_token: accessToken,
          expires_in: 900,
          user: {
            id: account.id,
            email: account.email,
            name: account.full_name,
            role: account.role,
            org_id: account.org_id,
          },
        },
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/me", security.verifyAuth, (req, res) => {
    res.json({
      success: true,
      message: "Profil berhasil diambil",
      data: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name,
        role: req.user.role,
        org_id: req.user.orgId,
      },
    });
  });

  return router;
};
