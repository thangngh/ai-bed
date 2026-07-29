import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", service: "Bedtime Story Companion API" });
  });

  // Story Generation Endpoint
  app.post("/api/generate-story", async (req, res) => {
    try {
      const { childName, childAge, favoriteTopic, gender, lesson, mood, favoriteCharacter } = req.body || {};

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(503).json({ error: "Gemini API Key not available" });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: {
            "User-Agent": "aistudio-build",
          },
        },
      });

      const prompt = `Viết một câu chuyện cổ tích trước giờ ngủ ngắn, ấm áp, dịu dàng dành cho trẻ ${childAge || 4} tuổi.
Thông tin cá nhân hóa:
- Tên bé: ${childName || 'Bé'}
- Tuổi: ${childAge || 4} tuổi
- Chủ đề bé thích: ${favoriteTopic || 'Động vật'}
- Giới tính: ${gender || 'Chưa chọn'}
- Điều cha mẹ muốn dạy hôm nay: ${lesson || 'Chia sẻ và giúp đỡ bạn bè'}
- Tâm trạng bé hôm nay: ${mood || 'Vui vẻ'}
- Nhân vật bé thích: ${favoriteCharacter || 'Bạn gấu nhỏ'}

Yêu cầu nội dung:
- Ngôn ngữ: Tiếng Việt trong sáng, êm ái, phù hợp đọc trước khi ngủ cho trẻ 3-6 tuổi.
- Độ dài vừa phải, khoảng 250-350 từ.
- Bắt buộc chèn 3 điểm tương tác rõ ràng dành cho phụ huynh dừng lại hỏi bé (format câu hỏi bắt đầu bằng "Hãy hỏi bé: ...").
- Kết thúc bằng một bài học nhẹ nhàng và câu ru ấm áp.`;

      const response = await ai.models.generateContent({
        model: "gemini-3.6-flash",
        contents: prompt,
        config: {
          systemInstruction:
            "Bạn là một tác giả chuyên sáng tác truyện cổ tích trước giờ ngủ dành cho trẻ em 3-6 tuổi. Bạn viết bằng tiếng Việt dịu dàng, giàu hình ảnh, nhẹ nhàng giúp bé thư giãn và dễ đi vào giấc ngủ ngon.",
          temperature: 0.7,
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: "Tiêu đề câu chuyện thu hút bé" },
              segments: {
                type: Type.OBJECT,
                properties: {
                  opening: { type: Type.STRING, description: "Đoạn mở đầu giới thiệu bé và bối cảnh" },
                  situation: { type: Type.STRING, description: "Tình huống nhẹ nhàng tạo không khí" },
                  interaction1: { type: Type.STRING, description: "Gợi ý câu hỏi thứ nhất cho phụ huynh hỏi bé (bắt đầu bằng 'Hãy hỏi bé:')" },
                  challenge: { type: Type.STRING, description: "Thử thách nhỏ dịu dàng" },
                  interaction2: { type: Type.STRING, description: "Gợi ý câu hỏi thứ hai cho phụ huynh (bắt đầu bằng 'Hãy hỏi bé:')" },
                  ending: { type: Type.STRING, description: "Kết thúc ấm áp, vỗ về bé ngủ" },
                  interaction3: { type: Type.STRING, description: "Gợi ý câu hỏi thứ ba hoặc câu thì thầm trước khi nhắm mắt" },
                  moralSummary: { type: Type.STRING, description: "Tóm tắt bài học nhân văn ngắn gọn" },
                },
                required: ["opening", "situation", "interaction1", "challenge", "interaction2", "ending", "interaction3", "moralSummary"],
              },
            },
            required: ["title", "segments"],
          },
        },
      });

      if (response.text) {
        const parsedData = JSON.parse(response.text);
        return res.json(parsedData);
      } else {
        return res.status(500).json({ error: "Empty response from Gemini API" });
      }
    } catch (error) {
      console.error("Error generating story via Gemini:", error);
      return res.status(500).json({ error: "Failed to generate story" });
    }
  });

  // Vite middleware for development vs static build in production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
