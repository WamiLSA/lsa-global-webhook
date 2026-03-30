const OpenAI = require("openai");
const express = require("express");
const axios = require("axios");
const path = require("path");
const fsSync = require("fs");
const fs = require("fs/promises");
const FormData = require("form-data");
const multer = require("multer");
const session = require("express-session");
const { createClient } = require("@supabase/supabase-js");
const { createInternalRetriever } = require("./lib/internal-retrieval");

const app = express();

app.use(express.json({ limit: "20mb" }));
app.use(express.urlencoded({ extended: true, limit: "20mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));
app.use(express.static(path.join(__dirname, "public")));

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
const WHATSAPP_GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v18.0";
const MEDIA_STORAGE_DIR = path.join(__dirname, "uploads", "whatsapp");
const OUTBOUND_ALLOWED_MIME_PREFIXES = [
  "image/",
  "application/pdf"
];

const outboundUploadStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.mkdir(MEDIA_STORAGE_DIR, { recursive: true });
      cb(null, MEDIA_STORAGE_DIR);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const originalName = (file.originalname || "upload").replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${originalName.slice(0, 120)}`);
  }
});

const outboundUpload = multer({
  storage: outboundUploadStorage,
  limits: {
    fileSize: 20 * 1024 * 1024
  },
  fileFilter: (req, file, cb) => {
    const mimeType = (file.mimetype || "").toLowerCase();
    const allowed = OUTBOUND_ALLOWED_MIME_PREFIXES.some(prefix => mimeType.startsWith(prefix));
    if (!allowed) {
      cb(new Error("Unsupported file type. Only image and PDF document are supported."));
      return;
    }
    cb(null, true);
  }
});

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

const SPECIFIC_INTENT_PATTERNS = {
  fee: /\b(fee|fees|price|prix|precio|prezzo|cost|tarif|tariffa|tuition)\b/i,
  duration: /\b(duration|durée|duracion|durata|length|long)\b/i,
  schedule: /\b(schedule|horaire|horario|orario|timetable|time|date)\b/i,
  exam: /\b(exam|examen|test|certification)\b/i,
  registration: /\b(register|registration|enroll|enrollment|inscription|iscrizione|registro)\b/i,
  course: /\b(course|courses|cours|curso|cursos|corso|corsi|class|classes|program)\b/i
};

const NARROW_INTENT_KEYWORDS = {
  fees: [
    "fee", "fees", "price", "prices", "pricing", "cost", "costs", "tariff", "tariffs", "tuition",
    "prix", "tarifs", "coût", "cout", "frais",
    "precio", "precios", "costo", "coste",
    "prezzo", "prezzi", "costo",
    "preço", "precos", "valor",
    "preis", "gebuhr", "gebühr", "kosten"
  ],
  duration: [
    "duration", "durée", "duree", "length", "how long",
    "duracion", "duración", "durata", "duração", "dauer"
  ],
  schedule: [
    "schedule", "schedules", "horaires", "timetable", "hours", "time",
    "horario", "horarios", "orario", "orari", "stundenplan", "zeitplan"
  ],
  levels: [
    "level", "levels", "niveau", "niveaux", "nivel", "niveles", "livello", "livelli", "stufe", "stufen",
    "a1", "a2", "b1", "b2", "c1", "c2"
  ],
  location: ["location", "lieu", "centre", "campus", "city", "ville", "localisation", "ubicacion", "ubicación", "luogo", "sede", "ort", "standort"],
  format: ["format", "online", "onsite", "in-person", "in person", "presentiel", "présentiel", "distance", "presencial", "presenziale", "vor ort"],
  registration: ["registration", "inscription", "enroll", "enrol", "enrollment", "admission", "apply", "inscripcion", "inscripción", "iscrizione", "anmeldung", "registrazione"],
  certification: ["certificate", "certification", "attestation", "testimonial", "proof", "verification", "certificat", "certificado", "certificato", "zertifikat", "nachweis"]
};

const NARROW_INTENT_ALIASES = {
  fee: "fees",
  exam: "certification",
  course: null
};

const MENU_KEYWORDS = {
  translation: ["1", "translation", "traduction", "traduccion", "traduzione", "übersetzung", "ubersetzung", "traducao", "tradução"],
  courses: ["2", "course", "courses", "cours", "curso", "corsi", "kurse", "formacion", "formação", "formation"],
  interpreting: ["3", "interpreting", "interpretation", "interpretariat", "interpretazione", "interpretacion", "interpretação"],
  advisor: ["4", "advisor", "adviser", "human", "agent", "conseiller", "asesor", "berater", "consulente"]
};

const GREETING_PHRASES = {
  en: ["hi", "hello", "hey", "good morning", "good evening"],
  fr: ["bonjour", "bonsoir", "salut", "coucou"],
  es: ["hola", "buenos dias", "buenas tardes", "buenas noches"],
  it: ["ciao", "buongiorno", "buonasera", "salve"],
  pt: ["ola", "bom dia", "boa tarde", "boa noite", "oi"],
  de: ["hallo", "guten tag", "guten morgen", "guten abend"]
};

const SENSITIVE_ESCALATION_PATTERNS = /\b(discount|special offer|negotiat|exception|exceptions|urgent complaint|complaint|complaints|legal issue|refund|refunds|policy waiver|waiver|remboursement|rembolso|rimborso|reembolso)\b/i;
const SUPPORTED_MENU_LANGUAGES = ["en", "fr", "es", "it", "pt", "de"];
const CONVERSATION_LANGUAGE_BY_CONTACT = new Map();

const LOCALIZED_WELCOME_MENUS = {
  en:
    "Hello 👋 Welcome to LSA GLOBAL.\n\nWe offer:\n1️⃣ Translation services\n2️⃣ Language courses\n3️⃣ Interpreting services\n4️⃣ Speak to an advisor\n\nPlease reply with 1, 2, 3 or 4.",
  fr:
    "Bonjour 👋 Bienvenue chez LSA GLOBAL.\n\nNous proposons :\n1️⃣ Services de traduction\n2️⃣ Cours de langues\n3️⃣ Services d’interprétation\n4️⃣ Parler à un conseiller\n\nVeuillez répondre par 1, 2, 3 ou 4.",
  es:
    "Hola 👋 Bienvenido(a) a LSA GLOBAL.\n\nOfrecemos:\n1️⃣ Servicios de traducción\n2️⃣ Cursos de idiomas\n3️⃣ Servicios de interpretación\n4️⃣ Hablar con un asesor\n\nPor favor, responda con 1, 2, 3 o 4.",
  it:
    "Ciao 👋 Benvenuto/a su LSA GLOBAL.\n\nOffriamo:\n1️⃣ Servizi di traduzione\n2️⃣ Corsi di lingua\n3️⃣ Servizi di interpretariato\n4️⃣ Parla con un consulente\n\nPer favore, rispondi con 1, 2, 3 o 4.",
  pt:
    "Olá 👋 Bem-vindo(a) à LSA GLOBAL.\n\nOferecemos:\n1️⃣ Serviços de tradução\n2️⃣ Cursos de idiomas\n3️⃣ Serviços de interpretação\n4️⃣ Falar com um consultor\n\nPor favor, responda com 1, 2, 3 ou 4.",
  de:
    "Hallo 👋 Willkommen bei LSA GLOBAL.\n\nWir bieten:\n1️⃣ Übersetzungsdienstleistungen\n2️⃣ Sprachkurse\n3️⃣ Dolmetschdienste\n4️⃣ Mit einem Berater sprechen\n\nBitte antworten Sie mit 1, 2, 3 oder 4."
};

const LOCALIZED_OPTION_REPLIES = {
  translation: {
    en: "🌍 Translation services.\nPlease send language pair, document type, and deadline.\nQuote request: https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/",
    fr: "🌍 Services de traduction.\nMerci d’envoyer la combinaison linguistique, le type de document et le délai.\nDevis : https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/",
    es: "🌍 Servicios de traducción.\nEnvíe combinación de idiomas, tipo de documento y plazo.\nPresupuesto: https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/",
    it: "🌍 Servizi di traduzione.\nInvii combinazione linguistica, tipo di documento e scadenza.\nPreventivo: https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/",
    pt: "🌍 Serviços de tradução.\nEnvie par de idiomas, tipo de documento e prazo.\nOrçamento: https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/",
    de: "🌍 Übersetzungsdienste.\nBitte senden Sie Sprachpaar, Dokumenttyp und Frist.\nAngebot: https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/"
  },
  courses: {
    en: "🎓 Language courses A1–C2 (online/guided).\nTell me the language you want and your current level.\nRegistration: https://lsa-global.com/register-now-2/",
    fr: "🎓 Cours de langues A1–C2 (en ligne/encadrés).\nIndiquez la langue souhaitée et votre niveau actuel.\nInscription : https://lsa-global.com/register-now-2/",
    es: "🎓 Cursos de idiomas A1–C2 (en línea/guiados).\nIndique el idioma deseado y su nivel actual.\nInscripción: https://lsa-global.com/register-now-2/",
    it: "🎓 Corsi di lingua A1–C2 (online/guidati).\nIndichi la lingua desiderata e il livello attuale.\nIscrizione: https://lsa-global.com/register-now-2/",
    pt: "🎓 Cursos de idiomas A1–C2 (online/orientados).\nIndique o idioma desejado e o seu nível atual.\nInscrição: https://lsa-global.com/register-now-2/",
    de: "🎓 Sprachkurse A1–C2 (online/betreut).\nBitte nennen Sie gewünschte Sprache und aktuelles Niveau.\nAnmeldung: https://lsa-global.com/register-now-2/"
  },
  interpreting: {
    en: "🎧 Interpreting services (online/onsite).\nPlease share language pair, date, and duration.",
    fr: "🎧 Services d’interprétation (en ligne/sur site).\nMerci d’indiquer la combinaison linguistique, la date et la durée.",
    es: "🎧 Servicios de interpretación (en línea/presencial).\nIndique combinación lingüística, fecha y duración.",
    it: "🎧 Servizi di interpretariato (online/in presenza).\nIndichi combinazione linguistica, data e durata.",
    pt: "🎧 Serviços de interpretação (online/presencial).\nInforme par de idiomas, data e duração.",
    de: "🎧 Dolmetschdienste (online/vor Ort).\nBitte teilen Sie Sprachkombination, Datum und Dauer mit."
  },
  advisor: {
    en: "👨‍💼 Advisor Request\n\nPlease describe your need briefly. Our team will contact you shortly.",
    fr: "👨‍💼 Demande de conseiller\n\nVeuillez décrire brièvement votre besoin. Notre équipe vous contactera sous peu.",
    es: "👨‍💼 Solicitud de asesor\n\nDescriba brevemente su necesidad. Nuestro equipo se pondrá en contacto con usted en breve.",
    it: "👨‍💼 Richiesta di consulente\n\nDescriva brevemente la sua esigenza. Il nostro team la contatterà al più presto.",
    pt: "👨‍💼 Solicitação de consultor\n\nDescreva brevemente a sua necessidade. Nossa equipe entrará em contato em breve.",
    de: "👨‍💼 Berateranfrage\n\nBitte beschreiben Sie Ihr Anliegen kurz. Unser Team wird sich in Kürze bei Ihnen melden."
  }
};

function normalizeForIntent(text) {
  return (text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'`]/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectNarrowIntent(message) {
  const normalized = normalizeForIntent(message);
  if (!normalized) return null;

  const hits = [];
  for (const [intent, keywords] of Object.entries(NARROW_INTENT_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      const normalizedKeyword = normalizeForIntent(keyword).replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      if (!normalizedKeyword) continue;
      const regex = new RegExp(`\\b${normalizedKeyword}\\b`, "i");
      if (regex.test(normalized)) {
        score += normalizedKeyword.includes(" ") ? 2 : 1;
      }
    }
    if (score > 0) hits.push({ intent, score });
  }

  if (!hits.length) return null;
  hits.sort((a, b) => b.score - a.score);
  return hits[0].intent;
}

function resolveNarrowIntent(intent) {
  if (!intent) return null;
  if (NARROW_INTENT_KEYWORDS[intent]) return intent;
  return NARROW_INTENT_ALIASES[intent] || null;
}

function extractRelevantKbSection(answerText, intent) {
  if (!answerText || !intent || !NARROW_INTENT_KEYWORDS[intent]) return null;

  const keywords = NARROW_INTENT_KEYWORDS[intent].map(normalizeForIntent);
  const normalizedAnswer = normalizeForIntent(answerText);
  const hasIntentSignal = keywords.some((keyword) => keyword && normalizedAnswer.includes(keyword));

  const paragraphs = answerText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const fallbackParagraphs = answerText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const candidates = paragraphs.length ? paragraphs : fallbackParagraphs;
  const scored = candidates
    .map((section, index) => {
      const normalizedSection = normalizeForIntent(section);
      let score = 0;
      for (const keyword of keywords) {
        if (!keyword) continue;
        const regex = new RegExp(`\\b${keyword.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&")}\\b`, "g");
        const matches = normalizedSection.match(regex);
        if (matches?.length) {
          score += matches.length;
        }
      }
      return { section, score, index };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, 3)
    .map((item) => item.section);

  if (scored.length) return scored.join("\n");

  if (!hasIntentSignal) return null;

  const fallbackLines = answerText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const heuristicSignals = {
    fees: /\b(\$|€|£|fcfa|usd|eur|xaf|cad|price|prix|tarif|fee|cost)\b/i,
    duration: /\b(week|weeks|month|months|hour|hours|jour|jours|semaine|semaines|mois|heures)\b/i,
    schedule: /\b(mon|tue|wed|thu|fri|sat|sun|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|\d{1,2}[:h]\d{0,2})\b/i,
    levels: /\b(a1|a2|b1|b2|c1|c2|beginner|intermediate|advanced|debutant|débutant|niveau|nivel|livello)\b/i,
    location: /\b(address|city|centre|campus|location|lieu|ville|douala|paris|london)\b/i,
    format: /\b(online|in person|in-person|onsite|hybrid|présentiel|presentiel|distance)\b/i,
    registration: /\b(register|registration|inscription|deadline|apply|admission)\b/i,
    certification: /\b(certificate|certification|attestation|proof|exam|examen)\b/i
  };

  const signal = heuristicSignals[intent];
  if (!signal) return null;
  const matchedLine = fallbackLines.find((line) => signal.test(line));
  return matchedLine || null;
}

async function extractNarrowAnswerFromKb({ kbMatches, intent }) {
  const safeIntent = resolveNarrowIntent(intent);
  if (!safeIntent || !kbMatches?.length) return null;

  for (const article of kbMatches) {
    const section = extractRelevantKbSection(article.answer || "", safeIntent);
    if (section) return section;
  }

  const compactKb = kbMatches
    .slice(0, 3)
    .map((article, index) => `[Article ${index + 1}] ${article.title || "Untitled"}\n${article.answer || ""}`)
    .join("\n\n");

  try {
    const extraction = await openai.responses.create({
      model: "gpt-5-mini",
      instructions:
        "Extract ONLY the text that answers the requested field from the KB content. " +
        "Do not add explanations, introductions, or questions. " +
        "If the field does not exist, reply exactly: NOT_FOUND.",
      input: `Field: ${safeIntent}\n\nKB content:\n${compactKb}`
    });
    const extracted = (extraction.output_text || "").trim();
    if (!extracted || /^NOT_FOUND$/i.test(extracted)) return null;
    return extracted;
  } catch (error) {
    console.error("Narrow KB extraction error:", error?.message || error);
    return null;
  }
}

const retrieveInternalKnowledge = createInternalRetriever({
  supabase,
  detectLanguage: detectMessageLanguage
});

const customerState = new Map();

function getCustomerState(waId) {
  if (!waId) return { clarifyingAsked: false };
  return customerState.get(waId) || { clarifyingAsked: false };
}

function setCustomerState(waId, state) {
  if (!waId) return;
  customerState.set(waId, { clarifyingAsked: Boolean(state?.clarifyingAsked) });
}

async function localizeNarrowAnswer({ text, language }) {
  if (!text?.trim()) return "";

  if (!language || language === "en") {
    return enforceReplyStyle(text, "en");
  }

  try {
    const localized = await openai.responses.create({
      model: "gpt-5-mini",
      instructions:
        "Translate the provided answer into the target language while preserving exact facts, figures, and formatting. " +
        "Do not add extra explanations or questions. Keep it concise.",
      input: `Target language: ${language}\n\nText:\n${text}`
    });
    return enforceReplyStyle(localized.output_text || text, language);
  } catch (error) {
    console.error("Narrow answer localization error:", error?.message || error);
    return enforceReplyStyle(text, language);
  }
}

function extractAnswerTextFromRetrievalMatch(match) {
  if (!match || !match.raw_reference) return "";
  const source = match.source;
  const record = match.raw_reference;

  if (source === "kb_articles") {
    return record.answer || record.question || match.snippet || "";
  }

  if (source === "kb_capture_assistant") {
    return record.raw_answer || record.raw_question || record.notes || match.snippet || "";
  }

  if (source === "kb_quick_capture") {
    return record.raw_text || record.notes || match.snippet || "";
  }

  if (source === "providers") {
    return [
      record.organization_name || record.full_name || "",
      record.services || "",
      record.language_pairs || "",
      record.working_languages || "",
      record.specializations || "",
      [record.city, record.country].filter(Boolean).join(", "),
      record.availability_status || "",
      record.notes || ""
    ]
      .filter(Boolean)
      .join("\n");
  }

  return match.snippet || "";
}

async function buildReplyFromUnifiedRetrieval({ retrievalResult, language, specificIntent = null }) {
  const matches = retrievalResult?.matches || [];
  if (!matches.length) return "";

  const topMatch = matches[0];
  const directText = extractAnswerTextFromRetrievalMatch(topMatch);
  if (!directText) return "";

  const resolvedIntent = resolveNarrowIntent(specificIntent);
  const intentFocused = resolvedIntent ? extractRelevantKbSection(directText, resolvedIntent) : null;
  const replySource = intentFocused || directText;

  return localizeNarrowAnswer({
    text: replySource,
    language
  });
}

async function saveMessage({ wa_id, contact_name = null, direction, body, message_type = "text" }) {
  const payload = {
    wa_id,
    contact_name,
    direction,
    body,
    message_type
  };
  const { error } = await supabase.from("conversations").insert([payload]);

  if (error) {
    console.error("Supabase insert error:", error);
  }
}

function getAttachmentFromMessage(message) {
  if (!message || !message.type) return null;
  const supportedTypes = ["document", "image", "audio", "video"];
  if (!supportedTypes.includes(message.type)) return null;

  const mediaPayload = message[message.type] || {};
  const caption = typeof mediaPayload.caption === "string" ? mediaPayload.caption.trim() : "";
  const fileName = mediaPayload.filename || null;
  const mimeType = mediaPayload.mime_type || null;
  return {
    media_type: message.type,
    media_id: mediaPayload.id || null,
    file_name: fileName,
    mime_type: mimeType,
    caption
  };
}

function getAttachmentFallbackBody(mediaType) {
  const fallbackByType = {
    image: "[image attachment]",
    document: "[document attachment]",
    audio: "[audio attachment]",
    video: "[video attachment]"
  };
  return fallbackByType[mediaType] || "[attachment]";
}

function extensionFromMimeType(mimeType, fallbackType = "bin") {
  const map = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "video/mp4": "mp4",
    "video/3gpp": "3gp",
    "application/pdf": "pdf"
  };
  if (!mimeType) return fallbackType;
  return map[mimeType.toLowerCase()] || fallbackType;
}

async function fetchWhatsAppMediaMetadata(mediaId) {
  if (!mediaId) return null;
  const response = await axios.get(`https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${mediaId}`, {
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`
    }
  });
  return response.data;
}

async function downloadWhatsAppMedia({ mediaId, preferredFileName = null, mimeType = null }) {
  if (!mediaId || !WHATSAPP_TOKEN) return null;
  try {
    const metadata = await fetchWhatsAppMediaMetadata(mediaId);
    const mediaUrl = metadata?.url;
    if (!mediaUrl) return null;

    const mediaResponse = await axios.get(mediaUrl, {
      responseType: "arraybuffer",
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`
      }
    });

    await fs.mkdir(MEDIA_STORAGE_DIR, { recursive: true });
    const sanitizedBaseName = (preferredFileName || mediaId)
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 120);
    const ext = extensionFromMimeType(mimeType || metadata?.mime_type, "bin");
    const safeFilename = `${Date.now()}_${sanitizedBaseName}.${ext}`;
    const absolutePath = path.join(MEDIA_STORAGE_DIR, safeFilename);

    await fs.writeFile(absolutePath, mediaResponse.data);

    return {
      media_url: `/uploads/whatsapp/${safeFilename}`,
      mime_type: mimeType || metadata?.mime_type || null
    };
  } catch (error) {
    console.error("WhatsApp media download error:", error.response?.data || error.message || error);
    return null;
  }
}

