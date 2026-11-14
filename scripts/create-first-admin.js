#!/usr/bin/env node
require("dotenv").config();

const bcrypt = require("bcrypt");
const crypto = require("node:crypto");
const readline = require("node:readline");
const { Pool } = require("pg");

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function askHidden(question) {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      reject(new Error("Terminal interaktif diperlukan agar password tidak terlihat."));
      return;
    }

    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = "";

    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    function cleanup() {
      stdin.removeListener("data", onData);
      stdin.setRawMode(false);
      stdin.pause();
    }

    function onData(char) {
      if (char === "\u0003") {
        cleanup();
        stdout.write("\nDibatalkan.\n");
        reject(new Error("Dibatalkan."));
        return;
      }

      if (char === "\r" || char === "\n") {
        cleanup();
        stdout.write("\n");
        resolve(value);
        return;
      }

      if (char === "\u007f" || char === "\b") {
        if (value.length > 0) {
          value = value.slice(0, -1);
          stdout.write("\b \b");
        }
        return;
      }

      if (char >= " ") {
        value += char;
        stdout.write("*");
      }
    }

    stdin.on("data", onData);
  });
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL belum diatur.");
  }
  if (!process.env.DEFAULT_ORG_ID) {
    throw new Error("DEFAULT_ORG_ID belum diatur.");
  }

  const email = (await ask("Email admin: ")).trim().toLowerCase();
  const fullName = (await ask("Nama lengkap admin: ")).trim();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !fullName) {
    throw new Error("Email atau nama tidak valid.");
  }

  const password = await askHidden("Password (minimal 12 karakter): ");
  const confirm = await askHidden("Ulangi password: ");

  if (password.length < 12) {
    throw new Error("Password minimal 12 karakter.");
  }
  if (password !== confirm) {
    throw new Error("Konfirmasi password tidak cocok.");
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id
       FROM memberships
       WHERE org_id = $1 AND role = 'admin'
       LIMIT 1`,
      [process.env.DEFAULT_ORG_ID],
    );

    if (existing.rowCount) {
      throw new Error("Admin untuk organisasi ini sudah ada.");
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const user = await client.query(
      `INSERT INTO users (email, password_hash, full_name, is_active)
       VALUES ($1, $2, $3, true)
       RETURNING id`,
      [email, passwordHash, fullName],
    );

    const memberNo = `ADM-${crypto.randomBytes(5).toString("hex").toUpperCase()}`;

    await client.query(
      `INSERT INTO memberships (org_id, user_id, member_no, role, status)
       VALUES ($1, $2, $3, 'admin', 'aktif')`,
      [process.env.DEFAULT_ORG_ID, user.rows[0].id, memberNo],
    );

    await client.query("COMMIT");
    console.log(`Admin berhasil dibuat: ${email}`);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(`Gagal membuat admin: ${error.message}`);
  process.exitCode = 1;
});
