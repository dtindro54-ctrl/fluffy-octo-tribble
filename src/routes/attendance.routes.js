const express = require("express");
const crypto = require("node:crypto");

module.exports = function attendanceRoutes(pool, security) {
  const router = express.Router();

  router.post(
    "/sessions",
    security.verifyAuth,
    security.requireRole(["admin", "guru"]),
    async (req, res, next) => {
      try {
        const { title, starts_at, ends_at, grace_minutes = 10 } = req.body;

        if (!title || !starts_at || !ends_at) {
          return res.status(400).json({
            success: false,
            message: "title, starts_at, dan ends_at wajib diisi.",
            data: null,
          });
        }

        const startAt = new Date(starts_at);
        const endAt = new Date(ends_at);

        if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime()) || endAt <= startAt) {
          return res.status(400).json({
            success: false,
            message: "Waktu sesi tidak valid.",
            data: null,
          });
        }

        const result = await pool.query(
          `INSERT INTO attendance_sessions
             (org_id, title, starts_at, ends_at, grace_minutes, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           RETURNING *`,
          [req.user.orgId, title, starts_at, ends_at, Number(grace_minutes), req.user.id],
        );

        return res.status(201).json({
          success: true,
          message: "Sesi absensi dibuat.",
          data: result.rows[0],
        });
      } catch (error) {
        next(error);
      }
    },
  );

  router.post("/scan", security.verifyAuth, async (req, res, next) => {
    const client = await pool.connect();

    try {
      const { card_code, session_id, action = "IN", method = "qr_code" } = req.body;

      if (!card_code || !session_id || !["IN", "OUT"].includes(action)) {
        return res.status(400).json({
          success: false,
          message: "card_code, session_id, dan action wajib valid.",
          data: null,
        });
      }

      const tokenHash = crypto.createHash("sha256").update(String(card_code)).digest("hex");

      await client.query("BEGIN");

      const matched = await client.query(
        `SELECT
           m.id AS membership_id,
           m.org_id,
           m.member_no,
           u.full_name
         FROM id_credentials c
         JOIN memberships m ON m.id = c.membership_id
         JOIN users u ON u.id = m.user_id
         WHERE c.token_hash = $1
           AND c.revoked_at IS NULL
           AND m.status = 'aktif'
           AND m.org_id = $2`,
        [tokenHash, req.user.orgId],
      );

      if (!matched.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          success: false,
          message: "ID Card tidak valid atau tidak aktif.",
          data: null,
        });
      }

      const person = matched.rows[0];

      const session = await client.query(
        `SELECT *
         FROM attendance_sessions
         WHERE id = $1 AND org_id = $2 AND is_open = true
         FOR UPDATE`,
        [session_id, req.user.orgId],
      );

      if (!session.rowCount) {
        await client.query("ROLLBACK");
        return res.status(404).json({
          success: false,
          message: "Sesi absensi tidak ditemukan atau sudah ditutup.",
          data: null,
        });
      }

      const sessionRow = session.rows[0];
      const now = new Date();

      const existing = await client.query(
        `SELECT *
         FROM attendances
         WHERE session_id = $1 AND membership_id = $2
         FOR UPDATE`,
        [session_id, person.membership_id],
      );

      let record = existing.rows[0];

      if (!record) {
        const inserted = await client.query(
          `INSERT INTO attendances (session_id, membership_id, status, metode_scan)
           VALUES ($1, $2, 'hadir', $3)
           RETURNING *`,
          [session_id, person.membership_id, method === "rfid" ? "rfid" : "qr_code"],
        );
        record = inserted.rows[0];
      }

      if (action === "IN") {
        if (record.check_in_at) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            success: false,
            message: "Absen masuk sudah tercatat.",
            data: null,
          });
        }

        const lateAt = new Date(sessionRow.starts_at);
        lateAt.setMinutes(lateAt.getMinutes() + Number(sessionRow.grace_minutes || 0));
        const statusValue = now > lateAt ? "terlambat" : "hadir";

        const updated = await client.query(
          `UPDATE attendances
           SET check_in_at = NOW(), status = $1
           WHERE id = $2
           RETURNING *`,
          [statusValue, record.id],
        );

        await client.query("COMMIT");

        return res.json({
          success: true,
          message: "Absen masuk berhasil dicatat.",
          data: {
            name: person.full_name,
            member_no: person.member_no,
            action: "IN",
            status: updated.rows[0].status,
            recorded_at: updated.rows[0].check_in_at,
          },
        });
      }

      if (!record.check_in_at) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          message: "Belum ada absen masuk.",
          data: null,
        });
      }

      if (record.check_out_at) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          success: false,
          message: "Absen pulang sudah tercatat.",
          data: null,
        });
      }

      const updated = await client.query(
        `UPDATE attendances
         SET check_out_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [record.id],
      );

      await client.query("COMMIT");

      return res.json({
        success: true,
        message: "Absen pulang berhasil dicatat.",
        data: {
          name: person.full_name,
          member_no: person.member_no,
          action: "OUT",
          status: updated.rows[0].status,
          recorded_at: updated.rows[0].check_out_at,
        },
      });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      next(error);
    } finally {
      client.release();
    }
  });

  router.get("/summary", security.verifyAuth, security.requireRole(["admin", "guru"]), async (req, res, next) => {
    try {
      const result = await pool.query(
        `SELECT status, COUNT(*)::int AS total
         FROM attendances a
         JOIN attendance_sessions s ON s.id = a.session_id
         WHERE s.org_id = $1
         GROUP BY status`,
        [req.user.orgId],
      );

      return res.json({
        success: true,
        message: "Ringkasan absensi diambil.",
        data: result.rows,
      });
    } catch (error) {
      next(error);
    }
  });

  return router;
};