async function saveMessageWithMetadata({
  wa_id,
  contact_name = null,
  direction,
  body,
  message_type = "text",
  media_type = null,
  media_id = null,
  media_url = null,
  file_name = null,
  mime_type = null,
  caption = null
}) {
  const payload = {
    wa_id,
    contact_name,
    direction,
    body,
    message_type,
    media_type,
    media_id,
    media_url,
    file_name,
    mime_type,
    caption
  };

  const { error } = await supabase.from("conversations").insert([payload]);
  if (!error) return;

  const columnMissing = /column .* does not exist/i.test(error.message || "");
  if (!columnMissing) {
    console.error("Supabase insert with metadata error:", error);
    return;
  }

  await saveMessage({ wa_id, contact_name, direction, body, message_type });
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
    `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`,
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

function getOutboundMediaTypeFromMime(mimeType) {
  const normalized = (mimeType || "").toLowerCase();
  if (normalized.startsWith("image/")) return "image";
  if (normalized === "application/pdf") return "document";
  return null;
}

async function uploadMediaToWhatsApp({ filePath, mimeType }) {
  const form = new FormData();
  form.append("messaging_product", "whatsapp");
  form.append("type", mimeType);
  form.append("file", fsSync.createReadStream(filePath));

  const response = await axios.post(
    `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${PHONE_NUMBER_ID}/media`,
    form,
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        ...form.getHeaders()
      }
    }
  );

  return response.data?.id || null;
}

