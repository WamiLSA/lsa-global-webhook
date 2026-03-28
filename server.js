const express = require("express");
const axios = require("axios");
const path = require("path");
const session = require("express-session");
const { createClient } = require("@supabase/supabase-js");
const OpenAI = require("openai");

const app = express();
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.use(
  session({
    secret: process.env.SESSION_SECRET || "lsa_global_session_secret",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false,
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000
    }
  })
);

// ===== ENV =====
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "LSA_GLOBAL_TOKEN";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_ANON_KEY;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";

const INBOX_USERNAME = process.env.INBOX_USERNAME || "admin";
const INBOX_PASSWORD = process.env.INBOX_PASSWORD || "admin123";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY / SUPABASE_ANON_KEY");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;

// ===== AUTH =====
function requireAuth(req, res, next) {
  if (req.session && req.session.loggedIn) {
    return next();
  }
  return res.redirect("/login");
}

// ===== HELPERS =====
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

function normalizeTextMessage(message) {
  if (!message) return "";
  return message.text?.body?.trim() || "";
}

async function saveMessage({
  wa_id,
  contact_name = null,
  direction,
  body,
  message_type = "text"
}) {
  try {
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
      console.error("saveMessage error:", error);
    }
  } catch (err) {
    console.error("saveMessage crash:", err.message);
  }
}

async function sendWhatsAppText(to, body, delayMs = null) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) {
    throw new Error("WHATSAPP_TOKEN or PHONE_NUMBER_ID missing");
  }

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
  const terms = (userMessage || "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);

  const { data, error } = await supabase
    .from("kb_articles")
    .select(`
      id,
      category_id,
      title,
      question,
      answer,
      keywords,
      audience,
      language,
      status,
      kb_categories (
        id,
        name
      )
    `)
    .eq("status", "published")
    .limit(50);

  if (error) {
    console.error("KB search error:", error);
    return [];
  }

  const items = data || [];

  if (terms.length === 0) return items.slice(0, 8);

  const matches = items.filter(item => {
    const haystack = [
      item.title || "",
      item.question || "",
      item.answer || "",
      item.keywords || "",
      item.audience || "",
      item.language || "",
      item.kb_categories?.name || ""
    ]
      .join(" ")
      .toLowerCase();

    return terms.some(term => haystack.includes(term));
  });

  return matches.slice(0, 8);
}

async function generateAIAnswer(message) {
  if (!openai) {
    return "Thank you. We have received your message. A human advisor will assist you shortly.";
  }

  const kbMatches = await searchKnowledgeBase(message);

  const kbContext = kbMatches.length
    ? kbMatches
        .map((item, index) => {
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
        })
        .join("\n")
    : "NO_MATCH";

  const response = await openai.responses.create({
    model: "gpt-5-mini",
    instructions: `
You are the LSA GLOBAL AI assistant.

Rules:
1. Use LSA GLOBAL knowledge base first.
2. Never invent prices, legal guarantees, turnaround promises, or policies.
3. If the knowledge base does not clearly answer the question, say so politely and suggest human follow-up.
4. Keep answers businesslike, clear, and concise.
5. If the topic is outside LSA GLOBAL knowledge but is safe general background, you may answer briefly, but do not override official LSA GLOBAL information.
6. If the message looks like a quote request, partnership request, student inquiry, support issue, or provider request, mention that a human advisor can assist.
`,
    input: `
Customer message:
${message}

Knowledge base matches:
${kbContext}
`
  });

  return (
    response.output_text ||
    "Thank you. Our team will review your message and reply shortly."
  );
}

// ===== AUTH PAGES =====
app.get("/login", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "login.html"));
});

