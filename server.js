const OpenAI = require("openai");
const express = require("express");
const axios = require("axios");
const path = require("path");
const session = require("express-session");
const { createClient } = require("@supabase/supabase-js");

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "change_this_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: false
    }
  })
);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "LSA_GLOBAL_TOKEN";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const INBOX_USERNAME = process.env.INBOX_USERNAME;
const INBOX_PASSWORD = process.env.INBOX_PASSWORD;

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
function requireAuth(req, res, next) {
  if (req.session && req.session.authenticated) {
    return next();
  }
  return res.redirect("/login");
}

app.get("/login", (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8" />
      <title>LSA GLOBAL Inbox Login</title>
      <style>
        body {
          font-family: Arial, sans-serif;
          background: #f5f5f5;
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          margin: 0;
        }
        .box {
          width: 360px;
          background: white;
          padding: 24px;
          border-radius: 12px;
          box-shadow: 0 4px 16px rgba(0,0,0,0.1);
        }
        h2 {
          margin-top: 0;
        }
        input {
          width: 100%;
          padding: 10px;
          margin-bottom: 12px;
          box-sizing: border-box;
        }
        button {
          width: 100%;
          padding: 10px;
        }
        .err {
          color: red;
          margin-bottom: 12px;
        }
      </style>
    </head>
    <body>
      <div class="box">
        <h2>LSA GLOBAL Inbox</h2>
        ${req.query.error ? '<div class="err">Invalid username or password.</div>' : ""}
        <form method="POST" action="/login">
          <input type="text" name="username" placeholder="Username" required />
          <input type="password" name="password" placeholder="Password" required />
          <button type="submit">Login</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === INBOX_USERNAME && password === INBOX_PASSWORD) {
    req.session.authenticated = true;
    return res.redirect("/inbox");
  }

  return res.redirect("/login?error=1");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function estimateDelayMs(text) {
  const length = (text || "").length;

  if (length < 80) return 2000;
  if (length < 250) return 4000;
  if (length < 600) return 6000;
  return 8000;
}

async function sendWhatsAppText(to, body, delayMs = null) {
  const wait = delayMs ?? estimateDelayMs(body);
  await sleep(wait);

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
async function searchKnowledgeBase(userMessage) {
  const terms = userMessage
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);

  let query = supabase
    .from("kb_articles")
    .select(`
      id,
      title,
      question,
      answer,
      keywords,
      audience,
      language,
      status,
      kb_categories (
        name
      )
    `)
    .eq("status", "published")
    .limit(8);

  if (terms.length > 0) {
    const orParts = [];
    for (const term of terms) {
      orParts.push(`title.ilike.%${term}%`);
      orParts.push(`question.ilike.%${term}%`);
      orParts.push(`answer.ilike.%${term}%`);
      orParts.push(`keywords.ilike.%${term}%`);
    }
    query = query.or(orParts.join(","));
  }

  const { data, error } = await query;

  if (error) {
    console.error("KB search error:", error);
    return [];
  }

  return data || [];
}
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
else {
  try {
    const aiResponse = await openai.responses.create({
      model: "gpt-5-mini",
      instructions: `
You are the LSA GLOBAL AI assistant.

Rules:
1. Use LSA GLOBAL knowledge base first.
2. Never invent prices, legal guarantees, turnaround promises, or policies.
3. If the knowledge base does not clearly answer the question, say so politely and suggest human follow-up.
4. Keep answers businesslike, clear, and concise.
5. If the topic is outside LSA GLOBAL knowledge but is safe general background, you may answer briefly, but do not override official LSA GLOBAL information.
6. If the message looks like a quote request, partnership request, student inquiry, or support issue, mention that a human advisor can assist.
`,
      input: `
Customer message:
${text}

Knowledge base matches:
${JSON.stringify(await searchKnowledgeBase(text))}
`
    });

    reply =
      aiResponse.output_text ||
      "Thank you. Our team will review your message and reply shortly.";
  } catch (err) {
    console.error("AI fallback error:", err.response?.data || err.message || err);
    reply =
      "Thank you. We have received your message. A human advisor will assist you shortly.";
  }
    if (reply) {
  if (reply.length > 180) {
    const ack = "Thank you. We are reviewing your request.";

    await sendWhatsAppText(from, ack, 1500);

    await saveMessage({
      wa_id: from,
      contact_name: contactName,
      direction: "out",
      body: ack,
      message_type: "text"
    });

    await sendWhatsAppText(from, reply, 5000);

    await saveMessage({
      wa_id: from,
      contact_name: contactName,
      direction: "out",
      body: reply,
      message_type: "text"
    });
  } else {
    await sendWhatsAppText(from, reply, 2500);

    await saveMessage({
      wa_id: from,
      contact_name: contactName,
      direction: "out",
      body: reply,
      message_type: "text"
    });
  }
}

    return res.sendStatus(200);
  } catch (error) {
    console.error("Webhook error:", error.response?.data || error.message || error);
    return res.sendStatus(500);
  }
});

