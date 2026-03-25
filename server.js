const express = require("express");
const axios = require("axios");

const app = express();
app.use(express.json());

// ===== CONFIG =====
const VERIFY_TOKEN = "LSA_GLOBAL_TOKEN";
const WHATSAPP_TOKEN = "EAAYRx6VTgZCEBRIQ76p1eCtgTb9ibIQykmQSreki9abcbMIgwCpiHO3ZAA2fp7VouFC1N7R1OF9N07bg2ABEZAwhpW45tZA43oDTqnx0LQcU4YHHGDchVhTP0ZACcZB3ZCxZB6VL0cx2zzcNQUZCicMkyZA4pjyTsRSi0ZAPPxSjoMiAQTvr1q6iU0MZAGZA3T5LoUp2v4wZDZD";
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

        // 🧠 INTENT DETECTION
        if (text.includes("hello") || text.includes("hi")) {
          reply = `Hello 👋 Welcome to LSA GLOBAL.

We offer:

1️⃣ Translation services  
2️⃣ Language courses  
3️⃣ Interpreting services  
4️⃣ Speak to an advisor  

Please reply with 1, 2, 3 or 4.`;
        }

        else if (text === "1" || text.includes("translation")) {
          reply = `🌍 Translation Services

We provide certified translations in:
EN, FR, ES, DE, IT, AR, ZH + more.

✔ Legal documents  
✔ Academic transcripts  
✔ Business & websites  

👉 Get a free quote:
https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/

Or type:
NAME + LANGUAGE + DEADLINE`;
        }

        else if (text === "2" || text.includes("course") || text.includes("learn")) {
          reply = `🎓 Language Courses (A1–C2)

✔ English, French, Spanish, German, Chinese  
✔ Exam prep: IELTS, TOEFL, TCF, TEF, DELE  

👉 Register here:
https://lsa-global.com/register-now-2/

Or tell us:
Your level + target exam`;
        }

        else if (text === "3" || text.includes("interpreting")) {
          reply = `🎤 Interpreting Services

✔ Online & onsite  
✔ Conferences, meetings, interviews  

Tell us:
• Language pair  
• Date  
• Duration`;
        }

        else if (text === "4" || text.includes("advisor")) {
          reply = `👤 Speak to an advisor

Our team will contact you shortly.

You can also submit your request here:
https://lsa-global.com/contact-us-lsa-global/`;
        }

        // 💼 LEAD CAPTURE (SMART DETECTION)
        else if (
          text.includes("deadline") ||
          text.includes("translate") ||
          text.split(" ").length > 4
        ) {
          reply = `✅ Thank you. Your request has been received.

Our team will review and get back to you shortly.

For faster processing:
https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/`;
        }

        // 🔁 DEFAULT RESPONSE
        else {
          reply = `Welcome to LSA GLOBAL 👋

Please choose:

1️⃣ Translation  
2️⃣ Courses  
3️⃣ Interpreting  
4️⃣ Advisor`;
        }

        // 📤 SEND MESSAGE
        await axios.post(
          `https://graph.facebook.com/v18.0/${process.env.PHONE_NUMBER_ID}/messages`,
          {
            messaging_product: "whatsapp",
            to: from,
            text: { body: reply },
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
      }

      res.sendStatus(200);
    } else {
      res.sendStatus(404);
    }
  } catch (error) {
    console.error("Error:", error.response?.data || error.message);
    res.sendStatus(500);
  }
});
