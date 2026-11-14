const express = require("express");

module.exports = function financeRoutes(pool, security) {
  const router = express.Router();
  const financeAccess = [security.verifyAuth, security.requireRole(["admin", "bendahara"])];

  router.get("/", ...financeAccess, async (req, res, next) => {
    try {
      const orgId = req.user.orgId;
      const summary = await pool.query(
        `SELECT
           COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'pemasukan' AND status = 'lunas'), 0) AS total_income,
           COALESCE(SUM(amount) FILTER (WHERE transaction_type = 'pengeluaran' AND status = 'lunas'), 0) AS total_expense
         FROM financial_transactions WHERE org_id = $1`, [orgId]);
      const list = await pool.query(
        `SELECT id, transaction_type AS type, category, description, amount, occurred_at AS transaction_date, status
         FROM financial_transactions WHERE org_id = $1
         ORDER BY occurred_at DESC LIMIT 50`, [orgId]);
      const income = Number(summary.rows[0].total_income);
      const expense = Number(summary.rows[0].total_expense);
      res.json({ success: true, data: { summary: { total_income: income, total_expense: expense, balance: income - expense }, transactions: list.rows } });
    } catch (error) { next(error); }
  });

  router.post("/", ...financeAccess, async (req, res, next) => {
    try {
      const { type, category, description = "", amount } = req.body;
      const numericAmount = Number(amount);
      if (!(["income", "expense"].includes(type)) || typeof category !== "string" || !category.trim() || !Number.isFinite(numericAmount) || numericAmount <= 0) {
        return res.status(400).json({ success: false, message: "Data transaksi tidak valid." });
      }
      const result = await pool.query(
        `INSERT INTO financial_transactions (org_id, user_id, transaction_type, category, description, amount, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'lunas')
         RETURNING id, transaction_type AS type, category, description, amount, occurred_at AS transaction_date, status`,
        [req.user.orgId, req.user.id, type === "income" ? "pemasukan" : "pengeluaran", category.trim().slice(0, 120), String(description).trim().slice(0, 2000), numericAmount]);
      res.status(201).json({ success: true, message: "Transaksi berhasil dicatat.", data: result.rows[0] });
    } catch (error) { next(error); }
  });
  return router;
};