app.get("/", (req, res) => {
  return res.redirect("/inbox");
});

app.get("/inbox", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use("/api", requireAuth);

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
// ===== KNOWLEDGE BASE PAGE =====
app.get("/kb", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "kb.html"));
});

// ===== KB API: CATEGORIES =====
app.get("/api/kb/categories", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("kb_categories")
      .select("*")
      .order("name", { ascending: true });

    if (error) {
      return res.status(500).json({ error });
    }

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/kb/categories", async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) {
      return res.status(400).json({ error: "Category name is required" });
    }

    const { data, error } = await supabase
      .from("kb_categories")
      .insert([
        {
          name,
          description: description || null
        }
      ])
      .select();

    if (error) {
      return res.status(500).json({ error });
    }

    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== KB API: ARTICLES =====
app.get("/api/kb/articles", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("kb_articles")
      .select(`
        *,
        kb_categories (
          id,
          name
        )
      `)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ error });
    }

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/kb/articles", async (req, res) => {
  try {
    const {
      category_id,
      title,
      question,
      answer,
      keywords,
      audience,
      language,
      status
    } = req.body;

    if (!title || !answer) {
      return res.status(400).json({ error: "Title and answer are required" });
    }

    const { data, error } = await supabase
      .from("kb_articles")
      .insert([
        {
          category_id: category_id || null,
          title,
          question: question || null,
          answer,
          keywords: keywords || null,
          audience: audience || null,
          language: language || "en",
          status: status || "published",
          source_type: "manual"
        }
      ])
      .select();

    if (error) {
      return res.status(500).json({ error });
    }

    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
// ===== KB API: UPDATE ARTICLE =====
app.put("/api/kb/articles/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const {
      category_id,
      title,
      question,
      answer,
      keywords,
      audience,
      language,
      status
    } = req.body;

    if (!title || !answer) {
      return res.status(400).json({ error: "Title and answer are required" });
    }

    const { data, error } = await supabase
      .from("kb_articles")
      .update({
        category_id: category_id || null,
        title,
        question: question || null,
        answer,
        keywords: keywords || null,
        audience: audience || null,
        language: language || "en",
        status: status || "published",
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .select();

    if (error) {
      return res.status(500).json({ error });
    }

    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== KB API: DELETE ARTICLE =====
app.delete("/api/kb/articles/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const { error } = await supabase
      .from("kb_articles")
      .delete()
      .eq("id", id);

    if (error) {
      return res.status(500).json({ error });
    }

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
app.post("/api/ai-reply", async (req, res) => {
  try {
    const { message, channel = "internal", wa_id = null } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "message is required" });
    }

    const kbMatches = await searchKnowledgeBase(message);

    const kbContext = kbMatches.length
      ? kbMatches.map((item, index) => {
          return `
[KB ${index + 1}]
Category: ${item.kb_categories?.name || "None"}
Title: ${item.title || ""}
Question: ${item.question || ""}
Keywords: ${item.keywords || ""}
Audience: ${item.audience || ""}
Language: ${item.language || "en"}
Answer: ${item.answer || ""}
`;
        }).join("\n")
      : "NO_MATCH";

    const instructions = `
You are the LSA GLOBAL AI assistant.

Rules:
1. Use LSA GLOBAL knowledge base first.
2. Never invent prices, legal guarantees, turnaround promises, or policies.
3. If the knowledge base does not clearly answer the question, say so politely and suggest human follow-up.
4. Keep answers businesslike, clear, and concise.
5. If the topic is outside LSA GLOBAL knowledge but is safe general background, you may answer briefly, but do not override official LSA GLOBAL information.
6. If the message looks like a quote request, partnership request, student inquiry, or support issue, mention that a human advisor can assist.
`;

    const input = `
Customer message:
${message}

Channel:
${channel}

Knowledge base matches:
${kbContext}

Write the best answer for LSA GLOBAL.
`;

    const response = await openai.responses.create({
      model: "gpt-5-mini",
      instructions,
      input
    });

    const answer =
      response.output_text ||
      "Thank you. Our team will review your message and reply shortly.";

    return res.json({
      ok: true,
      answer,
      kb_matches: kbMatches.length
    });
  } catch (error) {
    console.error("AI route error:", error.response?.data || error.message || error);
    return res.status(500).json({
      error: "AI reply failed"
    });
  }
});
app.listen(process.env.PORT || 10000, () => {
  console.log("Server running");
});
