const express = require("express");
const axios = require("axios");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "LSA_GLOBAL_TOKEN";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);

function normalizeTextMessage(message) {
  if (!message) return "";
  return message.text?.body?.trim() || "";
}

async function saveMessage({ wa_id, contact_name = null, direction, body, message_type = "text" }) {
  const { error } = await supabase.from("conversations").insert([
    {
      wa_id,
      contact_name,
      direction,
      body,
      message_type
    }
  ]);

  if (error) {
    console.error("Supabase insert error:", error);
  }
}

async function sendWhatsAppText(to, body) {
  const response = await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to,
      text: { body }
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
  return response.data;
}

// ===== VERIFY WEBHOOK =====
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ===== RECEIVE WHATSAPP MESSAGES =====
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (body.object !== "whatsapp_business_account") {
      return res.sendStatus(404);
    }

    const entry = body.entry?.[0];
    const change = entry?.changes?.[0];
    const value = change?.value;
    const message = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    if (!message) {
      return res.sendStatus(200);
    }

    const from = message.from;
    const contactName = contact?.profile?.name || null;
    const text = normalizeTextMessage(message);

    console.log("Message received from:", from, "| text:", text);

    await saveMessage({
      wa_id: from,
      contact_name: contactName,
      direction: "in",
      body: text,
      message_type: message.type || "text"
    });

    // ===== SIMPLE BOT LOGIC =====
    let reply = "";

    if (text.toLowerCase() === "hi" || text.toLowerCase() === "hello") {
      reply =
        "Hello 👋 Welcome to LSA GLOBAL.\n\n" +
        "Please choose a service:\n" +
        "1️⃣ Translation services\n" +
        "2️⃣ Language courses\n" +
        "3️⃣ Interpreting services\n" +
        "4️⃣ Speak to an advisor";
    } else if (text === "1") {
      reply =
        "🌍 Translation Services\n\n" +
        "Please send:\n" +
        "- document type\n" +
        "- source language\n" +
        "- target language\n" +
        "- deadline";
    } else if (text === "2") {
      reply =
        "📚 Language Courses\n\n" +
        "Please tell us:\n" +
        "- language\n" +
        "- current level\n" +
        "- target exam (if any)";
    } else if (text === "3") {
      reply =
        "🎤 Interpreting Services\n\n" +
        "Please tell us:\n" +
        "- language pair\n" +
        "- date\n" +
        "- duration\n" +
        "- online or onsite";
    } else if (text === "4") {
      reply =
        "👨‍💼 Advisor Request\n\n" +
        "Please describe your need briefly. Our team will contact you shortly.";
    }

    if (reply) {
      await sendWhatsAppText(from, reply);

      await saveMessage({
        wa_id: from,
        contact_name: contactName,
        direction: "out",
        body: reply,
        message_type: "text"
      });
    }

    return res.sendStatus(200);
  } catch (error) {
    console.error("Webhook error:", error.response?.data || error.message || error);
    return res.sendStatus(500);
  }
});

// ===== INBOX API =====

// List conversation summaries
app.get("/api/conversations", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("conversations")
     .select("wa_id, contact_name, body, created_at, direction, label")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ error });
    }

    const map = new Map();

    for (const row of data) {
      if (!map.has(row.wa_id)) {
        map.set(row.wa_id, {
          wa_id: row.wa_id,
          contact_name: row.contact_name,
          last_message: row.body,
          last_direction: row.direction,
         last_time: row.created_at,
         label: row.label || ""
        });
      }
    }

    return res.json(Array.from(map.values()));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Get one thread
app.get("/api/conversations/:wa_id", async (req, res) => {
  try {
    const wa_id = req.params.wa_id;

    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .eq("wa_id", wa_id)
      .order("created_at", { ascending: true });

    if (error) {
      return res.status(500).json({ error });
    }

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Manual send from inbox
app.post("/api/send", async (req, res) => {
  try {
    const { wa_id, body } = req.body;

    if (!wa_id || !body) {
      return res.status(400).json({ error: "wa_id and body are required" });
    }

    const sendResult = await sendWhatsAppText(wa_id, body);

    await saveMessage({
      wa_id,
      direction: "out",
      body,
      message_type: "text"
    });

    return res.json({ ok: true, sendResult });
  } catch (error) {
    console.error("Manual send error:", error.response?.data || error.message || error);
    return res.status(500).json({ error: error.response?.data || error.message });
  }
});
app.post("/api/label", async (req, res) => {
  try {
    const { wa_id, label } = req.body;

    if (!wa_id) {
      return res.status(400).json({ error: "wa_id is required" });
    }

    const { error } = await supabase
      .from("conversations")
      .update({ label: label || null })
      .eq("wa_id", wa_id);

    if (error) {
      return res.status(500).json({ error });
    }

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(process.env.PORT || 10000, () => {
  console.log("Server running");
});
