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
const attendanceRoutes = require("./src/routes/attendance.routes");
const aiRoutes = require("./src/routes/ai.routes");

const requiredEnv = ["DATABASE_URL", "JWT_SECRET", "DEFAULT_ORG_ID"];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    throw new Error(`Environment variable ${key} wajib diisi`);
  }
}
if (String(process.env.JWT_SECRET).length < 32) {
  throw new Error("JWT_SECRET harus minimal 32 karakter");
}

const app = express();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const uploadDir = path.resolve(process.env.UPLOAD_DIR || "uploads");
fs.mkdirSync(uploadDir, { recursive: true });

app.disable("x-powered-by");

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "https://cdn.tailwindcss.com", "https://unpkg.com"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
  }),
);

app.use(
  cors({
    origin: process.env.WEB_ORIGIN || "http://localhost:3000",
    credentials: true,
  }),
);

app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: false, limit: "100kb" }));

app.use(express.static(path.join(__dirname, "public")));

const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: "draft-7",
  legacyHeaders: false,
});
app.use("/api", apiLimiter);

const security = createSecurity(pool);
app.use("/api/auth", authRoutes(pool, security));
app.use("/api/attendance", attendanceRoutes(pool, security));
app.use("/api/ai-tools", aiRoutes(pool, security));

app.get("/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      success: true,
      message: "API berjalan normal",
      data: { status: "healthy" },
    });
  } catch {
    res.status(503).json({
      success: false,
      message: "Database tidak tersedia",
      data: null,
    });
  }
});

app.use((err, _req, res, _next) => {
  console.error("[SERVER ERROR]", err.message);
  const status = err.status || 500;
  res.status(status).json({
    success: false,
    message: err.message || "Terjadi kesalahan internal pada server",
    data: null,
  });
});

async function start() {
  await pool.query("SELECT 1");
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => {
    console.log(`Server berjalan di http://localhost:${port}`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Server gagal dimulai:", error.message);
    process.exit(1);
  });
}

module.exports = { app, pool };