app.post("/login", (req, res) => {
  const { username, password } = req.body;

  if (username === INBOX_USERNAME && password === INBOX_PASSWORD) {
    req.session.loggedIn = true;
    return res.redirect("/inbox");
  }

  return res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>LSA GLOBAL Inbox Login</title></head>
    <body style="font-family:Arial,sans-serif;background:#f7f7f7;padding:40px;">
      <div style="max-width:420px;margin:auto;background:white;padding:24px;border:1px solid #ddd;border-radius:12px;">
        <h1>LSA GLOBAL Inbox</h1>
        <p style="color:#b91c1c;">Invalid username or password.</p>
        <form method="POST" action="/login">
          <input name="username" placeholder="Username" style="width:100%;padding:12px;margin-bottom:12px;box-sizing:border-box;" />
          <input name="password" type="password" placeholder="Password" style="width:100%;padding:12px;margin-bottom:12px;box-sizing:border-box;" />
          <button type="submit" style="width:100%;padding:12px;">Login</button>
        </form>
      </div>
    </body>
    </html>
  `);
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login");
  });
});

// ===== MAIN PAGES =====
app.get("/", (req, res) => {
  if (req.session && req.session.loggedIn) {
    return res.redirect("/inbox");
  }
  return res.redirect("/login");
});

app.get("/inbox", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/kb", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "kb.html"));
});

app.get("/kb-capture", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "kb-capture.html"));
});

app.get("/providers", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "providers.html"));
});

// ===== INBOX API =====
app.get("/api/conversations", requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      return res.status(500).json({ error });
    }

    const map = new Map();
    for (const row of data || []) {
      if (!map.has(row.wa_id)) {
        map.set(row.wa_id, row);
      }
    }

    return res.json(Array.from(map.values()));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.get("/api/conversations/:wa_id", requireAuth, async (req, res) => {
  try {
    const { wa_id } = req.params;
    const { data, error } = await supabase
      .from("conversations")
      .select("*")
      .eq("wa_id", wa_id)
      .order("created_at", { ascending: true });

    if (error) {
      return res.status(500).json({ error });
    }

    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/conversations/:wa_id/reply", requireAuth, async (req, res) => {
  try {
    const { wa_id } = req.params;
    const { body, contact_name } = req.body;

    if (!body || !body.trim()) {
      return res.status(400).json({ error: "body is required" });
    }

    await sendWhatsAppText(wa_id, body.trim(), 1500);

    await saveMessage({
      wa_id,
      contact_name: contact_name || null,
      direction: "out",
      body: body.trim(),
      message_type: "text"
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error("manual reply error:", err.response?.data || err.message || err);
    return res.status(500).json({ error: err.message });
  }
});

// ===== WHATSAPP VERIFY =====
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  return res.sendStatus(403);
});

// ===== WHATSAPP RECEIVE =====
app.post("/webhook", async (req, res) => {
  try {
    const body = req.body;

    if (body.object) {
      const entry = body.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;
      const messages = value?.messages;
      const contacts = value?.contacts;

      if (messages && messages[0]) {
        const message = messages[0];
        const from = message.from;
        const contactName = contacts?.[0]?.profile?.name || null;
        const text = normalizeTextMessage(message);

        console.log("Message received:", text);

        await saveMessage({
          wa_id: from,
          contact_name: contactName,
          direction: "in",
          body: text,
          message_type: "text"
        });

        let reply = "";
        const lowered = text.toLowerCase();

        if (lowered === "hi" || lowered === "hello" || lowered === "hey") {
          reply =
            "Hello 👋 Welcome to LSA GLOBAL.\n\n" +
            "We offer:\n\n" +
            "1️⃣ Translation services\n" +
            "2️⃣ Language courses\n" +
            "3️⃣ Interpreting services\n" +
            "4️⃣ Speak to an advisor\n\n" +
            "Please reply with 1, 2, 3 or 4.";
        } else if (text === "1" || lowered.includes("translation")) {
          reply =
            "🌍 Translation Services\n\n" +
            "We provide certified and professional translations in:\n" +
            "EN, FR, ES, DE, IT, AR, ZH and more.\n\n" +
            "✔ Legal documents\n" +
            "✔ Academic transcripts\n" +
            "✔ Business & websites\n\n" +
            "Get a free quote:\n" +
            "https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/";
        } else if (text === "2" || lowered.includes("course") || lowered.includes("learn")) {
          reply =
            "🎓 Language Courses (A1-C2)\n\n" +
            "We offer online and guided language training in English, French, Spanish, German, Chinese and more.\n\n" +
            "Register here:\n" +
            "https://lsa-global.com/register-now-2/";
        } else if (text === "3" || lowered.includes("interpreting")) {
          reply =
            "🎧 Interpreting Services\n\n" +
            "We provide online and onsite interpreting for meetings, conferences, interviews, and more.\n\n" +
            "Please tell us:\n" +
            "- language pair\n" +
            "- date\n" +
            "- duration";
        } else if (text === "4" || lowered.includes("advisor")) {
          reply =
            "👨‍💼 Advisor Request\n\n" +
            "Please describe your need briefly. Our team will contact you shortly.";
        } else {
          try {
            reply = await generateAIAnswer(text);
          } catch (err) {
            console.error("AI fallback error:", err.response?.data || err.message || err);
            reply =
              "Thank you. We have received your message. A human advisor will assist you shortly.";
          }
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
      }

      return res.sendStatus(200);
    }

    return res.sendStatus(404);
  } catch (error) {
    console.error("Webhook error:", error.response?.data || error.message || error);
    return res.sendStatus(500);
  }
});

// ===== AI TEST ROUTE =====
app.post("/api/ai-reply", async (req, res) => {
  try {
    const { message } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "message is required" });
    }

    const answer = await generateAIAnswer(message);

    return res.json({
      ok: true,
      answer
    });
  } catch (error) {
    console.error("AI route error:", error.response?.data || error.message || error);
    return res.status(500).json({ error: "AI reply failed" });
  }
});

// ===== KB CATEGORIES =====
app.get("/api/kb/categories", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("kb_categories")
      .select("*")
      .order("name", { ascending: true });

    if (error) return res.status(500).json({ error });
    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/kb/categories", async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ error: "name is required" });
    }

    const { data, error } = await supabase
      .from("kb_categories")
      .insert([
        {
          name: name.trim(),
          description: description || null
        }
      ])
      .select();

    if (error) return res.status(500).json({ error });
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== KB ARTICLES =====
app.get("/api/kb/articles", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("kb_articles")
      .select(`
        id,
        category_id,
        title,
        question,
        answer,
        keywords,
        audience,
        language,
        status,
        created_at,
        updated_at,
        kb_categories (
          id,
          name
        )
      `)
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error });
    return res.json(data || []);
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
      return res.status(400).json({ error: "title and answer are required" });
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
          status: status || "published"
        }
      ])
      .select();

    if (error) return res.status(500).json({ error });
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

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
      return res.status(400).json({ error: "title and answer are required" });
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

    if (error) return res.status(500).json({ error });
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete("/api/kb/articles/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { error } = await supabase.from("kb_articles").delete().eq("id", id);

    if (error) return res.status(500).json({ error });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== KB QUICK CAPTURE =====
app.get("/api/kb/quick-capture", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("kb_quick_capture")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) return res.status(500).json({ error });
    return res.json(data || []);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/kb/quick-capture", async (req, res) => {
  try {
    const { title, raw_text, source_type, status, notes } = req.body;

    if (!raw_text || !raw_text.trim()) {
      return res.status(400).json({ error: "raw_text is required" });
    }

    const { data, error } = await supabase
      .from("kb_quick_capture")
      .insert([
        {
          title: title || null,
          raw_text,
          source_type: source_type || "manual",
          status: status || "pending",
          notes: notes || null
        }
      ])
      .select();

    if (error) return res.status(500).json({ error });
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.delete("/api/kb/quick-capture/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { error } = await supabase
      .from("kb_quick_capture")
      .delete()
      .eq("id", id);

    if (error) return res.status(500).json({ error });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== PROVIDERS =====
app.get("/api/providers", async (req, res) =>
