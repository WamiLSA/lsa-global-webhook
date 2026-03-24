const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// 🔐 YOUR REAL VALUES (REPLACE THESE)
const VERIFY_TOKEN = "LSA_GLOBAL_TOKEN";
const ACCESS_TOKEN = "EAAYRx6VTgZCEBRAZCZC9DeBNlziO7EUwhIKfQeohNlyZBts7ZC6B6bEdAvxzreX95Cv1foZBMmZBf7CAMzgujvDPZCtdM4dBfGejbZAwjMg4jMCXw3QOFkbZBkIZAjcdtr1nxRBocMsanqd0GaZA3sx3qr2ku3Hoy0YoLZBvZBxRWQ8z2VhWBpZBXZC41z3Xq82Out0ZBoulTEbevK0MShGBrZAchR6cc02hZCTju2werjJMxD2ucfdciUCtF6vzS15cZAYqYE9lTJqTjtDqqgVd0iSZBZBdw0CEZAlZCOcSB6I1T1a6ZCV0A2gZDZD";
const PHONE_NUMBER_ID = "1075889828943774";

// =======================
// ✅ WEBHOOK VERIFICATION
// =======================
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verified!");
    return res.status(200).send(challenge);
  } else {
    return res.sendStatus(403);
  }
});

// =======================
// ✅ RECEIVE + AUTO REPLY
// =======================
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (body.object) {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const message = changes?.value?.messages?.[0];

      if (message) {
        const from = message.from;
        const text = message.text?.body;
let replyText = "";

if (text === "1") {
  replyText = "📄 Translation Services\nSend your document or describe your needs.";
} else if (text === "2") {
  replyText = "🎓 Language Courses\nWhich language would you like to learn?";
} else if (text === "3") {
  replyText = "💰 Get a Quote\nVisit: https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/";
} else if (text === "4") {
  replyText = "📞 Support\nContact us here: https://lsa-global.com/contact-us-lsa-global/";
} else {
 replyText = `Hello 👋 Welcome to LSA GLOBAL.

Please choose a service:

1️⃣ Translation Services  
2️⃣ Language Courses  
3️⃣ Get a Quote  
4️⃣ Speak to Support

Reply with 1, 2, 3 or 4.`;
}
        console.log("Message received:", text);

        // ✅ AUTO REPLY
        await axios.post(
          `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: "whatsapp",
            to: from,
            text: {
  body: replyText
}

Please choose a service:

1️⃣ Translation Services  
2️⃣ Language Courses  
3️⃣ Get a Quote  
4️⃣ Speak to Support

Reply with 1, 2, 3 or 4.`,
            },
          },
          {
            headers: {
              Authorization: `Bearer ${ACCESS_TOKEN}`,
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
    console.error("ERROR:", error.response?.data || error.message);
    return res.sendStatus(500);
  }
});

// =======================
app.listen(process.env.PORT || 10000, () => {
  console.log("Server running");
});