async function sendWhatsAppMedia({ to, mediaType, mediaId, caption = "" }) {
  const payload = {
    messaging_product: "whatsapp",
    to,
    type: mediaType,
    [mediaType]: {
      id: mediaId
    }
  };

  if (caption && (mediaType === "image" || mediaType === "document")) {
    payload[mediaType].caption = caption;
  }

  const response = await axios.post(
    `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`,
    payload,
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
  const rawMessage = (userMessage || "").trim();
  if (!rawMessage) return [];
  const retrieval = await retrieveInternalKnowledge(rawMessage, {
    maxMatches: 12,
    sources: ["kb_articles"]
  });
  return retrieval.matches
    .filter(match => match.source === "kb_articles")
    .map(match => match.raw_reference)
    .filter(Boolean)
    .slice(0, 6);
}

function detectMessageLanguage(text) {
  const value = (text || "").toLowerCase();
  if (!value.trim()) return "en";
  const greetingLanguage = detectGreetingIntent(text)?.language;
  if (greetingLanguage) return greetingLanguage;

  if (/[àâæçéèêëîïôœùûüÿ]/.test(value) || /\b(bonjour|merci|cours|prix|tarif|inscription|formation|horaire)\b/.test(value)) {
    return "fr";
  }
  if (/[¿¡ñáéíóú]/.test(value) || /\b(hola|gracias|curso|precio|horario|duración|inscripción)\b/.test(value)) {
    return "es";
  }
  if (/[äöüß]/.test(value) || /\b(hallo|danke|kurs|preis|zeitplan|dauer)\b/.test(value)) {
    return "de";
  }
  if (/\b(ciao|grazie|corso|prezzo|orario|durata)\b/.test(value)) {
    return "it";
  }
  if (/[ãõçáâàéêíóôú]/.test(value) || /\b(ola|olá|obrigado|obrigada|curso|preco|preço|horario|horário|duração|inscricao|inscrição)\b/.test(value)) {
    return "pt";
  }

  return "en";
}

function getLocalizedAck(language) {
  switch (language) {
    case "fr":
      return "Merci. Nous examinons votre demande.";
    case "es":
      return "Gracias. Estamos revisando su solicitud.";
    case "de":
      return "Danke. Wir prüfen Ihre Anfrage.";
    case "it":
      return "Grazie. Stiamo esaminando la sua richiesta.";
    case "pt":
      return "Obrigado. Estamos a analisar o seu pedido.";
    default:
      return "Thank you. We are reviewing your request.";
  }
}

function getLocalizedClarifyingQuestion(language) {
  switch (language) {
    case "fr":
      return "Que souhaitez-vous préciser : tarif, durée, horaires, niveau, format ou inscription ?";
    case "es":
      return "¿Qué desea precisar: precio, duración, horario, nivel, modalidad o inscripción?";
    case "de":
      return "Was möchten Sie genau wissen: Preis, Dauer, Zeitplan, Niveau, Format oder Anmeldung?";
    case "it":
      return "Cosa desidera precisare: prezzo, durata, orario, livello, formato o iscrizione?";
    case "pt":
      return "O que deseja especificar: preço, duração, horário, nível, formato ou inscrição?";
    default:
      return "What would you like to specify: fee, duration, schedule, level, format, or registration?";
  }
}

function isGreetingMessage(text) {
  return Boolean(detectGreetingIntent(text));
}

function detectGreetingIntent(text) {
  const normalized = normalizeForIntent(text);
  if (!normalized) return null;

  const words = normalized.split(" ").filter(Boolean);
  for (const [language, phrases] of Object.entries(GREETING_PHRASES)) {
    for (const phrase of phrases) {
      const safePhrase = normalizeForIntent(phrase);
      const phrasePattern = safePhrase.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      const exactRegex = new RegExp(`^${phrasePattern}$`, "i");
      const openerRegex = new RegExp(`^${phrasePattern}\\b`, "i");
      if (exactRegex.test(normalized)) {
        return { language, phrase: safePhrase };
      }
      if (openerRegex.test(normalized) && words.length <= 12) {
        return { language, phrase: safePhrase };
      }
    }
  }

  return null;
}

function getLocalizedMainMenu(language) {
  const safeLang = SUPPORTED_MENU_LANGUAGES.includes(language) ? language : "en";
  return LOCALIZED_WELCOME_MENUS[safeLang] || LOCALIZED_WELCOME_MENUS.en;
}

function detectMenuSelection(text) {
  const normalized = normalizeForIntent(text);
  if (!normalized) return null;
  const tokenCount = normalized.split(/\s+/).filter(Boolean).length;
  for (const [selection, terms] of Object.entries(MENU_KEYWORDS)) {
    if (terms.some((term) => {
      const normalizedTerm = normalizeForIntent(term);
      if (!normalizedTerm) return false;
      if (normalizedTerm === normalized) return true;

      // Keep menu keyword matching strict to avoid swallowing specific follow-up questions
      // like "cours d'italien" after option 2.
      if (tokenCount > 2) return false;
      const termPattern = normalizedTerm.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      return new RegExp(`^${termPattern}$`, "i").test(normalized);
    })) {
      return selection;
    }
  }
  return null;
}

function getLocalizedMenuReply(language, selection) {
  const safeLang = SUPPORTED_MENU_LANGUAGES.includes(language) ? language : "en";
  return LOCALIZED_OPTION_REPLIES[selection]?.[safeLang] || "";
}

function getLocalizedEscalationMessage(language) {
  const byLang = {
    fr: "Merci. Ce point doit être validé par un conseiller LSA GLOBAL. Partagez votre nom et numéro WhatsApp, nous revenons vite vers vous.",
    es: "Gracias. Este punto debe validarlo un asesor de LSA GLOBAL. Comparta su nombre y WhatsApp y le contactamos pronto.",
    it: "Grazie. Questo punto deve essere confermato da un consulente LSA GLOBAL. Condivida nome e numero WhatsApp e la contatteremo presto.",
    pt: "Obrigado. Este ponto precisa ser validado por um consultor da LSA GLOBAL. Partilhe nome e número WhatsApp e entraremos em contacto em breve.",
    de: "Danke. Dieser Punkt muss von einem LSA GLOBAL-Berater bestätigt werden. Bitte teilen Sie Ihren Namen und Ihre WhatsApp-Nummer mit.",
    en: "Thank you. This point needs an LSA GLOBAL advisor. Please share your name and WhatsApp number, and we will contact you shortly."
  };
  return byLang[language] || byLang.en;
}

function resolveConversationLanguage({ waId, text, greetingLanguage }) {
  const stored = CONVERSATION_LANGUAGE_BY_CONTACT.get(waId);
  if (greetingLanguage && SUPPORTED_MENU_LANGUAGES.includes(greetingLanguage)) {
    CONVERSATION_LANGUAGE_BY_CONTACT.set(waId, greetingLanguage);
    return greetingLanguage;
  }

  const normalized = normalizeForIntent(text);
  if (/^[1-4]$/.test(normalized) && stored) {
    return stored;
  }

  const detected = detectMessageLanguage(text);
  const safeDetected = SUPPORTED_MENU_LANGUAGES.includes(detected) ? detected : "en";
  CONVERSATION_LANGUAGE_BY_CONTACT.set(waId, safeDetected);
  return safeDetected;
}

function shouldEscalateToHuman(text) {
  return SENSITIVE_ESCALATION_PATTERNS.test(text || "");
}

function detectSpecificIntent(text) {
  const raw = (text || "").trim();
  if (!raw) return null;
  for (const [intent, pattern] of Object.entries(SPECIFIC_INTENT_PATTERNS)) {
    if (pattern.test(raw)) return intent;
  }
  return null;
}

function isVagueCustomerMessage(text) {
  const normalized = (text || "").toLowerCase().trim();
  if (!normalized) return true;
  if (normalized.length < 8) return true;

  const wordCount = normalized.split(/\s+/).length;
  const hasSpecificSignals = /\b(price|prix|precio|prezzo|fee|fees|cost|date|exam|duration|horaire|schedule|orario|course|cours|curso|corso|translation|traduction|traduzione|level|levels|niveau|format|online|onsite|location|registration|inscription|certification)\b/.test(normalized);
  if (hasSpecificSignals) return false;

  const vaguePhrases = [
    "info",
    "information",
    "details",
    "tell me about",
    "i want to know",
    "about lsa",
    "about alessa",
    "about your company",
    "services",
    "help me",
    "can you help",
    "need help",
    "tell me more"
  ];

  if (vaguePhrases.some((phrase) => normalized.includes(phrase))) return true;
  return wordCount <= 3;
}

function isBroadServiceQuestion(text) {
  const normalized = normalizeForIntent(text);
  if (!normalized) return false;

  const broadPatterns = [
    /\b(course|courses|cours|curso|corsi|service|services|translation|traduction|traduccion|traduzione|interpreting|interpretation|interpreta)\b/,
    /\b(tell me about|more info|information|details|about)\b/
  ];

  const hasBroadSignal = broadPatterns.some((pattern) => pattern.test(normalized));
  const hasSpecificSignal = Boolean(detectNarrowIntent(text) || detectSpecificIntent(text));
  return hasBroadSignal && !hasSpecificSignal;
}

function enforceReplyStyle(text, language = "en") {
  const fallback = getLocalizedAck(language);
  const safeText = (text || "").trim();
  if (!safeText) return fallback;

  const blockedMentions = /\b(other school|other provider|another institute|competitor|outside lsa|go elsewhere|another center|another company|external institute|alternative provider)\b/i;
  if (blockedMentions.test(safeText)) {
    return fallback;
  }

  const lines = safeText
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(0, 4);

  let compact = lines.join("\n");
  if (compact.length > 520) {
    compact = `${compact.slice(0, 517).trimEnd()}...`;
  }
  return compact;
}

async function generateAIAnswerMessage({ customerMessage, kbMatches, retrievalResult = null, specificIntent = null }) {
  const retrievalMatches = retrievalResult?.matches || [];
  const kbContext = retrievalMatches.length
    ? retrievalMatches
      .map((item, index) => {
        return `
[MATCH ${index + 1}]
Source: ${item.source}
Category: ${item.category || "None"}
Title: ${item.title || ""}
Score: ${item.score || 0}
Snippet: ${item.snippet || ""}
`;
      })
      .join("\n")
    : (kbMatches.length
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
      : "NO_MATCH");

  const vagueHint = isVagueCustomerMessage(customerMessage) ? "YES" : "NO";
  const kbMode = retrievalMatches.length ? "INTERNAL_MATCHES_PRESENT" : (kbMatches.length ? "KB_PRESENT" : "KB_MISSING");
  const detectedLanguage = detectMessageLanguage(customerMessage);

  const aiResponse = await openai.responses.create({
    model: "gpt-5-mini",
    instructions: `
You are the LSA GLOBAL WhatsApp assistant.

Core behavior:
1) Answer only the exact question the customer asked. Keep replies short and focused.
2) Do not dump multiple unrelated details. One question -> one direct answer.
3) If customer asks for exam date, provide only the exam date answer from KB.
4) If customer asks for fee, provide only fee answer from KB.
5) If customer asks for discount, negotiation, exception, special offer, or unclear pricing request, do NOT decide discounts. Ask for contact details and say a human advisor will follow up.
6) If question is vague, ask a clarifying question instead of giving a broad company overview.
7) Never recommend competitors or external alternatives. Keep the user inside LSA GLOBAL context only.
8) Use knowledge base content as the primary source of truth.
9) Never invent prices, legal guarantees, turnaround promises, or policies.
10) If KB is present, do not answer from generic model memory. Stay grounded in KB content only.
11) If KB is insufficient, say briefly that a human advisor will assist inside LSA GLOBAL.
12) Reply in the same language as the customer message.
13) Never send users outside LSA GLOBAL, even when information is missing.
14) If the customer asks a broad question, ask one clarifying question only.
15) When a relevant KB answer exists in another language, use it and answer in the customer's language.
16) If KB clearly contains the asked detail, answer it directly and do not say information is unavailable.
17) Keep output under 80 words unless the customer explicitly asks for details.
18) If a specific intent is provided (fee, duration, schedule, exam, registration), answer only that intent.

Style:
- Professional and human-like.
- Maximum 2 short paragraphs.
- Prefer 1-3 sentences for simple questions.
- For short acknowledgement, use natural ${detectedLanguage} wording.
`,
    input: `
Customer message:
${customerMessage}

Message flagged as vague:
${vagueHint}

KB mode:
${kbMode}

Specific intent:
${specificIntent || "none"}

Knowledge base matches:
${kbContext}
`
  });

  return enforceReplyStyle(
    aiResponse.output_text ||
    "Thank you. We have received your message. A human advisor will assist you shortly.",
    detectedLanguage
  );
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
    const attachment = getAttachmentFromMessage(message);
    const hasAttachment = Boolean(attachment);
    let downloadedAttachment = null;

    if (hasAttachment && attachment.media_id) {
      downloadedAttachment = await downloadWhatsAppMedia({
        mediaId: attachment.media_id,
        preferredFileName: attachment.file_name || attachment.media_id,
        mimeType: attachment.mime_type
      });
    }

    const attachmentFallbackBody = hasAttachment
      ? getAttachmentFallbackBody(attachment.media_type)
      : "";
    const inboundBody = text || attachment?.caption || attachmentFallbackBody;

    if (!inboundBody) {
      return res.sendStatus(200);
    }

    console.log("Message received from:", from, "| text:", inboundBody);

    await saveMessageWithMetadata({
      wa_id: from,
      contact_name: contactName,
      direction: "in",
      body: inboundBody,
      message_type: message.type || "text",
      media_type: attachment?.media_type || null,
      media_id: attachment?.media_id || null,
      media_url: downloadedAttachment?.media_url || null,
      file_name: attachment?.file_name || null,
      mime_type: downloadedAttachment?.mime_type || attachment?.mime_type || null,
      caption: attachment?.caption || null
    });

    if (hasAttachment && !text) {
      return res.sendStatus(200);
    }

    let reply = "";
    let suppressAutoAck = false;

    const greetingIntent = detectGreetingIntent(text);
    const detectedLanguage = resolveConversationLanguage({
      waId: from,
      text,
      greetingLanguage: greetingIntent?.language
    });
    const menuSelection = detectMenuSelection(text);

    if (greetingIntent || isGreetingMessage(text)) {
      reply = getLocalizedMainMenu(detectedLanguage);
      suppressAutoAck = true;
    } else if (menuSelection) {
      reply = getLocalizedMenuReply(detectedLanguage, menuSelection);
      suppressAutoAck = true;
    } else {
      const retrievalResult = await retrieveInternalKnowledge(text, { maxMatches: 10 });
      const kbMatches = retrievalResult.matches
        .filter(match => match.source === "kb_articles")
        .map(match => match.raw_reference)
        .filter(Boolean);
      const narrowIntent = detectNarrowIntent(text);
      const specificIntent = detectSpecificIntent(text);
      const resolvedIntent = resolveNarrowIntent(narrowIntent || specificIntent);
      const vagueMessage = isVagueCustomerMessage(text);
      const userState = getCustomerState(from);
      const broadMessage = vagueMessage && !resolvedIntent;

      try {
        if (shouldEscalateToHuman(text)) {
          reply = {
            fr: "Merci. Cette demande nécessite un conseiller LSA GLOBAL. Merci de partager votre nom et numéro WhatsApp, notre équipe vous contacte rapidement.",
            es: "Gracias. Esta solicitud requiere un asesor de LSA GLOBAL. Comparta su nombre y número de WhatsApp y nuestro equipo le contactará pronto.",
            it: "Grazie. Questa richiesta richiede un consulente LSA GLOBAL. Condivida nome e numero WhatsApp e il nostro team la contatterà presto.",
            pt: "Obrigado. Este pedido requer um consultor da LSA GLOBAL. Partilhe o seu nome e número WhatsApp e a nossa equipa entrará em contacto em breve.",
            de: "Danke. Diese Anfrage benötigt einen LSA GLOBAL-Berater. Bitte teilen Sie Ihren Namen und Ihre WhatsApp-Nummer mit, unser Team meldet sich zeitnah.",
            en: "Thank you. This request needs an LSA GLOBAL advisor. Please share your name and WhatsApp number, and our team will contact you shortly."
          }[detectedLanguage] || getLocalizedAck(detectedLanguage);
        } else if (resolvedIntent && kbMatches.length) {
          const extractedSection = await extractNarrowAnswerFromKb({
            kbMatches,
            intent: resolvedIntent
          });
          if (extractedSection) {
            reply = await localizeNarrowAnswer({
              text: extractedSection,
              language: detectedLanguage
            });
          } else {
            reply = {
              fr: "Je n’ai pas trouvé ce point précis dans la base de connaissances. Souhaitez-vous être mis en relation avec un conseiller LSA GLOBAL ?",
              es: "No encontré ese punto específico en la base de conocimientos. ¿Desea que le pongamos en contacto con un asesor de LSA GLOBAL?",
              it: "Non ho trovato questo punto specifico nella base di conoscenza. Vuole che la mettiamo in contatto con un consulente LSA GLOBAL?",
              pt: "Não encontrei esse ponto específico na base de conhecimento. Deseja que o coloquemos em contacto com um consultor da LSA GLOBAL?",
              de: "Ich habe diesen konkreten Punkt in der Wissensdatenbank nicht gefunden. Möchten Sie mit einem LSA GLOBAL-Berater verbunden werden?",
              en: "I could not find that specific point in the knowledge base. Would you like to be connected with an LSA GLOBAL advisor?"
            }[detectedLanguage] || getLocalizedAck(detectedLanguage);
          }
          setCustomerState(from, { clarifyingAsked: false });
        } else if (broadMessage && kbMatches.length && !userState.clarifyingAsked) {
          reply = getLocalizedClarifyingQuestion(detectedLanguage);
          setCustomerState(from, { clarifyingAsked: true });
        } else if (broadMessage && !kbMatches.length) {
          reply = getLocalizedClarifyingQuestion(detectedLanguage);
          setCustomerState(from, { clarifyingAsked: true });
        } else if (retrievalResult.matches.length && !vagueMessage) {
          reply = await buildReplyFromUnifiedRetrieval({
            retrievalResult,
            language: detectedLanguage,
            specificIntent: resolvedIntent
          });
          if (!reply) {
            reply = await generateAIAnswerMessage({
              customerMessage: text,
              kbMatches,
              retrievalResult,
              specificIntent: resolvedIntent
            });
          }
          setCustomerState(from, { clarifyingAsked: false });
        } else {
          reply = await generateAIAnswerMessage({
            customerMessage: text,
            kbMatches,
            retrievalResult,
            specificIntent: resolvedIntent
          });
          if (!broadMessage) {
            setCustomerState(from, { clarifyingAsked: false });
          }
        }

        if (!reply || !reply.trim()) {
          reply = getLocalizedAck(detectedLanguage);
        }
      } catch (err) {
        console.error("AI fallback error:", err.message || err);
        reply = kbMatches.length ? enforceReplyStyle(kbMatches[0]?.answer || "", detectedLanguage) : getLocalizedAck(detectedLanguage);
      }
    }
    if (reply) {
  if (reply.length > 180 && !suppressAutoAck) {
    const ack = getLocalizedAck(detectMessageLanguage(text));

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

app.get("/archived", requireAuth, (req, res) => {
  return res.redirect("/inbox?view=archived");
});

app.use("/api", requireAuth);

app.get("/api/conversations", async (req, res) => {
  try {
    let data;
    let error;

    const activeOnlyResponse = await supabase
      .from("conversations")
      .select("wa_id, contact_name, body, created_at, direction, label")
      .eq("is_archived", false)
      .order("created_at", { ascending: false });

    data = activeOnlyResponse.data;
    error = activeOnlyResponse.error;

    if (error && String(error.message || "").toLowerCase().includes("is_archived")) {
      const fallbackResponse = await supabase
        .from("conversations")
        .select("wa_id, contact_name, body, created_at, direction, label")
        .order("created_at", { ascending: false });
      data = fallbackResponse.data;
      error = fallbackResponse.error;
    }

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


app.get("/api/conversations/archived", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("conversations")
      .select("wa_id, contact_name, body, created_at, direction, label")
      .eq("is_archived", true)
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

async function clearConversationByWaId(wa_id) {
  return supabase
    .from("conversations")
    .delete()
    .eq("wa_id", wa_id);
}

app.post("/api/conversations/:wa_id/clear", async (req, res) => {
  try {
    const wa_id = req.params.wa_id;
    if (!wa_id) {
      return res.status(400).json({ error: "wa_id is required" });
    }

    const { error } = await clearConversationByWaId(wa_id);
    if (error) {
      return res.status(500).json({ error });
    }

    return res.json({
      ok: true,
      action: "clear",
      contactRetained: false,
      reason: "Contact visibility is derived from conversation rows. Keeping contacts visible after clear requires a separate contacts table."
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/conversations/:wa_id/delete", async (req, res) => {
  try {
    const wa_id = req.params.wa_id;
    if (!wa_id) {
      return res.status(400).json({ error: "wa_id is required" });
    }

    const { error } = await clearConversationByWaId(wa_id);
    if (error) {
      return res.status(500).json({ error });
    }

    return res.json({
      ok: true,
      action: "delete",
      removedFromList: true
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/conversations/:wa_id/archive", async (req, res) => {
  try {
    const wa_id = req.params.wa_id;
    if (!wa_id) {
      return res.status(400).json({ error: "wa_id is required" });
    }

    const { error } = await supabase
      .from("conversations")
      .update({ is_archived: true })
      .eq("wa_id", wa_id);

    if (error) {
      const errorMessage = String(error.message || "");
      if (errorMessage.toLowerCase().includes("is_archived")) {
        return res.status(500).json({
          error: "Archive requires the is_archived column. Run the SQL migration before using archive."
        });
      }
      return res.status(500).json({ error });
    }

    return res.json({
      ok: true,
      action: "archive",
      removedFromList: true
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});


app.post("/api/conversations/:wa_id/unarchive", async (req, res) => {
  try {
    const wa_id = req.params.wa_id;
    if (!wa_id) {
      return res.status(400).json({ error: "wa_id is required" });
    }

    const { error } = await supabase
      .from("conversations")
      .update({ is_archived: false })
      .eq("wa_id", wa_id);

    if (error) {
      const errorMessage = String(error.message || "");
      if (errorMessage.toLowerCase().includes("is_archived")) {
        return res.status(500).json({
          error: "Unarchive requires the is_archived column. Run the SQL migration before using archive features."
        });
      }
      return res.status(500).json({ error });
    }

    return res.json({
      ok: true,
      action: "unarchive",
      restoredToList: true
    });
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

app.post("/api/send-attachment", outboundUpload.single("attachment"), async (req, res) => {
  try {
    const { wa_id, caption = "" } = req.body;
    const file = req.file;

    if (!wa_id) {
      return res.status(400).json({ error: "wa_id is required" });
    }
    if (!file) {
      return res.status(400).json({ error: "attachment file is required" });
    }

    const mediaType = getOutboundMediaTypeFromMime(file.mimetype);
    if (!mediaType) {
      return res.status(400).json({ error: "Unsupported file type" });
    }

    const mediaId = await uploadMediaToWhatsApp({
      filePath: file.path,
      mimeType: file.mimetype
    });

    if (!mediaId) {
      return res.status(500).json({ error: "Failed to upload media to WhatsApp" });
    }

    const sendResult = await sendWhatsAppMedia({
      to: wa_id,
      mediaType,
      mediaId,
      caption: typeof caption === "string" ? caption.trim() : ""
    });

    const trimmedCaption = typeof caption === "string" ? caption.trim() : "";
    const fallbackBody = trimmedCaption || getAttachmentFallbackBody(mediaType);

    await saveMessageWithMetadata({
      wa_id,
      direction: "out",
      body: fallbackBody,
      message_type: mediaType,
      media_type: mediaType,
      media_id: mediaId,
      media_url: `/uploads/whatsapp/${path.basename(file.path)}`,
      file_name: file.originalname || path.basename(file.path),
      mime_type: file.mimetype || null,
      caption: trimmedCaption || null
    });

    return res.json({ ok: true, sendResult });
  } catch (error) {
    console.error("Manual attachment send error:", error.response?.data || error.message || error);
    return res.status(500).json({ error: error.response?.data || error.message });
  }
});

app.use((error, req, res, next) => {
  if (!error) return next();
  if (error instanceof multer.MulterError) {
    return res.status(400).json({ error: error.message });
  }
  if (typeof error.message === "string" && error.message.includes("Unsupported file type")) {
    return res.status(400).json({ error: error.message });
  }
  return next(error);
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
app.post("/api/retrieval-test", requireAuth, async (req, res) => {
  try {
    const { query = "", options = {} } = req.body || {};
    if (!query || !query.trim()) {
      return res.status(400).json({ error: "query is required" });
    }

    const result = await retrieveInternalKnowledge(query, options);
    return res.json({ ok: true, retrieval: result });
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

    const retrievalResult = await retrieveInternalKnowledge(message, { maxMatches: 10 });
    const kbMatches = retrievalResult.matches
      .filter(match => match.source === "kb_articles")
      .map(match => match.raw_reference)
      .filter(Boolean);

    const kbContext = retrievalResult.matches.length
      ? retrievalResult.matches.map((item, index) => {
        return `
[MATCH ${index + 1}]
Source: ${item.source}
Category: ${item.category || "None"}
Title: ${item.title || ""}
Score: ${item.score || 0}
Snippet: ${item.snippet || ""}
`;
      }).join("\n")
      : "NO_MATCH";

    const retrievalFirstAnswer = await buildReplyFromUnifiedRetrieval({
      retrievalResult,
      language: detectMessageLanguage(message),
      specificIntent: resolveNarrowIntent(detectNarrowIntent(message) || detectSpecificIntent(message))
    });

    if (retrievalFirstAnswer) {
      return res.json({
        ok: true,
        answer: retrievalFirstAnswer,
        kb_matches: kbMatches.length,
        retrieval_matches: retrievalResult.matches.length
      });
    }

    const instructions = `
You are the LSA GLOBAL AI assistant.

Rules:
1. Use LSA GLOBAL knowledge base first.
1b. Prioritize retrieved internal matches (KB articles, capture assistant, quick capture, providers) before generic reasoning.
2. Never invent prices, legal guarantees, turnaround promises, or policies.
3. If the knowledge base does not clearly answer the question, say so politely and suggest human follow-up.
4. Keep answers businesslike, clear, and concise.
5. Keep every answer strictly inside LSA GLOBAL context. Never recommend competitors or external alternatives.
6. If the message looks like a quote request, partnership request, student inquiry, or support issue, mention that a human advisor can assist.
7. If the question is vague, ask one clarifying question.
8. If a relevant KB article is in another language, still use it and answer in the user's language.
9. Keep replies concise and narrow to the user's exact question.
10. If internal matches clearly answer the question, provide the answer directly and do not claim information is missing.
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

    const answer = enforceReplyStyle(
      response.output_text ||
      "Thank you. Our team will review your message and reply shortly.",
      detectMessageLanguage(message)
    );

    return res.json({
      ok: true,
      answer,
      kb_matches: kbMatches.length,
      retrieval_matches: retrievalResult.matches.length
    });
  } catch (error) {
    console.error("AI route error:", error.response?.data || error.message || error);
    return res.status(500).json({
      error: "AI reply failed"
    });
  }
});
// ===== KB QUICK CAPTURE API: LIST =====
app.get("/api/kb/quick-capture", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("kb_quick_capture")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ error });
    }

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== KB QUICK CAPTURE API: CREATE =====
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

    if (error) {
      return res.status(500).json({ error });
    }

    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== KB QUICK CAPTURE API: DELETE =====
app.delete("/api/kb/quick-capture/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const { error } = await supabase
      .from("kb_quick_capture")
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
// ===== PROVIDER NETWORK PAGE =====
app.get("/providers", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "providers.html"));
});

// ===== PROVIDER API: LIST =====
app.get("/api/providers", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("providers")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ error });
    }

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ===== PROVIDER API: CREATE =====
app.post("/api/providers", async (req, res) => {
  try {
    const {
      provider_type,
      full_name,
      organization_name,
      contact_person,
      email,
      phone,
      whatsapp,
      country,
      city,
      native_language,
      working_languages,
      language_pairs,
      services,
      specializations,
      years_experience,
      availability_status,
      source_channel,
      notes,
      status
    } = req.body;

    if (!provider_type) {
      return res.status(400).json({ error: "provider_type is required" });
    }

    const { data, error } = await supabase
      .from("providers")
      .insert([
        {
          provider_type,
          full_name: full_name || null,
          organization_name: organization_name || null,
          contact_person: contact_person || null,
          email: email || null,
          phone: phone || null,
          whatsapp: whatsapp || null,
          country: country || null,
          city: city || null,
          native_language: native_language || null,
          working_languages: working_languages || null,
          language_pairs: language_pairs || null,
          services: services || null,
          specializations: specializations || null,
          years_experience: years_experience || null,
          availability_status: availability_status || "available",
          source_channel: source_channel || "manual",
          notes: notes || null,
          status: status || "active"
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

// ===== PROVIDER API: UPDATE =====
app.put("/api/providers/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const {
      provider_type,
      full_name,
      organization_name,
      contact_person,
      email,
      phone,
      whatsapp,
      country,
      city,
      native_language,
      working_languages,
      language_pairs,
      services,
      specializations,
      years_experience,
      availability_status,
      source_channel,
      notes,
      status
    } = req.body;

    if (!provider_type) {
      return res.status(400).json({ error: "provider_type is required" });
    }

    const { data, error } = await supabase
      .from("providers")
      .update({
        provider_type,
        full_name: full_name || null,
        organization_name: organization_name || null,
        contact_person: contact_person || null,
        email: email || null,
        phone: phone || null,
        whatsapp: whatsapp || null,
        country: country || null,
        city: city || null,
        native_language: native_language || null,
        working_languages: working_languages || null,
        language_pairs: language_pairs || null,
        services: services || null,
        specializations: specializations || null,
        years_experience: years_experience || null,
        availability_status: availability_status || "available",
        source_channel: source_channel || "manual",
        notes: notes || null,
        status: status || "active",
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

// ===== PROVIDER API: DELETE =====
app.delete("/api/providers/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const { error } = await supabase
      .from("providers")
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
app.get("/kb-capture", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "kb-capture.html"));
});

app.get("/api/kb-capture", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("kb_capture_assistant")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(500).json({ error });
    }

    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/kb-capture", async (req, res) => {
  try {
    const {
      title,
      raw_question,
      raw_answer,
      suggested_category,
      audience,
      source_channel,
      source_reference,
      status,
      notes
    } = req.body;

    if (!raw_answer || !raw_answer.trim()) {
      return res.status(400).json({ error: "raw_answer is required" });
    }

    const { data, error } = await supabase
      .from("kb_capture_assistant")
      .insert([
        {
          title: title || null,
          raw_question: raw_question || null,
          raw_answer,
          suggested_category: suggested_category || null,
          audience: audience || null,
          source_channel: source_channel || "manual",
          source_reference: source_reference || null,
          status: status || "pending",
          notes: notes || null
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

app.put("/api/kb-capture/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const {
      title,
      raw_question,
      raw_answer,
      suggested_category,
      audience,
      source_channel,
      source_reference,
      status,
      notes
    } = req.body;

    if (!raw_answer || !raw_answer.trim()) {
      return res.status(400).json({ error: "raw_answer is required" });
    }

    const { data, error } = await supabase
      .from("kb_capture_assistant")
      .update({
        title: title || null,
        raw_question: raw_question || null,
        raw_answer,
        suggested_category: suggested_category || null,
        audience: audience || null,
        source_channel: source_channel || "manual",
        source_reference: source_reference || null,
        status: status || "pending",
        notes: notes || null,
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

app.delete("/api/kb-capture/:id", async (req, res) => {
  try {
    const id = req.params.id;

    const { error } = await supabase
      .from("kb_capture_assistant")
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
app.post("/api/kb-capture/generate", async (req, res) => {
  try {
    const { raw_question, raw_answer } = req.body;

    if ((!raw_question || !raw_question.trim()) && (!raw_answer || !raw_answer.trim())) {
      return res.status(400).json({ error: "raw_question or raw_answer is required" });
    }

    const { data: categoriesData, error: categoriesError } = await supabase
      .from("kb_categories")
      .select("name")
      .order("name", { ascending: true });

    if (categoriesError) {
      return res.status(500).json({ error: categoriesError });
    }

    const categoryNames = (categoriesData || []).map(c => c.name);

    const prompt = `
You are helping structure knowledge for LSA GLOBAL.

Existing categories:
${categoryNames.join(", ")}

Your job:
Based on the raw question and/or raw answer, generate a structured knowledge suggestion.

Rules:
1. Improve and clarify the question.
2. Generate a professional title.
3. Write a polished answer between 100 and 150 words.
4. Suggest keywords as a comma-separated string.
5. Suggest one audience from: client, student, partner, staff, provider.
6. Suggest the best existing category if one fits.
7. If none of the existing categories fits well, suggest a new category name.
8. Keep the answer factual, professional, and suitable for LSA GLOBAL.
9. Do not invent policies, prices, or guarantees that were not implied by the source text.
10. Return valid JSON only.

Return JSON with exactly these keys:
title
improved_question
improved_answer
keywords
audience
suggested_category
new_category_suggestion
`;

    const input = `
Raw question:
${raw_question || ""}

Raw answer:
${raw_answer || ""}
`;

    const response = await openai.responses.create({
      model: "gpt-5-mini",
      instructions: prompt,
      input
    });

    const text = response.output_text || "{}";

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      return res.status(500).json({
        error: "AI returned invalid JSON",
        raw_output: text
      });
    }

    return res.json({
      ok: true,
      result: parsed
    });
  } catch (error) {
    console.error("KB capture generate error:", error.response?.data || error.message || error);
    return res.status(500).json({ error: "Knowledge generation failed" });
  }
});
app.post("/api/kb-capture/check-duplicates", async (req, res) => {
  try {
    const { title, raw_question, raw_answer } = req.body;

    const searchText = [title || "", raw_question || "", raw_answer || ""]
      .join(" ")
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
          id,
          name
        )
      `)
      .limit(10);

    if (searchText.length > 0) {
      const orParts = [];
      for (const term of searchText) {
        orParts.push(`title.ilike.%${term}%`);
        orParts.push(`question.ilike.%${term}%`);
        orParts.push(`answer.ilike.%${term}%`);
        orParts.push(`keywords.ilike.%${term}%`);
      }
      query = query.or(orParts.join(","));
    }

    const { data, error } = await query;

    if (error) {
      return res.status(500).json({ error });
    }

    return res.json({ ok: true, matches: data || [] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/kb-capture/convert-to-kb", async (req, res) => {
  try {
    const {
      capture_id,
      title,
      question,
      answer,
      keywords,
      audience,
      language,
      status,
      category_name,
      create_new_category
    } = req.body;

    if (!title || !answer) {
      return res.status(400).json({ error: "title and answer are required" });
    }

    let category_id = null;

    if (category_name && category_name.trim()) {
      const trimmedCategory = category_name.trim();

      const { data: existingCategory, error: categoryLookupError } = await supabase
        .from("kb_categories")
        .select("id, name")
        .eq("name", trimmedCategory)
        .maybeSingle();

      if (categoryLookupError) {
        return res.status(500).json({ error: categoryLookupError });
      }

      if (existingCategory) {
        category_id = existingCategory.id;
      } else if (create_new_category) {
        const { data: newCategory, error: newCategoryError } = await supabase
          .from("kb_categories")
          .insert([
            {
              name: trimmedCategory,
              description: "Created from Knowledge Capture Assistant"
            }
          ])
          .select()
          .single();

        if (newCategoryError) {
          return res.status(500).json({ error: newCategoryError });
        }

        category_id = newCategory.id;
      }
    }

    const { data: articleData, error: articleError } = await supabase
      .from("kb_articles")
      .insert([
        {
          category_id,
          title,
          question: question || null,
          answer,
          keywords: keywords || null,
          audience: audience || null,
          language: language || "en",
          status: status || "published",
          source_type: "capture_assistant"
        }
      ])
      .select()
      .single();

    if (articleError) {
      return res.status(500).json({ error: articleError });
    }

    if (capture_id) {
      const { error: captureUpdateError } = await supabase
        .from("kb_capture_assistant")
        .update({
          status: "converted",
          updated_at: new Date().toISOString(),
          notes: "Converted to KB article ID " + articleData.id
        })
        .eq("id", capture_id);

      if (captureUpdateError) {
        return res.status(500).json({ error: captureUpdateError });
      }
    }

    return res.json({
      ok: true,
      article: articleData
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
app.listen(process.env.PORT || 10000, () => {
  console.log("Server running");
});
