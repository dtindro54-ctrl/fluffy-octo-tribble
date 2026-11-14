require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("node:path");
const fs = require("node:fs");
const rateLimit = require("express-rate-limit");
const { Pool } = require("pg");

const { createSecurity } = require("./src/middlewares/security");
const authRoutes = require("./src/routes/auth.routes");
const membersRoutes = require("./src/routes/members.routes");
const attendanceRoutes = require("./src/routes/attendance.routes");
const financeRoutes = require("./src/routes/finance.routes");
const aiRoutes = require("./src/routes/ai.routes");

const requiredEnv = ["DATABASE_URL", "JWT_SECRET", "DEFAULT_ORG_ID"];
for (const key of requiredEnv) {
  if (!process.env[key]) throw new Error(`Environment variable ${key} wajib diisi`);
}
if (process.env.JWT_SECRET.length < 32) throw new Error("JWT_SECRET harus minimal 32 karakter");

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uploadDir = path.resolve(process.env.UPLOAD_DIR || "storage/private");
fs.mkdirSync(uploadDir, { recursive: true, mode: 0o700 });

app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: { directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "https://cdn.tailwindcss.com", "https://unpkg.com"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
    imgSrc: ["'self'", "data:", "blob:"],
    connectSrc: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"],
  } },
}));
app.use(cors({ origin: process.env.WEB_ORIGIN || "http://localhost:3000" }));
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/api", rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-7", legacyHeaders: false }));

const security = createSecurity(pool);
app.use("/api/auth", authRoutes(pool, security));
app.use("/api/members", membersRoutes(pool, security, uploadDir));
app.use("/api/attendance", attendanceRoutes(pool, security));
app.use("/api/finance", financeRoutes(pool, security));
app.use("/api/ai-tools", aiRoutes(pool, security));

app.get("/", (_req, res) => res.sendFile(path.join(__dirname, "public", "dashboard.html")));
app.get("/health", async (_req, res) => {
  try { await pool.query("SELECT 1"); res.json({ success: true, data: { status: "healthy" } }); }
  catch { res.status(503).json({ success: false, message: "Database tidak tersedia" }); }
});
app.use("/api", (_req, res) => res.status(404).json({ success: false, message: "Endpoint API tidak ditemukan" }));
app.use((err, _req, res, _next) => {
  console.error("[SERVER ERROR]", err.message);
  const status = err.status || 500;
  res.status(status).json({ success: false, message: status < 500 ? err.message : "Terjadi kesalahan internal" });
});

async function start() {
  await pool.query("SELECT 1");
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`Server berjalan di port ${port}`));
}
if (require.main === module) start().catch((err) => { console.error(err.message); process.exit(1); });
module.exports = { app, pool };
