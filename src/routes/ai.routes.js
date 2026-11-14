const express = require("express");
const { GoogleGenAI } = require("@google/genai");

const ALLOWED_TOOLS = new Set([
  "modul_ajar",
  "bank_soal",
  "rubrik_penilaian",
  "ringkasan",
]);

function buildPrompt(input) {
  const map = {
    modul_ajar: "Buat modul ajar Kurikulum Merdeka lengkap: tujuan, kegiatan, asesmen, pengayaan, remedial.",
    bank_soal: "Buat bank soal pilihan ganda dan esai, lengkap dengan kunci jawaban dan pembahasan singkat.",
    rubrik_penilaian: "Buat rubrik penilaian dengan tabel kriteria, skala, dan deskripsi.",
    ringkasan: "Buat ringkasan materi singkat, padat, dan mudah dipahami.",
  };

  return `
${map[input.toolType]}

Mata Pelajaran: ${input.subject}
Kelas / Fase: ${input.gradeLevel || "Umum"}
Topik: ${input.topic}
Tujuan Pembelajaran: ${input.learningObjectives || "Ditentukan oleh guru"}
Gunakan Bahasa Indonesia. Format Markdown yang rapi dan siap diedit.
  `;
}

module.exports = function aiRoutes(pool, security) {
  const router = express.Router();

  router.post(
    "/generate",
    security.verifyAuth,
    security.requireRole(["admin", "guru"]),
    async (req, res, next) => {
      try {
        const { toolType, subject, gradeLevel, topic, learningObjectives } = req.body;
        const questionCount = Number(req.body.questionCount || 5);

        if (!ALLOWED_TOOLS.has(toolType)) {
          return res.status(400).json({
            success: false,
            message: "Jenis tool tidak valid.",
            data: null,
          });
        }

        if (!subject || !topic) {
          return res.status(400).json({
            success: false,
            message: "subject dan topic wajib diisi.",
            data: null,
          });
        }

        if (!process.env.GEMINI_API_KEY) {
          return res.status(503).json({
            success: false,
            message: "Konfigurasi Gemini belum tersedia.",
            data: null,
          });
        }

        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

        const response = await ai.models.generateContent({
          model: process.env.GEMINI_MODEL || "gemini-2.5-flash",
          contents: buildPrompt({
            toolType,
            subject,
            gradeLevel,
            topic,
            learningObjectives,
            questionCount,
          }),
          config: {
            systemInstruction: "Anda adalah asisten ahli kurikulum dan pedagogi. Buat konten yang akurat, jelas, dan siap diedit guru.",
            temperature: 0.5,
          },
        });

        const content = response.text;
        if (!content) {
          return res.status(502).json({
            success: false,
            message: "Provider AI tidak mengembalikan konten.",
            data: null,
          });
        }

        const result = await pool.query(
          `INSERT INTO ai_teaching_materials
             (org_id, guru_id, jenis_perangkat, mata_pelajaran, jenjang_kelas, topik, input_data, hasil_konten)
           VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
           RETURNING id, created_at`,
          [
            req.user.orgId,
            req.user.id,
            toolType,
            subject,
            gradeLevel || "Umum",
            topic,
            JSON.stringify({ learningObjectives, questionCount }),
            content,
          ],
        );

        return res.status(201).json({
          success: true,
          message: "Dokumen AI berhasil dibuat.",
          data: {
            id: result.rows[0].id,
            created_at: result.rows[0].created_at,
            generatedContent: content,
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
};
