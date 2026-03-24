const express = require("express");
const app = express();

app.use(express.json());

const VERIFY_TOKEN = "LSA_GLOBAL_TOKEN";

// VERIFY
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

// RECEIVE
const axios = require("axios");

const PHONE_NUMBER_ID = "1075889828943774";
const ACCESS_TOKEN = "EAAYRx6VTgZCEBREHkfR7FpZAJBwJ3s98bZCfArbPBVETNPHSrfQrG7ZAlO5Q1N8HGHvbMxZB6Te4Vlgu9pZBbMzVqdcGPbRQMscc7ztkZACWoQN2FtSP8yzKPrudbGUL5IzHyf1dRZCP2GnoGJI7yXkc0vt8WTmAc8TXUjZCJZCSlhrfpl1rTGvhPhBZCVBB2Cn2cyF0hksxlkgTtWbtKAWWSGUx4YZC5kxJFTT1WfpTryR4nvP1EJbmiMfhH84bQWe7ANzDILaFsjYL1ztReyGq7mhfh7FBW211jDUYZBX64xQZDZD";

app.post("/webhook", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const change = entry?.changes?.[0];
    const message = change?.value?.messages?.[0];

    if (message) {
      const from = message.from;
      const text = message.text?.body;

      console.log("Message received:", text);

      await axios.post(
        `https://graph.facebook.com/v19.0/${PHONE_NUMBER_ID}/messages`,
        {
          messaging_product: "whatsapp",
          to: from,
          text: {
            body: "Hello 👋 Welcome to LSA GLOBAL. How can we assist you today?",
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

    res.sendStatus(200);
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.sendStatus(500);
  }
});

app.listen(process.env.PORT || 10000, () => console.log("Server running"));
