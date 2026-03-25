const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ===== CONFIG (FROM RENDER ENV) =====
const VERIFY_TOKEN = "LSA_GLOBAL_TOKEN";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;


// ===== VERIFY (GET) =====
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// ===== RECEIVE MESSAGE (POST) =====
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (body.object) {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messages = value?.messages;

      if (messages && messages[0]) {
        const message = messages[0];
        const from = message.from;
        const text = message.text?.body?.toLowerCase() || "";

        console.log("Message received:", text);

        let reply = "";

        // ===== MENU =====
        if (text.includes("hello") || text.includes("hi")) {
          reply =
            "👋 Welcome to LSA GLOBAL\n\n" +
            "We offer:\n\n" +
            "1️⃣ Translation services\n" +
            "2️⃣ Language courses\n" +
            "3️⃣ Interpreting services\n" +
            "4️⃣ Speak to an advisor\n\n" +
            "Please reply with 1, 2, 3 or 4.";
        }

        // ===== TRANSLATION =====
        else if (text === "1" || text.includes("translation")) {
          reply =
            "🌍 Translation Services\n\n" +
            "We provide certified translations in:\n" +
            "EN, FR, ES, DE, IT, AR, ZH + more.\n\n" +
            "✔ Legal documents\n" +
            "✔ Academic transcripts\n" +
            "✔ Business & websites\n\n" +
            "👉 Get a free quote:\n" +
            "https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/\n\n" +
            "Or type:\nName + Language + Deadline";
        }

        // ===== COURSES =====
        else if (
          text === "2" ||
          text.includes("course") ||
          text.includes("learn")
        ) {
          reply =
            "📚 Language Courses (A1–C2)\n\n" +
            "✔ English, French, Spanish, German, Chinese\n" +
            "✔ Exam prep: IELTS, TOEFL, TCF, TEF, DELE\n\n" +
            "👉 Register here:\n" +
            "https://lsa-global.com/register-now-2/\n\n" +
            "Or tell us:\nYour level + target exam";
        }

        // ===== INTERPRETING =====
        else if (text === "3" || text.includes("interpreting")) {
          reply =
            "🎤 Interpreting Services\n\n" +
            "✔ Online & onsite\n" +
            "✔ Conferences, meetings, interviews\n\n" +
            "Tell us:\n" +
            "- Language pair\n" +
            "- Date\n" +
            "- Duration";
        }

        // ===== ADVISOR =====
        else if (text === "4" || text.includes("advisor")) {
          reply =
            "👨‍💼 Speak to an advisor\n\n" +
            "Our team will contact you shortly.\n\n" +
            "👉 Contact us:\n" +
            "https://lsa-global.com/contact-us-lsa-global/";
        }

        // ===== LEAD CAPTURE =====
        else if (
          text.includes("deadline") ||
          text.includes("translate") ||
          text.split(" ").length > 4
        ) {
          reply =
            "✅ Thank you. Your request has been received.\n\n" +
            "Our team will review and get back to you shortly.\n\n" +
            "👉 Faster processing:\n" +
            "https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/";
        }

        // ===== DEFAULT =====
        else {
          reply =
            "👋 Welcome to LSA GLOBAL\n\n" +
            "Please choose:\n\n" +
            "1️⃣ Translation\n" +
            "2️⃣ Courses\n" +
            "3️⃣ Interpreting\n" +
            "4️⃣ Advisor";
        }

        // ===== SEND MESSAGE =====
        await axios.post(
          `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: "whatsapp",
            to: from,
            text: { body: reply },
          },
          {
            headers: {
              Authorization: `Bearer ${WHATSAPP_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
      }

      return res.sendStatus(200);
    } else {
      return res.sendStatus(404);
    }
  } catch (error) {
    console.error("Error:", error.response?.data || error.message);
    return res.sendStatus(500);
  }
});

// ===== START SERVER =====
app.listen(process.env.PORT || 10000, () => {
  console.log("🚀 Server running...");
});
