const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ===== CONFIG =====
const VERIFY_TOKEN = "LSA_GLOBAL_TOKEN";
const WHATSAPP_TOKEN = "EAAYRx6VTgZCEBRJIt9VyC1ub0qkMKDzC09ED3d44RrM91cNLyUTR8ymQVRI7QqMaZATlmTL8LZB6mF5FjXn1tu7A0HRRtupfUyVnJZAVdlmYpe6IeTBNwQkx6ZBIDK9T4Eg9rOwk8CoZCEyAhJpA6WK3ZAmiORRRkE1E79qgwMZBtjEZChMjBLuJNnrBqXehZC2QZBCIcWRB5CdC7I8WxPu45t7m8O5zEksEhBTdUQteRC4";
const PHONE_NUMBER_ID = "1075889828943774";

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
    const message =
      req.body.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (message) {
      const from = message.from;
      const text = message.text?.body?.trim();

      console.log("Message received:", text);

      let replyText = "";

      // ===== MENU LOGIC =====
      if (!text || text.toLowerCase() === "hi") {
        replyText = `Hello 👋 Welcome to LSA GLOBAL.

Please choose a service:

1️⃣ Translation Services  
2️⃣ Language Courses  
3️⃣ Get a Quote  
4️⃣ Speak to Support  

Reply with 1, 2, 3 or 4.`;
      } else if (text === "1") {
        replyText = "📄 Translation Services\nSend your document or describe your needs.";
      } else if (text === "2") {
        replyText = "🎓 Language Courses\nVisit: https://lsa-global.com/register-now-2/";
      } else if (text === "3") {
        replyText = "💰 Get a Quote\nhttps://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/";
      } else if (text === "4") {
        replyText = "📞 Support\nEmail: support@lsaglobal-translate.co.uk";
      } else {
        replyText = "Please reply with 1, 2, 3 or 4.";
      }

      // ===== SEND MESSAGE =====
      await axios.post(
        `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: from,
          text: { body: replyText },
        },
        {
          headers: {
            Authorization: `Bearer ${WHATSAPP_TOKEN}`,
            "Content-Type": "application/json",
          },
        }
      );
    }

    res.sendStatus(200);
  } catch (error) {
    console.error("Error:", error.response?.data || error.message);
    res.sendStatus(500);
  }
});

// ===== START SERVER =====
app.listen(process.env.PORT || 10000, () => {
  console.log("Server running");
});
