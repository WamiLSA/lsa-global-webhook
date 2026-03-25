const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ===== CONFIG =====
const VERIFY_TOKEN = "LSA_GLOBAL_TOKEN";
const WHATSAPP_TOKEN = "EAAYRx6VTgZCEBRM3wVaZC2p8OCD1tmaZCe7lxPvBofsFoogBVaGGdsOP4EBN3haBSX9mHMNM7ZA6SRzx98mLnWqvLYTCOxRMyTHcRA6xZCBi05ZCFLZBgGZCvRSmusM2l3ZC8Ai0dZAsAcVmqhbyewxQZBc2iMavuLuHTa0YIzZBZAqPJ3dnVrrh77DKKdywwooeDTpSwAAZDZD";
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
