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
const AI_AUTOREPLY_ENABLED = String(process.env.AI_AUTOREPLY_ENABLED || "false").toLowerCase() === "true";
const APP_ENV = String(process.env.APP_ENV || process.env.NODE_ENV || "production").toLowerCase();
const AI_EXPERIMENTS_ENABLED = String(process.env.AI_EXPERIMENTS_ENABLED || "false").toLowerCase() === "true";
const INTERNAL_MODE_ADMIN_USERS = String(process.env.INTERNAL_MODE_ADMIN_USERS || "")
  .split(",")
  .map(item => item.trim().toLowerCase())
  .filter(Boolean);
const MEDIA_STORAGE_DIR = path.join(__dirname, "uploads", "whatsapp");
const SYSTEM_MODE_FILE = path.join(__dirname, "data", "system-mode.json");
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


const PROVIDER_CAPTURE_STORAGE_DIR = path.join(__dirname, "uploads", "provider-capture");
const PROVIDER_CAPTURE_ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/plain",
  "text/rtf",
  "application/rtf",
  "application/vnd.oasis.opendocument.text",
  "text/html",
  "text/csv",
  "application/json",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);
const PROVIDER_CAPTURE_ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".txt",
  ".rtf",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".odt",
  ".html",
  ".htm",
  ".csv",
  ".xlsx"
]);

const providerCaptureUploadStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.mkdir(PROVIDER_CAPTURE_STORAGE_DIR, { recursive: true });
      cb(null, PROVIDER_CAPTURE_STORAGE_DIR);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const originalName = (file.originalname || "provider_document").replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${originalName.slice(0, 120)}`);
  }
});

const providerCaptureUpload = multer({
  storage: providerCaptureUploadStorage,
  limits: {
    fileSize: 20 * 1024 * 1024,
    files: 10
  },
  fileFilter: (req, file, cb) => {
    const mimeType = (file.mimetype || "").toLowerCase();
    const extension = path.extname(String(file.originalname || "")).toLowerCase();
    const isAllowed = PROVIDER_CAPTURE_ALLOWED_MIME_TYPES.has(mimeType)
      || mimeType.startsWith("image/")
      || PROVIDER_CAPTURE_ALLOWED_EXTENSIONS.has(extension);
    if (!isAllowed) {
      cb(new Error("Unsupported file type for Provider Capture Assistant. Supported: PDF, DOC, DOCX, TXT, RTF, JPG, JPEG, PNG, WEBP, ODT, HTML, CSV, and XLSX."));
      return;
    }
    cb(null, true);
  }
});

function getProviderCaptureFileType(fileName = "", mimeType = "") {
  const extension = path.extname(String(fileName || "")).toLowerCase();
  const mime = String(mimeType || "").toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".webp"].includes(extension) || mime.startsWith("image/")) return "image";
  if (extension === ".pdf" || mime === "application/pdf") return "pdf";
  if (extension === ".doc" || mime === "application/msword") return "doc";
  if (extension === ".docx" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  if (extension === ".txt" || mime === "text/plain") return "txt";
  if (extension === ".rtf" || mime === "text/rtf" || mime === "application/rtf") return "rtf";
  if (extension === ".odt" || mime === "application/vnd.oasis.opendocument.text") return "odt";
  if (extension === ".html" || extension === ".htm" || mime === "text/html") return "html";
  if (extension === ".csv" || mime === "text/csv") return "csv";
  if (extension === ".xlsx" || mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  return "unknown";
}

function stripHtmlTags(value = "") {
  return String(value || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTextFromRtf(value = "") {
  return String(value || "")
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\'[0-9a-fA-F]{2}/g, " ")
    .replace(/\\[a-z]+-?\d*\s?/g, " ")
    .replace(/[{}]/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractTextFromCsv(value = "") {
  return String(value || "")
    .split(/\r?\n/)
    .map(line => line.split(",").map(cell => cell.trim()).join(" | "))
    .join("\n")
    .trim();
}

async function extractTextWithAiFromFile({ safePath, mimeType, originalName, maxChars = 12000 }) {
  const buffer = await fs.readFile(safePath);
  const bytes = buffer.byteLength;
  if (!bytes) return { text: "", warning: "File is empty." };
  if (bytes > 6 * 1024 * 1024) {
    return { text: "", warning: "File is too large for AI extraction. Please upload a smaller file or paste text manually." };
  }

  const mime = String(mimeType || "application/octet-stream").toLowerCase();
  const base64 = buffer.toString("base64");
  const aiInputContent = [{
    type: "input_text",
    text: "Extract all readable text from this provider document. Preserve paragraph structure where possible. Return plain text only."
  }];

  if (mime.startsWith("image/")) {
    aiInputContent.push({
      type: "input_image",
      image_url: `data:${mime};base64,${base64}`
    });
  } else {
    aiInputContent.push({
      type: "input_file",
      filename: originalName || path.basename(safePath),
      file_data: `data:${mime};base64,${base64}`
    });
  }

  const response = await openai.responses.create({
    model: "gpt-5-mini",
    input: [{ role: "user", content: aiInputContent }]
  });

  const extracted = String(response.output_text || "").trim();
  return {
    text: extracted.slice(0, maxChars),
    warning: extracted ? "" : "No readable text was extracted by AI."
  };
}

async function extractProviderAttachmentText({ safePath, mimeType, originalName }) {
  const fileType = getProviderCaptureFileType(originalName, mimeType);
  const extraction = {
    fileType,
    text: "",
    status: "failed",
    warning: ""
  };

  try {
    if (["txt", "html", "csv", "rtf"].includes(fileType)) {
      const raw = await fs.readFile(safePath, "utf-8");
      if (fileType === "html") extraction.text = stripHtmlTags(raw);
      else if (fileType === "csv") extraction.text = extractTextFromCsv(raw);
      else if (fileType === "rtf") extraction.text = extractTextFromRtf(raw);
      else extraction.text = raw.trim();
    } else if (["pdf", "doc", "docx", "odt", "xlsx", "image"].includes(fileType)) {
      const aiExtracted = await extractTextWithAiFromFile({ safePath, mimeType, originalName });
      extraction.text = aiExtracted.text;
      extraction.warning = aiExtracted.warning || "";
    } else {
      extraction.warning = "Unsupported file type.";
    }

    extraction.text = String(extraction.text || "").trim().slice(0, 12000);
    if (extraction.text) {
      extraction.status = "success";
    } else {
      extraction.status = "failed";
      if (!extraction.warning) extraction.warning = "No readable text could be extracted.";
    }
    return extraction;
  } catch (error) {
    extraction.status = "failed";
    extraction.warning = `Extraction error: ${error.message || "Unknown error"}`;
    return extraction;
  }
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY);
const openai = new OpenAI({ apiKey: OPENAI_API_KEY });
const TEST_LIKE_ENVS = new Set(["test", "testing", "staging", "development", "dev"]);
const IS_TEST_MODE = TEST_LIKE_ENVS.has(APP_ENV);
function resolveDefaultSystemMode() {
  if (IS_TEST_MODE && AI_EXPERIMENTS_ENABLED) {
    return "test";
  }
  return "live";
}

function readPersistedSystemMode() {
  try {
    if (!fsSync.existsSync(SYSTEM_MODE_FILE)) {
      return null;
    }
    const payload = fsSync.readFileSync(SYSTEM_MODE_FILE, "utf-8");
    const parsed = JSON.parse(payload);
    return parsed?.mode === "test" ? "test" : parsed?.mode === "live" ? "live" : null;
  } catch (error) {
    console.warn("[mode] Failed to read persisted mode:", error.message);
    return null;
  }
}

const runtimeSystemState = {
  mode: readPersistedSystemMode() || resolveDefaultSystemMode(),
  updatedAt: new Date().toISOString()
};

async function persistSystemMode(mode) {
  await fs.mkdir(path.dirname(SYSTEM_MODE_FILE), { recursive: true });
  await fs.writeFile(
    SYSTEM_MODE_FILE,
    JSON.stringify({ mode, updated_at: new Date().toISOString() }, null, 2),
    "utf-8"
  );
}

function isTestModeEnabled() {
  return runtimeSystemState.mode === "test";
}

function isAutonomousReplyAllowed() {
  return isTestModeEnabled() && AI_EXPERIMENTS_ENABLED && AI_AUTOREPLY_ENABLED;
}

function getModeCapabilities() {
  return {
    autonomous_ai_answering: isAutonomousReplyAllowed(),
    ai_experimentation: isTestModeEnabled() && AI_EXPERIMENTS_ENABLED
  };
}

console.log(`[mode] APP_ENV=${APP_ENV} | IS_TEST_ENV=${IS_TEST_MODE ? "true" : "false"} | START_MODE=${runtimeSystemState.mode.toUpperCase()}`);
console.log(`[safety] AI_EXPERIMENTS_ENABLED=${AI_EXPERIMENTS_ENABLED ? "true" : "false"} | AI_AUTOREPLY_ENABLED=${AI_AUTOREPLY_ENABLED ? "true" : "false"} | AUTONOMOUS_REPLY_ALLOWED=${isAutonomousReplyAllowed() ? "true" : "false"}`);

function requireAiExperimentMode(res) {
  if (isTestModeEnabled() && AI_EXPERIMENTS_ENABLED) return true;
  res.status(403).json({
    error: "AI experiment endpoints are disabled while Live Mode is active"
  });
  return false;
}
function canChangeMode(req) {
  const sessionUser = String(req.session?.username || "").toLowerCase();
  if (!sessionUser) return false;
  if (!INTERNAL_MODE_ADMIN_USERS.length) {
    return sessionUser === String(INBOX_USERNAME || "").toLowerCase();
  }
  return INTERNAL_MODE_ADMIN_USERS.includes(sessionUser);
}
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
    req.session.username = username;
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
  en: ["hello", "hi", "hey", "good morning", "good evening"],
  fr: ["bonjour", "bonsoir", "salut", "coucou"],
  es: ["hola", "buenos días", "buenos dias", "buenas tardes", "buenas noches"],
  de: ["guten tag", "guten morgen", "guten abend", "hallo"],
  it: ["ciao", "buongiorno", "buonasera", "salve"],
  pt: ["olá", "ola", "bom dia", "boa tarde", "boa noite", "oi"],
  zh: ["你好", "您好", "早上好", "下午好", "晚上好"],
  ru: ["привет", "здравствуйте", "добрый день", "добрый вечер"],
  ja: ["こんにちは", "おはよう", "こんばんは", "もしもし"],
  nl: ["hallo", "goedemorgen", "goedenavond"],
  ro: ["bună", "buna", "bună ziua", "buna ziua", "bună seara", "buna seara"],
  pl: ["cześć", "czesc", "dzień dobry", "dzien dobry", "dobry wieczór", "dobry wieczor"],
  sv: ["hej", "god morgon", "god kväll", "god kvall"],
  da: ["hej", "godmorgen", "godaften"],
  no: ["hei", "god morgen", "god kveld"]
};

const SENSITIVE_ESCALATION_PATTERNS = /\b(discount|special offer|negotiat|exception|exceptions|urgent complaint|complaint|complaints|legal issue|refund|refunds|policy waiver|waiver|remboursement|rembolso|rimborso|reembolso)\b/i;
const SUPPORTED_LIVE_MODE_LANGUAGES = ["en", "fr", "de", "es", "it", "pt", "zh", "ru", "ja", "nl", "ro", "pl", "sv", "da", "no"];
const INTERNAL_WORKING_LANGUAGE_DEFAULT = SUPPORTED_LIVE_MODE_LANGUAGES.includes(String(process.env.INTERNAL_WORKING_LANGUAGE || "").toLowerCase())
  ? String(process.env.INTERNAL_WORKING_LANGUAGE || "").toLowerCase()
  : "en";
const CONVERSATION_LANGUAGE_BY_CONTACT = new Map();
const COURSE_LANGUAGE_KEYWORDS = {
  italian: ["italien", "italian", "italiano", "italiana"],
  english: ["anglais", "english", "ingles", "inglés", "inglese"],
  french: ["francais", "français", "french", "francese", "frances", "française"],
  german: ["allemand", "german", "deutsch", "tedesco", "aleman", "alemán"],
  spanish: ["espagnol", "spanish", "espanol", "español", "spagnolo"],
  portuguese: ["portugais", "portuguese", "portugues", "português", "portoghese"],
  chinese: ["chinois", "chinese", "mandarin", "mandarim", "mandarín", "cinese"],
  arabic: ["arabe", "arabe", "arabic", "arabo", "árabe"]
};
const PROCESSED_MESSAGE_IDS = new Map();
const MESSAGE_DEDUP_TTL_MS = 5 * 60 * 1000;

const LIVE_MODE_MESSAGES = {
  en: {
    greeting_menu: "Hello 👋 Welcome to LSA GLOBAL.\n\nWe offer:\n1️⃣ Translation services\n2️⃣ Language courses\n3️⃣ Interpreting services\n4️⃣ Speak to an advisor\n\nPlease reply with 1, 2, 3 or 4.",
    options: {
      translation: "🌍 Translation services.\nPlease send language pair, document type, and deadline.\nQuote request: https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/",
      courses: "🎓 Language courses A1–C2 (online/guided).\nTell me the language you want and your current level.\nRegistration: https://lsa-global.com/register-now-2/",
      interpreting: "🎧 Interpreting services (online/onsite).\nPlease share language pair, date, and duration.",
      advisor: "👨‍💼 Advisor Request\n\nPlease describe your need briefly. Our team will contact you shortly."
    },
    safe_handoff: "Thank you. Your request has been received. A member of the LSA GLOBAL team will reply shortly.",
    fallback: "Please reply with 1, 2, 3 or 4."
  },
  fr: {
    greeting_menu: "Bonjour 👋 Bienvenue chez LSA GLOBAL.\n\nNous proposons :\n1️⃣ Services de traduction\n2️⃣ Cours de langues\n3️⃣ Services d’interprétation\n4️⃣ Parler à un conseiller\n\nVeuillez répondre par 1, 2, 3 ou 4.",
    options: {
      translation: "🌍 Services de traduction.\nMerci d’envoyer la combinaison linguistique, le type de document et le délai.\nDevis : https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/",
      courses: "🎓 Cours de langues A1–C2 (en ligne/encadrés).\nIndiquez la langue souhaitée et votre niveau actuel.\nInscription : https://lsa-global.com/register-now-2/",
      interpreting: "🎧 Services d’interprétation (en ligne/sur site).\nMerci d’indiquer la combinaison linguistique, la date et la durée.",
      advisor: "👨‍💼 Demande de conseiller\n\nVeuillez décrire brièvement votre besoin. Notre équipe vous contactera sous peu."
    },
    safe_handoff: "Merci. Votre demande a bien été reçue. Un membre de l’équipe LSA GLOBAL vous répondra sous peu.",
    fallback: "Veuillez répondre par 1, 2, 3 ou 4."
  },
  de: {
    greeting_menu: "Hallo 👋 Willkommen bei LSA GLOBAL.\n\nWir bieten:\n1️⃣ Übersetzungsdienstleistungen\n2️⃣ Sprachkurse\n3️⃣ Dolmetschdienste\n4️⃣ Mit einem Berater sprechen\n\nBitte antworten Sie mit 1, 2, 3 oder 4.",
    options: {
      translation: "🌍 Übersetzungsdienste.\nBitte senden Sie Sprachpaar, Dokumenttyp und Frist.\nAngebot: https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/",
      courses: "🎓 Sprachkurse A1–C2 (online/betreut).\nBitte nennen Sie gewünschte Sprache und aktuelles Niveau.\nAnmeldung: https://lsa-global.com/register-now-2/",
      interpreting: "🎧 Dolmetschdienste (online/vor Ort).\nBitte teilen Sie Sprachkombination, Datum und Dauer mit.",
      advisor: "👨‍💼 Berateranfrage\n\nBitte beschreiben Sie Ihr Anliegen kurz. Unser Team wird sich in Kürze bei Ihnen melden."
    },
    safe_handoff: "Danke. Ihre Anfrage wurde erhalten. Ein Mitglied des LSA GLOBAL-Teams wird Ihnen in Kürze antworten.",
    fallback: "Bitte antworten Sie mit 1, 2, 3 oder 4."
  },
  es: {
    greeting_menu: "Hola 👋 Bienvenido(a) a LSA GLOBAL.\n\nOfrecemos:\n1️⃣ Servicios de traducción\n2️⃣ Cursos de idiomas\n3️⃣ Servicios de interpretación\n4️⃣ Hablar con un asesor\n\nPor favor, responda con 1, 2, 3 o 4.",
    options: {
      translation: "🌍 Servicios de traducción.\nEnvíe combinación de idiomas, tipo de documento y plazo.\nPresupuesto: https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/",
      courses: "🎓 Cursos de idiomas A1–C2 (en línea/guiados).\nIndique el idioma deseado y su nivel actual.\nInscripción: https://lsa-global.com/register-now-2/",
      interpreting: "🎧 Servicios de interpretación (en línea/presencial).\nIndique combinación lingüística, fecha y duración.",
      advisor: "👨‍💼 Solicitud de asesor\n\nDescriba brevemente su necesidad. Nuestro equipo se pondrá en contacto con usted en breve."
    },
    safe_handoff: "Gracias. Su solicitud ha sido recibida. Un miembro del equipo de LSA GLOBAL le responderá en breve.",
    fallback: "Por favor, responda con 1, 2, 3 o 4."
  },
  it: {
    greeting_menu: "Ciao 👋 Benvenuto/a su LSA GLOBAL.\n\nOffriamo:\n1️⃣ Servizi di traduzione\n2️⃣ Corsi di lingua\n3️⃣ Servizi di interpretariato\n4️⃣ Parla con un consulente\n\nPer favore, rispondi con 1, 2, 3 o 4.",
    options: {
      translation: "🌍 Servizi di traduzione.\nInvii combinazione linguistica, tipo di documento e scadenza.\nPreventivo: https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/",
      courses: "🎓 Corsi di lingua A1–C2 (online/guidati).\nIndichi la lingua desiderata e il livello attuale.\nIscrizione: https://lsa-global.com/register-now-2/",
      interpreting: "🎧 Servizi di interpretariato (online/in presenza).\nIndichi combinazione linguistica, data e durata.",
      advisor: "👨‍💼 Richiesta di consulente\n\nDescriva brevemente la sua esigenza. Il nostro team la contatterà al più presto."
    },
    safe_handoff: "Grazie. La sua richiesta è stata ricevuta. Un membro del team LSA GLOBAL le risponderà al più presto.",
    fallback: "Per favore, rispondi con 1, 2, 3 o 4."
  },
  pt: {
    greeting_menu: "Olá 👋 Bem-vindo(a) à LSA GLOBAL.\n\nOferecemos:\n1️⃣ Serviços de tradução\n2️⃣ Cursos de idiomas\n3️⃣ Serviços de interpretação\n4️⃣ Falar com um consultor\n\nPor favor, responda com 1, 2, 3 ou 4.",
    options: {
      translation: "🌍 Serviços de tradução.\nEnvie par de idiomas, tipo de documento e prazo.\nOrçamento: https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/",
      courses: "🎓 Cursos de idiomas A1–C2 (online/orientados).\nIndique o idioma desejado e o seu nível atual.\nInscrição: https://lsa-global.com/register-now-2/",
      interpreting: "🎧 Serviços de interpretação (online/presencial).\nInforme par de idiomas, data e duração.",
      advisor: "👨‍💼 Solicitação de consultor\n\nDescreva brevemente a sua necessidade. Nossa equipe entrará em contato em breve."
    },
    safe_handoff: "Obrigado(a). Seu pedido foi recebido. Um membro da equipe LSA GLOBAL responderá em breve.",
    fallback: "Por favor, responda com 1, 2, 3 ou 4."
  },
  zh: {
    greeting_menu: "您好 👋 欢迎来到 LSA GLOBAL。\n\n我们提供：\n1️⃣ 翻译服务\n2️⃣ 语言课程\n3️⃣ 口译服务\n4️⃣ 联系顾问\n\n请回复 1、2、3 或 4。",
    options: {
      translation: "🌍 翻译服务。\n请发送语言组合、文件类型和截止日期。\n报价申请：https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/",
      courses: "🎓 语言课程 A1–C2（线上/指导）。\n请告诉我您想学习的语言和当前水平。\n注册：https://lsa-global.com/register-now-2/",
      interpreting: "🎧 口译服务（线上/现场）。\n请提供语言组合、日期和时长。",
      advisor: "👨‍💼 顾问咨询\n\n请简要描述您的需求。我们的团队将尽快与您联系。"
    },
    safe_handoff: "感谢您。我们已收到您的请求。LSA GLOBAL 团队成员将很快回复您。",
    fallback: "请回复 1、2、3 或 4。"
  },
  ru: {
    greeting_menu: "Здравствуйте 👋 Добро пожаловать в LSA GLOBAL.\n\nМы предлагаем:\n1️⃣ Услуги перевода\n2️⃣ Языковые курсы\n3️⃣ Услуги устного перевода\n4️⃣ Связаться с консультантом\n\nПожалуйста, ответьте 1, 2, 3 или 4.",
    options: {
      translation: "🌍 Услуги перевода.\nПожалуйста, укажите языковую пару, тип документа и срок.\nЗапрос цены: https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/",
      courses: "🎓 Языковые курсы A1–C2 (онлайн/с сопровождением).\nСообщите нужный язык и ваш текущий уровень.\nРегистрация: https://lsa-global.com/register-now-2/",
      interpreting: "🎧 Услуги устного перевода (онлайн/на месте).\nУкажите языковую пару, дату и длительность.",
      advisor: "👨‍💼 Запрос консультанта\n\nКратко опишите ваш запрос. Наша команда скоро свяжется с вами."
    },
    safe_handoff: "Спасибо. Ваш запрос получен. Сотрудник команды LSA GLOBAL скоро свяжется с вами.",
    fallback: "Пожалуйста, ответьте 1, 2, 3 или 4."
  },
  ja: {
    greeting_menu: "こんにちは 👋 LSA GLOBALへようこそ。\n\n以下のサービスをご提供しています：\n1️⃣ 翻訳サービス\n2️⃣ 語学コース\n3️⃣ 通訳サービス\n4️⃣ アドバイザーに相談\n\n1、2、3、4 のいずれかで返信してください。",
    options: {
      translation: "🌍 翻訳サービス。\n言語ペア、文書種類、納期をお送りください。\n見積依頼: https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/",
      courses: "🎓 語学コース A1–C2（オンライン/ガイド付き）。\n希望言語と現在のレベルを教えてください。\n登録: https://lsa-global.com/register-now-2/",
      interpreting: "🎧 通訳サービス（オンライン/対面）。\n言語ペア、日付、所要時間を共有してください。",
      advisor: "👨‍💼 アドバイザー相談\n\nご要望を簡単にご記入ください。担当チームよりまもなくご連絡します。"
    },
    safe_handoff: "ありがとうございます。ご依頼を受け付けました。LSA GLOBALチームの担当者がまもなくご返信します。",
    fallback: "1、2、3、4 のいずれかで返信してください。"
  },
  nl: {
    greeting_menu: "Hallo 👋 Welkom bij LSA GLOBAL.\n\nWij bieden:\n1️⃣ Vertaaldiensten\n2️⃣ Taalcursussen\n3️⃣ Tolkdiensten\n4️⃣ Spreek met een adviseur\n\nAntwoord alstublieft met 1, 2, 3 of 4.",
    options: {
      translation: "🌍 Vertaaldiensten.\nStuur taalpaar, documenttype en deadline.\nOfferteaanvraag: https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/",
      courses: "🎓 Taalcursussen A1–C2 (online/begeleid).\nVertel welke taal u wilt en uw huidige niveau.\nRegistratie: https://lsa-global.com/register-now-2/",
      interpreting: "🎧 Tolkdiensten (online/op locatie).\nDeel taalpaar, datum en duur.",
      advisor: "👨‍💼 Adviseurverzoek\n\nBeschrijf kort uw behoefte. Ons team neemt binnenkort contact met u op."
    },
    safe_handoff: "Dank u. Uw aanvraag is ontvangen. Een lid van het LSA GLOBAL-team zal spoedig reageren.",
    fallback: "Antwoord alstublieft met 1, 2, 3 of 4."
  },
  ro: {
    greeting_menu: "Salut 👋 Bine ați venit la LSA GLOBAL.\n\nOferim:\n1️⃣ Servicii de traducere\n2️⃣ Cursuri de limbi străine\n3️⃣ Servicii de interpretariat\n4️⃣ Discutați cu un consilier\n\nVă rugăm să răspundeți cu 1, 2, 3 sau 4.",
    options: {
      translation: "🌍 Servicii de traducere.\nVă rugăm să trimiteți perechea de limbi, tipul documentului și termenul limită.\nCerere ofertă: https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/",
      courses: "🎓 Cursuri de limbi A1–C2 (online/ghidate).\nSpuneți-ne limba dorită și nivelul dvs. actual.\nÎnscriere: https://lsa-global.com/register-now-2/",
      interpreting: "🎧 Servicii de interpretariat (online/la fața locului).\nTrimiteți perechea de limbi, data și durata.",
      advisor: "👨‍💼 Solicitare consilier\n\nDescrieți pe scurt nevoia dvs. Echipa noastră vă va contacta în curând."
    },
    safe_handoff: "Vă mulțumim. Cererea dvs. a fost primită. Un membru al echipei LSA GLOBAL vă va răspunde în curând.",
    fallback: "Vă rugăm să răspundeți cu 1, 2, 3 sau 4."
  },
  pl: {
    greeting_menu: "Cześć 👋 Witamy w LSA GLOBAL.\n\nOferujemy:\n1️⃣ Usługi tłumaczeniowe\n2️⃣ Kursy językowe\n3️⃣ Usługi tłumaczeń ustnych\n4️⃣ Rozmowa z doradcą\n\nProszę odpowiedzieć 1, 2, 3 lub 4.",
    options: {
      translation: "🌍 Usługi tłumaczeniowe.\nProsimy podać parę językową, typ dokumentu i termin.\nZapytanie o wycenę: https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/",
      courses: "🎓 Kursy językowe A1–C2 (online/z opieką).\nPodaj język, którego chcesz się uczyć, oraz obecny poziom.\nRejestracja: https://lsa-global.com/register-now-2/",
      interpreting: "🎧 Usługi tłumaczeń ustnych (online/na miejscu).\nPodaj parę językową, datę i czas trwania.",
      advisor: "👨‍💼 Prośba o doradcę\n\nKrótko opisz swoją potrzebę. Nasz zespół skontaktuje się wkrótce."
    },
    safe_handoff: "Dziękujemy. Twoje zgłoszenie zostało otrzymane. Członek zespołu LSA GLOBAL wkrótce odpowie.",
    fallback: "Proszę odpowiedzieć 1, 2, 3 lub 4."
  },
  sv: {
    greeting_menu: "Hej 👋 Välkommen till LSA GLOBAL.\n\nVi erbjuder:\n1️⃣ Översättningstjänster\n2️⃣ Språkkurser\n3️⃣ Tolkningstjänster\n4️⃣ Prata med en rådgivare\n\nVänligen svara med 1, 2, 3 eller 4.",
    options: {
      translation: "🌍 Översättningstjänster.\nSkicka språkpar, dokumenttyp och deadline.\nOffertförfrågan: https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/",
      courses: "🎓 Språkkurser A1–C2 (online/handledda).\nBerätta vilket språk du vill läsa och din nuvarande nivå.\nRegistrering: https://lsa-global.com/register-now-2/",
      interpreting: "🎧 Tolkningstjänster (online/på plats).\nDela språkpar, datum och varaktighet.",
      advisor: "👨‍💼 Rådgivarförfrågan\n\nBeskriv ditt behov kort. Vårt team kontaktar dig inom kort."
    },
    safe_handoff: "Tack. Din förfrågan har tagits emot. En medlem i LSA GLOBAL-teamet svarar inom kort.",
    fallback: "Vänligen svara med 1, 2, 3 eller 4."
  },
  da: {
    greeting_menu: "Hej 👋 Velkommen til LSA GLOBAL.\n\nVi tilbyder:\n1️⃣ Oversættelsestjenester\n2️⃣ Sprogkurser\n3️⃣ Tolkningstjenester\n4️⃣ Tal med en rådgiver\n\nSvar venligst med 1, 2, 3 eller 4.",
    options: {
      translation: "🌍 Oversættelsestjenester.\nSend venligst sprogpar, dokumenttype og deadline.\nTilbudsforespørgsel: https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/",
      courses: "🎓 Sprogkurser A1–C2 (online/med vejledning).\nFortæl hvilket sprog du ønsker og dit nuværende niveau.\nTilmelding: https://lsa-global.com/register-now-2/",
      interpreting: "🎧 Tolkningstjenester (online/på stedet).\nDel sprogpar, dato og varighed.",
      advisor: "👨‍💼 Rådgiverforespørgsel\n\nBeskriv kort dit behov. Vores team kontakter dig snart."
    },
    safe_handoff: "Tak. Din forespørgsel er modtaget. Et medlem af LSA GLOBAL-teamet vil svare dig snart.",
    fallback: "Svar venligst med 1, 2, 3 eller 4."
  },
  no: {
    greeting_menu: "Hei 👋 Velkommen til LSA GLOBAL.\n\nVi tilbyr:\n1️⃣ Oversettelsestjenester\n2️⃣ Språkkurs\n3️⃣ Tolketjenester\n4️⃣ Snakk med en rådgiver\n\nVennligst svar med 1, 2, 3 eller 4.",
    options: {
      translation: "🌍 Oversettelsestjenester.\nSend språkpar, dokumenttype og frist.\nPrisforespørsel: https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/",
      courses: "🎓 Språkkurs A1–C2 (online/veiledet).\nFortell hvilket språk du ønsker og ditt nåværende nivå.\nRegistrering: https://lsa-global.com/register-now-2/",
      interpreting: "🎧 Tolketjenester (online/på stedet).\nDel språkpar, dato og varighet.",
      advisor: "👨‍💼 Rådgiverforespørsel\n\nBeskriv behovet ditt kort. Teamet vårt kontakter deg snart."
    },
    safe_handoff: "Takk. Vi har mottatt forespørselen din. Et medlem av LSA GLOBAL-teamet vil svare snart.",
    fallback: "Vennligst svar med 1, 2, 3 eller 4."
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

function normalizeGreetingText(text) {
  return normalizeForIntent(text);
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

function extractFeeOnlySection(answerText) {
  const source = (answerText || "").trim();
  if (!source) return null;

  const lines = source
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const fallbackChunks = source
    .split(/(?<=[.!?])\s+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean);

  const units = "(?:frs?\\s*cfa|fcfa|xaf|xof|eur|usd|cad|€|\\$|£)";
  const amountPattern = new RegExp(`\\b\\d{1,3}(?:[\\s.,]\\d{3})*(?:\\s*${units})?\\b`, "i");
  const levelPattern = /\b(a1|a2|b1|b2|c1|c2)\b/i;
  const feeSignalPattern = /\b(fee|fees|price|prices|pricing|cost|costs|tarif|tarifs|prix|frais|tuition|montant|amount)\b/i;
  const registrationSignalPattern = /\b(inscription|registration|enrollment|enrolment|register)\b/i;
  const inclusionSignalPattern = /\b(manuel|manuels|manual|manuals|certificat|certificats|certificate|certificates|inclus|included)\b/i;
  const installmentSignalPattern = /\b(tranche|tranches|installment|installments|instalment|instalments|paiement|payment)\b/i;

  const candidates = lines.length ? lines : fallbackChunks;
  const selected = [];

  for (const chunk of candidates) {
    const normalized = normalizeForIntent(chunk);
    if (!normalized) continue;

    const isLevelFeeLine = levelPattern.test(normalized) && (amountPattern.test(normalized) || feeSignalPattern.test(normalized));
    const isGeneralFeeLine = feeSignalPattern.test(normalized) && amountPattern.test(normalized);
    const isRegistrationLine = registrationSignalPattern.test(normalized) && (feeSignalPattern.test(normalized) || /\bfree|gratuit|gratuits|gratuite\b/i.test(normalized));
    const isInclusionLine = inclusionSignalPattern.test(normalized);
    const isInstallmentLine = installmentSignalPattern.test(normalized);

    if (isLevelFeeLine || isGeneralFeeLine || isRegistrationLine || isInclusionLine || isInstallmentLine) {
      selected.push(chunk);
    }
  }

  if (!selected.length) return null;

  const deduped = Array.from(new Set(selected));
  return deduped.join("\n");
}

function extractRelevantKbSection(answerText, intent) {
  if (!answerText || !intent || !NARROW_INTENT_KEYWORDS[intent]) return null;
  if (intent === "fees") {
    const feeOnlySection = extractFeeOnlySection(answerText);
    if (feeOnlySection) return feeOnlySection;
  }

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

function finalizeCourseMessage(text, maxLength = 900) {
  const source = (text || "").trim();
  if (!source) return "";
  if (source.length <= maxLength) return source;

  const boundary = source.slice(0, maxLength);
  const lastSentenceBreak = Math.max(
    boundary.lastIndexOf(". "),
    boundary.lastIndexOf("! "),
    boundary.lastIndexOf("? "),
    boundary.lastIndexOf("\n")
  );
  if (lastSentenceBreak > 120) {
    return boundary.slice(0, lastSentenceBreak + 1).trim();
  }
  return boundary.trim();
}

function extractCourseFees(article) {
  return extractRelevantKbSection(article?.answer || "", "fees");
}

function extractCourseDuration(article) {
  return extractRelevantKbSection(article?.answer || "", "duration");
}

function extractCourseSchedule(article) {
  return extractRelevantKbSection(article?.answer || "", "schedule");
}

function extractCourseLevels(article) {
  return extractRelevantKbSection(article?.answer || "", "levels");
}

function extractCourseRegistration(article) {
  return extractRelevantKbSection(article?.answer || "", "registration");
}

function formatCourseSummary(article, userLanguage = "fr") {
  if (!article) return "";

  const levels = extractCourseLevels(article);
  const duration = extractCourseDuration(article);
  const format = extractRelevantKbSection(article?.answer || "", "format");
  const schedule = extractCourseSchedule(article);
  const certification = extractRelevantKbSection(article?.answer || "", "certification");

  const compactBits = [levels, duration, format, schedule, certification]
    .filter(Boolean)
    .map((part) => part.replace(/\s+/g, " ").trim());

  if (userLanguage === "fr") {
    const intro = article?.title ? `Voici un résumé du ${article.title.trim()} :` : "Voici un résumé du programme :";
    const bullets = compactBits.slice(0, 5).map((line) => `• ${line}`).join("\n");
    const prompt = "Souhaitez-vous les tarifs, la durée, les horaires, les niveaux ou les modalités d’inscription ?";
    return finalizeCourseMessage([intro, bullets, prompt].filter(Boolean).join("\n"));
  }

  const promptsByLanguage = {
    en: "Would you like fees, duration, schedule, levels, or registration details?",
    es: "¿Desea tarifas, duración, horarios, niveles o modalidades de inscripción?",
    it: "Vuole tariffe, durata, orari, livelli o modalità di iscrizione?",
    pt: "Deseja tarifas, duração, horários, níveis ou modalidades de inscrição?",
    de: "Möchten Sie Gebühren, Dauer, Zeitplan, Niveaus oder Anmeldedetails?"
  };
  const introByLanguage = {
    en: "Here is a quick summary of the course:",
    es: "Aquí tiene un resumen breve del curso:",
    it: "Ecco un breve riepilogo del corso:",
    pt: "Aqui está um resumo breve do curso:",
    de: "Hier ist eine kurze Zusammenfassung des Kurses:"
  };

  const safeLanguage = promptsByLanguage[userLanguage] ? userLanguage : "en";
  const bullets = compactBits.slice(0, 5).map((line) => `• ${line}`).join("\n");
  return finalizeCourseMessage([
    introByLanguage[safeLanguage],
    bullets,
    promptsByLanguage[safeLanguage]
  ].filter(Boolean).join("\n"));
}

async function extractNarrowAnswerFromMatches({ matches, intent }) {
  const safeIntent = resolveNarrowIntent(intent);
  if (!safeIntent || !matches?.length) return null;

  for (const match of matches) {
    const text = extractAnswerTextFromRetrievalMatch(match);
    const section = extractRelevantKbSection(text, safeIntent);
    if (section) return section;
  }

  const compactKb = matches
    .slice(0, 3)
    .map((match, index) => `[Record ${index + 1}] ${match.title || "Untitled"}\n${extractAnswerTextFromRetrievalMatch(match)}`)
    .join("\n\n");

  try {
    const extraction = await openai.responses.create({
      model: "gpt-5-mini",
      instructions:
        "Extract ONLY the text that answers the requested field from the internal content. " +
        "Do not add explanations, introductions, or questions. " +
        "If the field does not exist, reply exactly: NOT_FOUND.",
      input: `Field: ${safeIntent}\n\nInternal content:\n${compactKb}`
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
  if (!waId) return { clarifyingAsked: false, preferredCourseLanguage: null, topicType: null, topicLanguage: null, topicEntity: null };
  return customerState.get(waId) || { clarifyingAsked: false, preferredCourseLanguage: null, topicType: null, topicLanguage: null, topicEntity: null };
}

function setCustomerState(waId, state) {
  if (!waId) return;
  const current = getCustomerState(waId);
  customerState.set(waId, {
    clarifyingAsked: Boolean(state?.clarifyingAsked),
    preferredCourseLanguage: state?.preferredCourseLanguage || current.preferredCourseLanguage || null,
    topicType: state?.topicType || current.topicType || null,
    topicLanguage: state?.topicLanguage || current.topicLanguage || null,
    topicEntity: state?.topicEntity || current.topicEntity || null
  });
}

function detectCourseLanguageMention(text) {
  const normalized = normalizeForIntent(text);
  if (!normalized) return null;
  for (const [language, variants] of Object.entries(COURSE_LANGUAGE_KEYWORDS)) {
    const matches = variants.some((variant) => {
      const normalizedVariant = normalizeForIntent(variant).replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      if (!normalizedVariant) return false;
      return new RegExp(`\\b${normalizedVariant}\\b`, "i").test(normalized);
    });
    if (matches) return language;
  }
  return null;
}

function detectRequestedCourseLanguage(query, recentContext = {}) {
  const explicitLanguage = detectCourseLanguageMention(query);
  if (explicitLanguage) return explicitLanguage;
  return recentContext.topicLanguage || recentContext.preferredCourseLanguage || null;
}

function isLanguageCourseQuery(query, recentContext = {}) {
  const normalized = normalizeForIntent(query || "");
  if (!normalized) return Boolean(recentContext.topicType === "language_course");
  const courseSignal = /\b(course|courses|cours|curso|corsi|corso|class|classes|formation|program|programme|langue|language|idioma|lingua)\b/i.test(normalized);
  return courseSignal || recentContext.topicType === "language_course";
}

async function findCourseArticleByLanguage(requestedLanguage) {
  if (!requestedLanguage || !COURSE_LANGUAGE_KEYWORDS[requestedLanguage]) return null;

  const { data, error } = await supabase
    .from("kb_articles")
    .select("id,title,question,keywords,answer,language,updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("Course article lookup error:", error?.message || error);
    return null;
  }

  const languageKeywords = COURSE_LANGUAGE_KEYWORDS[requestedLanguage] || [];
  const strictMatches = (data || []).filter((article) => {
    const normalizedBlob = normalizeForIntent([
      article?.title || "",
      article?.question || "",
      article?.keywords || "",
      article?.answer || "",
      article?.language || ""
    ].join(" "));

    if (!normalizedBlob) return false;

    const hasCourseSignal = /\b(course|courses|cours|curso|corsi|corso|class|classes|formation|program|programme|langue|language|idioma|lingua)\b/i.test(normalizedBlob);
    if (!hasCourseSignal) return false;

    return languageKeywords.some((variant) => {
      const token = normalizeForIntent(variant).replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      if (!token) return false;
      return new RegExp(`\\b${token}\\b`, "i").test(normalizedBlob);
    });
  });

  if (!strictMatches.length) {
    console.log("[course-debug] selected KB article title: none (strict language match not found)");
    return null;
  }

  const selected = strictMatches[0];
  console.log("[course-debug] selected KB article title:", selected?.title || "(untitled)");
  return selected;
}

function detectArticleCourseLanguage(article) {
  if (!article) return null;
  const blob = [
    article.title || "",
    article.question || "",
    article.keywords || "",
    article.answer || "",
    article.language || ""
  ].join("\n");
  return detectCourseLanguageMention(blob);
}

function isCourseLanguageMismatch(queryLanguageEntity, candidateArticle) {
  if (!queryLanguageEntity || !candidateArticle) return false;
  const candidateLanguage = detectArticleCourseLanguage(candidateArticle);
  return Boolean(candidateLanguage && candidateLanguage !== queryLanguageEntity);
}

function enforceCourseLanguageMatchOrReject(requestedLanguage, candidateArticle) {
  if (!requestedLanguage || !candidateArticle) return { accepted: true, reason: "" };
  if (!isCourseLanguageMismatch(requestedLanguage, candidateArticle)) return { accepted: true, reason: "" };
  const candidateLanguage = detectArticleCourseLanguage(candidateArticle);
  const reason = `requested=${requestedLanguage}, candidate=${candidateLanguage || "unknown"}`;
  return { accepted: false, reason };
}

function filterMismatchedCourseArticles(matches, queryLanguageEntity) {
  if (!queryLanguageEntity) return matches;
  return (matches || []).filter((article) => !isCourseLanguageMismatch(queryLanguageEntity, article));
}

function hasProcessedMessage(messageId) {
  if (!messageId) return false;
  const seenAt = PROCESSED_MESSAGE_IDS.get(messageId);
  if (!seenAt) return false;
  return (Date.now() - seenAt) < MESSAGE_DEDUP_TTL_MS;
}

function markMessageProcessed(messageId) {
  if (!messageId) return;
  PROCESSED_MESSAGE_IDS.set(messageId, Date.now());
  for (const [id, seenAt] of PROCESSED_MESSAGE_IDS.entries()) {
    if ((Date.now() - seenAt) >= MESSAGE_DEDUP_TTL_MS) {
      PROCESSED_MESSAGE_IDS.delete(id);
    }
  }
}

async function localizeNarrowAnswer({ text, language, preserveCompleteness = false, applyStyle = true }) {
  if (!text?.trim()) return "";

  if (!language || language === "en") {
    return applyStyle ? enforceReplyStyle(text, "en") : finalizeCourseMessage(text);
  }

  try {
    const localized = await openai.responses.create({
      model: "gpt-5-mini",
      instructions: preserveCompleteness
        ? "Translate the provided answer into the target language while preserving ALL facts, figures, and lines exactly. " +
          "Do not omit or summarize any item. Keep line breaks and formatting."
        : "Translate the provided answer into the target language while preserving exact facts, figures, and formatting. " +
          "Do not add extra explanations or questions. Keep it concise.",
      input: `Target language: ${language}\n\nText:\n${text}`
    });
    const finalText = localized.output_text || text;
    return applyStyle ? enforceReplyStyle(finalText, language) : finalizeCourseMessage(finalText);
  } catch (error) {
    console.error("Narrow answer localization error:", error?.message || error);
    return applyStyle ? enforceReplyStyle(text, language) : finalizeCourseMessage(text);
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
    language,
    preserveCompleteness: resolvedIntent === "fees"
  });
}

async function saveMessage({
  wa_id,
  contact_name = null,
  direction,
  body,
  message_type = "text",
  original_language = null,
  translated_text = null,
  translated_language = null,
  staff_reply_text = null,
  staff_reply_language = null,
  sent_reply_text = null,
  sent_reply_language = null
}) {
  const payload = {
    wa_id,
    contact_name,
    direction,
    body,
    message_type,
    original_language,
    translated_text,
    translated_language,
    staff_reply_text,
    staff_reply_language,
    sent_reply_text,
    sent_reply_language
  };
  const result = await insertConversationPayload(payload);
  if (!result.ok) {
    console.error("Supabase insert error:", result.error);
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
  caption = null,
  original_language = null,
  translated_text = null,
  translated_language = null,
  staff_reply_text = null,
  staff_reply_language = null,
  sent_reply_text = null,
  sent_reply_language = null
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
    caption,
    original_language,
    translated_text,
    translated_language,
    staff_reply_text,
    staff_reply_language,
    sent_reply_text,
    sent_reply_language
  };

  const result = await insertConversationPayload(payload);
  if (!result.ok) {
    console.error("Supabase insert with metadata error:", result.error);
    await saveMessage({ wa_id, contact_name, direction, body, message_type });
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
  const greetingLanguage = detectGreetingLanguage(text);
  if (greetingLanguage) return greetingLanguage;

  if (/[\u4e00-\u9fff]/.test(value)) return "zh";
  if (/[\u3040-\u30ff]/.test(value)) return "ja";
  if (/[\u0400-\u04ff]/.test(value)) return "ru";

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
  if (/\b(hallo|dank|vertaling|cursus|tolk)\b/.test(value)) return "nl";
  if (/\b(salut|mulțum|curs|traducere|interpret)\b/.test(value)) return "ro";
  if (/\b(czesc|cześć|dziekuje|dziękuję|kurs|tlumaczen|tłumaczen)\b/.test(value)) return "pl";
  if (/\b(hej|tack|kurs|oversatt|översätt)\b/.test(value)) return "sv";
  if (/\b(hej|tak|kurs|oversaett|oversæt)\b/.test(value)) return "da";
  if (/\b(hei|takk|kurs|oversett)\b/.test(value)) return "no";

  return "en";
}

function extractMissingColumnName(error) {
  const message = String(error?.message || "");
  const details = String(error?.details || "");
  const hint = String(error?.hint || "");
  const combined = [message, details, hint].filter(Boolean).join(" | ");
  const patterns = [
    /column ["']?([a-zA-Z0-9_]+)["']? does not exist/i,
    /Could not find the ['"]([a-zA-Z0-9_]+)['"] column of ['"][a-zA-Z0-9_]+['"] in the schema cache/i,
    /["']([a-zA-Z0-9_]+)["']\s+column/i
  ];

  for (const pattern of patterns) {
    const match = combined.match(pattern);
    if (match?.[1]) return match[1];
  }
  return "";
}

function isSchemaCacheMissingColumnError(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "");
  return code === "PGRST204" || /schema cache/i.test(message);
}

async function insertConversationPayload(payload) {
  const safePayload = { ...payload };
  const removedColumns = new Set();
  const direction = String(payload?.direction || "unknown");
  const waId = String(payload?.wa_id || "");
  const messageType = String(payload?.message_type || "text");

  while (true) {
    console.log("[inbound-db] insert attempted", {
      wa_id: waId,
      direction,
      message_type: messageType,
      payload_keys: Object.keys(safePayload)
    });
    const { error } = await supabase.from("conversations").insert([safePayload]);
    if (!error) {
      console.log("[inbound-db] insert success", {
        wa_id: waId,
        direction,
        message_type: messageType,
        removed_columns: Array.from(removedColumns)
      });
      return { ok: true, removedColumns: Array.from(removedColumns) };
    }

    const missingColumn = extractMissingColumnName(error);
    if (!missingColumn || !(missingColumn in safePayload)) {
      if (isSchemaCacheMissingColumnError(error)) {
        console.warn("[inbound-db] schema cache mismatch; retrying core-safe insert", {
          wa_id: waId,
          direction,
          message_type: messageType,
          removed_columns: Array.from(removedColumns),
          error_code: error?.code || null,
          error_message: error?.message || String(error)
        });
        const corePayload = {
          wa_id: payload.wa_id,
          contact_name: payload.contact_name ?? null,
          direction: payload.direction,
          body: payload.body,
          message_type: payload.message_type || "text"
        };
        const { error: coreError } = await supabase.from("conversations").insert([corePayload]);
        if (!coreError) {
          return {
            ok: true,
            removedColumns: Array.from(new Set([...removedColumns, ...Object.keys(payload).filter((key) => !(key in corePayload))])),
            degradedToCorePayload: true
          };
        }
      }
      console.error("[inbound-db] insert failure", {
        wa_id: waId,
        direction,
        message_type: messageType,
        removed_columns: Array.from(removedColumns),
        error_message: error.message || String(error)
      });
      return { ok: false, error, removedColumns: Array.from(removedColumns) };
    }

    removedColumns.add(missingColumn);
    delete safePayload[missingColumn];
  }
}

function shouldTranslateText(text) {
  const value = String(text || "").trim();
  if (!value) return false;
  if (/^\[[^\]]+\]$/.test(value)) return false;
  return true;
}

async function translateTextViaOpenAi({ text, sourceLanguage, targetLanguage, purpose = "translation" }) {
  const safeText = String(text || "").trim();
  if (!safeText) return "";
  if (!OPENAI_API_KEY) return safeText;
  if (sourceLanguage === targetLanguage) return safeText;

  const response = await openai.responses.create({
    model: "gpt-5-mini",
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: "You are a deterministic translation engine for customer support mediation. Preserve meaning, names, numbers, links, and intent."
          }
        ]
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `Task: ${purpose}\nSource language code: ${sourceLanguage}\nTarget language code: ${targetLanguage}\n\nText:\n${safeText}`
          }
        ]
      }
    ]
  });

  return String(response.output_text || "").trim() || safeText;
}

async function detectAndTranslateInboundMessage({ text, workingLanguage = INTERNAL_WORKING_LANGUAGE_DEFAULT }) {
  const originalText = String(text || "").trim();
  const fallbackLanguage = detectMessageLanguage(originalText);

  const baseResult = {
    original_language: fallbackLanguage,
    translated_text: originalText,
    translated_language: workingLanguage
  };

  if (!shouldTranslateText(originalText)) {
    return baseResult;
  }

  const detected = SUPPORTED_LIVE_MODE_LANGUAGES.includes(fallbackLanguage) ? fallbackLanguage : "en";
  let translated = originalText;
  try {
    translated = await translateTextViaOpenAi({
      text: originalText,
      sourceLanguage: detected,
      targetLanguage: workingLanguage,
      purpose: "Translate incoming customer message for internal staff readability."
    });
  } catch (error) {
    console.warn("[inbound-translation] fallback to original text after translation failure", {
      source_language: detected,
      target_language: workingLanguage,
      error_message: error?.message || String(error)
    });
  }

  return {
    original_language: detected,
    translated_text: translated || originalText,
    translated_language: workingLanguage
  };
}

async function getLatestCustomerLanguage(waId) {
  let { data, error } = await supabase
    .from("conversations")
    .select("direction, original_language, body")
    .eq("wa_id", waId)
    .order("created_at", { ascending: false })
    .limit(20);

  const missingColumn = extractMissingColumnName(error);
  if (error && missingColumn === "original_language") {
    console.warn("[language-detection] original_language missing; retrying with body-only query", {
      wa_id: waId,
      error_code: error?.code || null,
      error_message: error?.message || String(error)
    });
    const retry = await supabase
      .from("conversations")
      .select("direction, body")
      .eq("wa_id", waId)
      .order("created_at", { ascending: false })
      .limit(20);
    data = retry.data;
    error = retry.error;
  }

  if (error || !Array.isArray(data)) {
    return "en";
  }

  const inbound = data.find((row) => row.direction === "in");
  const fromStored = String(inbound?.original_language || "").toLowerCase();
  if (SUPPORTED_LIVE_MODE_LANGUAGES.includes(fromStored)) return fromStored;
  return detectMessageLanguage(inbound?.body || "");
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

function normalizeLanguageCode(languageCode) {
  const safeCode = String(languageCode || "").toLowerCase();
  return SUPPORTED_LIVE_MODE_LANGUAGES.includes(safeCode) ? safeCode : "en";
}

function getGreetingMenu(languageCode) {
  const language = normalizeLanguageCode(languageCode);
  return LIVE_MODE_MESSAGES[language]?.greeting_menu || LIVE_MODE_MESSAGES.en.greeting_menu;
}

function getOptionReply(option, languageCode) {
  const language = normalizeLanguageCode(languageCode);
  return LIVE_MODE_MESSAGES[language]?.options?.[option] || LIVE_MODE_MESSAGES.en.options?.[option] || "";
}

function getSafeHandoffMessage(languageCode) {
  const language = normalizeLanguageCode(languageCode);
  return LIVE_MODE_MESSAGES[language]?.safe_handoff || LIVE_MODE_MESSAGES.en.safe_handoff;
}

function getControlledFallbackReply(languageCode) {
  const language = normalizeLanguageCode(languageCode);
  return LIVE_MODE_MESSAGES[language]?.fallback || LIVE_MODE_MESSAGES.en.fallback;
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
  return Boolean(detectGreetingLanguage(text));
}

function detectGreetingLanguage(text) {
  const normalized = normalizeGreetingText(text);
  if (!normalized) return "";

  const words = normalized.split(" ").filter(Boolean);
  for (const [language, phrases] of Object.entries(GREETING_PHRASES)) {
    for (const phrase of phrases) {
      const safePhrase = normalizeForIntent(phrase);
      if (!safePhrase) continue;
      const phrasePattern = safePhrase.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      const exactRegex = new RegExp(`^${phrasePattern}$`, "i");
      const openerRegex = new RegExp(`^${phrasePattern}\\b`, "i");
      if (exactRegex.test(normalized)) return language;
      if (openerRegex.test(normalized) && words.length <= 12) return language;
    }
  }

  return "";
}

function detectGreetingIntent(text) {
  const language = detectGreetingLanguage(text);
  if (!language) return null;
  const normalized = normalizeGreetingText(text);
  const normalizedPhrases = (GREETING_PHRASES[language] || []).map(normalizeForIntent).filter(Boolean);
  const matchedPhrase = normalizedPhrases.find((phrase) => {
    const phrasePattern = phrase.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    return new RegExp(`^${phrasePattern}(\\b|$)`, "i").test(normalized);
  }) || null;
  return { language, phrase: matchedPhrase };
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
  if (greetingLanguage && SUPPORTED_LIVE_MODE_LANGUAGES.includes(greetingLanguage)) {
    CONVERSATION_LANGUAGE_BY_CONTACT.set(waId, greetingLanguage);
    return greetingLanguage;
  }
  const stored = CONVERSATION_LANGUAGE_BY_CONTACT.get(waId);
  if (stored) return stored;

  const normalized = normalizeForIntent(text);
  const detected = detectMessageLanguage(text);
  const safeDetected = SUPPORTED_LIVE_MODE_LANGUAGES.includes(detected) ? detected : "en";
  if (/^[1-4]$/.test(normalized) && stored) {
    return stored;
  }
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
    console.log("[inbound-webhook] received", {
      object: body?.object || null,
      has_entry: Boolean(body?.entry?.length)
    });

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
    const inboundMessageId = message.id || null;
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
    console.log("[inbound-webhook] normalized message", {
      wa_id: from || null,
      message_id: inboundMessageId,
      message_type: message?.type || "text",
      has_attachment: hasAttachment,
      normalized_text_preview: String(inboundBody || "").slice(0, 120)
    });

    if (!inboundBody) {
      return res.sendStatus(200);
    }
    if (hasProcessedMessage(inboundMessageId)) {
      return res.sendStatus(200);
    }
    markMessageProcessed(inboundMessageId);

    console.log("Message received from:", from, "| text:", inboundBody);
    const inboundMediation = await detectAndTranslateInboundMessage({
      text: inboundBody,
      workingLanguage: INTERNAL_WORKING_LANGUAGE_DEFAULT
    });

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
      caption: attachment?.caption || null,
      original_language: inboundMediation.original_language,
      translated_text: inboundMediation.translated_text,
      translated_language: inboundMediation.translated_language
    });

    if (hasAttachment && !text) {
      return res.sendStatus(200);
    }

    let reply = "";
    let suppressAutoAck = false;
    let allowIntermediateAck = false;

    const greetingIntent = detectGreetingIntent(text);
    const detectedLanguage = resolveConversationLanguage({
      waId: from,
      text,
      greetingLanguage: greetingIntent?.language
    });
    const menuSelection = detectMenuSelection(text);
    const normalizedInbound = normalizeForIntent(text);
    const hasStoredLanguage = CONVERSATION_LANGUAGE_BY_CONTACT.has(from);
    const fallbackEligible = hasStoredLanguage
      && !menuSelection
      && !greetingIntent
      && normalizedInbound
      && normalizedInbound.split(/\s+/).filter(Boolean).length <= 2;

    if (greetingIntent || isGreetingMessage(text)) {
      const incomingGreetingText = text || "";
      const normalizedGreetingText = normalizeGreetingText(incomingGreetingText);
      const greetingLanguageCode = greetingIntent?.language || detectGreetingLanguage(incomingGreetingText) || detectedLanguage;
      reply = getGreetingMenu(greetingLanguageCode);
      const renderedMenuLanguageCode = normalizeLanguageCode(greetingLanguageCode);
      console.log("[greeting-debug] incoming greeting text:", incomingGreetingText);
      console.log("[greeting-debug] normalized greeting text:", normalizedGreetingText);
      console.log("[greeting-debug] detected language code:", greetingLanguageCode || "none");
      console.log("[greeting-debug] rendered menu language code:", renderedMenuLanguageCode);
      suppressAutoAck = true;
    } else if (menuSelection) {
      reply = getOptionReply(menuSelection, detectedLanguage);
      suppressAutoAck = true;
    } else if (!isAutonomousReplyAllowed() && fallbackEligible) {
      reply = getControlledFallbackReply(detectedLanguage);
      suppressAutoAck = true;
    } else if (!isAutonomousReplyAllowed()) {
      reply = getSafeHandoffMessage(detectedLanguage);
      suppressAutoAck = true;
    } else {
      const narrowIntent = detectNarrowIntent(text);
      const specificIntent = detectSpecificIntent(text);
      const resolvedIntent = resolveNarrowIntent(narrowIntent || specificIntent);
      const vagueMessage = isVagueCustomerMessage(text);
      const userState = getCustomerState(from);
      const broadMessage = vagueMessage && !resolvedIntent;
      const currentCourseLanguage = detectRequestedCourseLanguage(text, userState);
      const explicitCourseLanguage = detectCourseLanguageMention(text);
      const courseTopicActive = userState.topicType === "language_course" || Boolean(explicitCourseLanguage);
      const courseQueryActive = isLanguageCourseQuery(text, userState);
      console.log("[course-debug] detected requested course language:", currentCourseLanguage || "none");
      const retrievalResult = await retrieveInternalKnowledge(text, {
        maxMatches: 10,
        preferredCourseLanguage: currentCourseLanguage,
        courseTopicActive,
        contextMemory: {
          entity: userState.topicEntity || null
        }
      });
      const kbMatches = filterMismatchedCourseArticles(
        retrievalResult.matches
        .filter(match => match.source === "kb_articles")
        .map(match => match.raw_reference)
        .filter(Boolean),
        currentCourseLanguage
      );

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
          allowIntermediateAck = true;
        } else if (courseQueryActive && !resolvedIntent) {
          const courseMatchFromRetrieval = currentCourseLanguage
            ? retrievalResult.matches.find((match) => {
              if (match.source !== "kb_articles") return false;
              return !isCourseLanguageMismatch(currentCourseLanguage, match.raw_reference);
            })?.raw_reference
            : retrievalResult.matches.find((match) => match.source === "kb_articles")?.raw_reference;
          const courseArticle = courseMatchFromRetrieval
            || (currentCourseLanguage ? await findCourseArticleByLanguage(currentCourseLanguage) : null)
            || kbMatches[0]
            || null;

          if (courseArticle) {
            const summary = formatCourseSummary(courseArticle, detectedLanguage);
            reply = summary || getLocalizedClarifyingQuestion(detectedLanguage);
          } else {
            reply = getLocalizedClarifyingQuestion(detectedLanguage);
          }
          setCustomerState(from, {
            clarifyingAsked: false,
            preferredCourseLanguage: currentCourseLanguage,
            topicType: "language_course",
            topicLanguage: currentCourseLanguage || userState.topicLanguage || null,
            topicEntity: retrievalResult.entity || userState.topicEntity || null
          });
        } else if (resolvedIntent && retrievalResult.matches.length) {
          const extractedSection = await extractNarrowAnswerFromMatches({
            matches: retrievalResult.matches,
            intent: resolvedIntent
          });
          if (extractedSection) {
            reply = await localizeNarrowAnswer({
              text: extractedSection,
              language: detectedLanguage,
              preserveCompleteness: resolvedIntent === "fees",
              applyStyle: false
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
          setCustomerState(from, {
            clarifyingAsked: false,
            preferredCourseLanguage: currentCourseLanguage,
            topicType: currentCourseLanguage ? "language_course" : null,
            topicLanguage: currentCourseLanguage
          });
        } else if (broadMessage && kbMatches.length && !userState.clarifyingAsked) {
          reply = getLocalizedClarifyingQuestion(detectedLanguage);
          setCustomerState(from, {
            clarifyingAsked: true,
            preferredCourseLanguage: currentCourseLanguage,
            topicType: currentCourseLanguage ? "language_course" : userState.topicType,
            topicLanguage: currentCourseLanguage || userState.topicLanguage
          });
        } else if (broadMessage && !kbMatches.length) {
          reply = getLocalizedClarifyingQuestion(detectedLanguage);
          setCustomerState(from, {
            clarifyingAsked: true,
            preferredCourseLanguage: currentCourseLanguage,
            topicType: currentCourseLanguage ? "language_course" : userState.topicType,
            topicLanguage: currentCourseLanguage || userState.topicLanguage
          });
        } else if (retrievalResult.matches.length && !vagueMessage) {
          const safeMatches = currentCourseLanguage
            ? retrievalResult.matches.filter((match) => {
              if (match.source !== "kb_articles") return true;
              return !isCourseLanguageMismatch(currentCourseLanguage, match.raw_reference);
            })
            : retrievalResult.matches;
          if (!reply) {
            reply = await buildReplyFromUnifiedRetrieval({
              retrievalResult: { ...retrievalResult, matches: safeMatches },
              language: detectedLanguage,
              specificIntent: resolvedIntent
            });
          }
          if (!reply) {
            reply = await generateAIAnswerMessage({
              customerMessage: text,
              kbMatches,
              retrievalResult,
              specificIntent: resolvedIntent
            });
          }
          setCustomerState(from, {
            clarifyingAsked: false,
            preferredCourseLanguage: currentCourseLanguage,
            topicType: (currentCourseLanguage || courseQueryActive) ? "language_course" : null,
            topicLanguage: currentCourseLanguage || userState.topicLanguage || null,
            topicEntity: retrievalResult.entity || userState.topicEntity || null
          });
          console.log("[course-debug] course memory context set:", JSON.stringify({
            topicType: (currentCourseLanguage || courseQueryActive) ? "language_course" : null,
            topicLanguage: currentCourseLanguage || userState.topicLanguage || null
          }));
        } else {
          reply = await generateAIAnswerMessage({
            customerMessage: text,
            kbMatches,
            retrievalResult,
            specificIntent: resolvedIntent
          });
          if (!broadMessage) {
            setCustomerState(from, {
              clarifyingAsked: false,
              preferredCourseLanguage: currentCourseLanguage,
              topicType: (currentCourseLanguage || courseQueryActive) ? "language_course" : null,
              topicLanguage: currentCourseLanguage || userState.topicLanguage || null
            });
            console.log("[course-debug] course memory context set:", JSON.stringify({
              topicType: (currentCourseLanguage || courseQueryActive) ? "language_course" : null,
              topicLanguage: currentCourseLanguage || userState.topicLanguage || null
            }));
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
  if (reply.length > 180 && !suppressAutoAck && allowIntermediateAck) {
    const ack = getLocalizedAck(detectedLanguage);

    await sendWhatsAppText(from, ack, 1500);

    await saveMessage({
      wa_id: from,
      contact_name: contactName,
      direction: "out",
      body: ack,
      message_type: "text"
    });

    await sendWhatsAppText(from, reply, 0);

    await saveMessage({
      wa_id: from,
      contact_name: contactName,
      direction: "out",
      body: reply,
      message_type: "text"
    });
  } else {
    await sendWhatsAppText(from, reply, 0);

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

app.get("/api/system/mode", (req, res) => {
  return res.json({
    ok: true,
    mode: runtimeSystemState.mode,
    label: runtimeSystemState.mode === "test" ? "TEST MODE" : "LIVE MODE",
    can_change: canChangeMode(req),
    capabilities: getModeCapabilities(),
    updated_at: runtimeSystemState.updatedAt
  });
});

app.post("/api/system/mode", async (req, res) => {
  try {
    if (!canChangeMode(req)) {
      return res.status(403).json({ error: "Only trusted internal users can change mode" });
    }
    const nextMode = String(req.body?.mode || "").toLowerCase();
    if (nextMode !== "live" && nextMode !== "test") {
      return res.status(400).json({ error: "mode must be 'live' or 'test'" });
    }

    runtimeSystemState.mode = nextMode;
    runtimeSystemState.updatedAt = new Date().toISOString();
    await persistSystemMode(nextMode);

    return res.json({
      ok: true,
      mode: runtimeSystemState.mode,
      label: runtimeSystemState.mode === "test" ? "TEST MODE" : "LIVE MODE",
      can_change: canChangeMode(req),
      capabilities: getModeCapabilities(),
      updated_at: runtimeSystemState.updatedAt
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/conversations", async (req, res) => {
  try {
    let data;
    let error;

    const activeOnlyResponse = await supabase
      .from("conversations")
      .select("wa_id, contact_name, body, created_at, direction, label")
      .or("is_archived.is.false,is_archived.is.null")
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
    console.log("[inbox-api] /api/conversations rows returned", Array.isArray(data) ? data.length : 0);

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
    console.log("[inbox-api] /api/conversations/:wa_id rows returned", {
      wa_id,
      count: Array.isArray(data) ? data.length : 0
    });

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

    const staffReplyText = String(body || "").trim();
    const staffReplyLanguage = INTERNAL_WORKING_LANGUAGE_DEFAULT;
    const customerLanguage = await getLatestCustomerLanguage(wa_id);
    const sentReplyText = shouldTranslateText(staffReplyText)
      ? await translateTextViaOpenAi({
        text: staffReplyText,
        sourceLanguage: staffReplyLanguage,
        targetLanguage: customerLanguage,
        purpose: "Translate internal staff reply for customer delivery."
      })
      : staffReplyText;

    const sendResult = await sendWhatsAppText(wa_id, sentReplyText);

    await saveMessage({
      wa_id,
      direction: "out",
      body: staffReplyText,
      message_type: "text",
      staff_reply_text: staffReplyText,
      staff_reply_language: staffReplyLanguage,
      sent_reply_text: sentReplyText,
      sent_reply_language: customerLanguage
    });

    return res.json({
      ok: true,
      sendResult,
      mediation: {
        staff_reply_text: staffReplyText,
        staff_reply_language: staffReplyLanguage,
        sent_reply_text: sentReplyText,
        sent_reply_language: customerLanguage
      }
    });
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

    const trimmedCaption = typeof caption === "string" ? caption.trim() : "";
    const staffReplyLanguage = INTERNAL_WORKING_LANGUAGE_DEFAULT;
    const customerLanguage = await getLatestCustomerLanguage(wa_id);
    const sentCaption = trimmedCaption
      ? await translateTextViaOpenAi({
        text: trimmedCaption,
        sourceLanguage: staffReplyLanguage,
        targetLanguage: customerLanguage,
        purpose: "Translate internal staff attachment caption for customer delivery."
      })
      : "";

    const sendResult = await sendWhatsAppMedia({
      to: wa_id,
      mediaType,
      mediaId,
      caption: sentCaption
    });

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
      caption: sentCaption || null,
      staff_reply_text: trimmedCaption || null,
      staff_reply_language: trimmedCaption ? staffReplyLanguage : null,
      sent_reply_text: sentCaption || null,
      sent_reply_language: sentCaption ? customerLanguage : null
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
    if (!requireAiExperimentMode(res)) return;
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
    if (!requireAiExperimentMode(res)) return;
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


app.post("/api/provider-capture/upload", requireAuth, providerCaptureUpload.array("documents", 10), async (req, res) => {
  try {
    const files = (req.files || []).map(file => ({
      filename: file.filename,
      originalName: file.originalname,
      mimeType: file.mimetype,
      fileType: getProviderCaptureFileType(file.originalname, file.mimetype),
      size: file.size,
      url: `/uploads/provider-capture/${file.filename}`
    }));

    return res.json({ ok: true, files });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/provider-capture/generate", requireAuth, async (req, res) => {
  try {
    const {
      raw_text,
      manual_notes,
      source_channel,
      source_reference,
      attachments
    } = req.body || {};

    if ((!raw_text || !String(raw_text).trim()) && (!manual_notes || !String(manual_notes).trim()) && (!Array.isArray(attachments) || !attachments.length)) {
      return res.status(400).json({ error: "Provide raw text, notes, or attachments for extraction." });
    }

    const attachmentLines = [];
    const extractionReport = [];
    const extractedBlocks = [];
    for (const item of (attachments || []).slice(0, 10)) {
      const fileName = path.basename(String(item.filename || ""));
      if (!fileName) continue;
      const safePath = path.join(PROVIDER_CAPTURE_STORAGE_DIR, fileName);
      if (!safePath.startsWith(PROVIDER_CAPTURE_STORAGE_DIR)) continue;
      const exists = fsSync.existsSync(safePath);
      if (!exists) {
        extractionReport.push({
          filename: item.originalName || fileName,
          mimeType: item.mimeType || "unknown",
          status: "failed",
          warning: "File was not found on server."
        });
        continue;
      }

      const mimeType = String(item.mimeType || "").toLowerCase();
      const extracted = await extractProviderAttachmentText({
        safePath,
        mimeType,
        originalName: item.originalName || fileName
      });
      const extractedText = String(extracted.text || "").slice(0, 4000);

      attachmentLines.push(`- File: ${item.originalName || fileName} (${mimeType || "unknown mime"})`);
      if (extractedText) {
        attachmentLines.push(`  Extracted text snippet: ${extractedText.replace(/\s+/g, " ").trim()}`);
        extractedBlocks.push(`[${item.originalName || fileName}]\n${extracted.text}`);
      } else {
        attachmentLines.push("  Extracted text snippet: [No readable text extracted.]");
      }

      extractionReport.push({
        filename: item.originalName || fileName,
        mimeType: mimeType || "unknown",
        fileType: extracted.fileType,
        status: extracted.status,
        warning: extracted.warning || ""
      });
      if (extracted.warning) {
        console.warn(`[provider-capture] extraction warning for ${item.originalName || fileName}: ${extracted.warning}`);
      }
    }
    const combinedExtractedText = extractedBlocks.join("\n\n").trim();
    const hasAttachmentFailures = extractionReport.some(file => file.status !== "success");
    const hasAnyReadableText = Boolean(
      String(raw_text || "").trim()
      || String(manual_notes || "").trim()
      || combinedExtractedText
    );
    if (!hasAnyReadableText) {
      return res.status(400).json({
        error: "No readable text could be extracted from one or more files. Please paste the text manually or upload a clearer file.",
        extraction_report: extractionReport
      });
    }

    const prompt = `
You extract and structure provider intake data for LSA GLOBAL.

Rules:
1. Use raw text, manual notes, and any attachment snippets together.
2. Keep output factual and conservative; do not invent missing facts.
3. If unknown, return an empty string for that field.
4. Standardize list-like fields as comma-separated strings.
5. availability_status must be one of: available, busy, unknown.
6. provider_type should be one of: Freelancer, Agency, Institution, Teacher Provider, Interpreter, Voice-over Provider, Dubbing Provider, Language Partner. If uncertain, use Freelancer.
7. Return valid JSON only.

Return JSON with exactly these keys:
provider_type
full_name
organization_name
contact_person
email
phone
whatsapp
country
city
native_language
working_languages
language_pairs
services
specializations
years_experience
availability_status
notes
source_channel
source_reference
`;

    const input = `
Raw provider input:
${raw_text || ""}

Manual notes:
${manual_notes || ""}

Extracted attachment text:
${combinedExtractedText || "[No readable text extracted from attachments]"}

Source channel:
${source_channel || "manual"}

Source reference:
${source_reference || ""}

Attachments summary:
${attachmentLines.join("\n") || "No attachments."}
`;

    const response = await openai.responses.create({
      model: "gpt-5-mini",
      instructions: prompt,
      input
    });

    const outputText = response.output_text || "{}";
    let parsed;
    try {
      parsed = JSON.parse(outputText);
    } catch (_error) {
      return res.status(500).json({ error: "AI returned invalid JSON", raw_output: outputText });
    }

    return res.json({
      ok: true,
      result: parsed,
      summary: hasAttachmentFailures
        ? "Structured draft generated with warnings. Review extraction details before sending to Official Providers."
        : "Structured draft generated. Review and edit before sending to Official Providers.",
      extraction_report: extractionReport
    });
  } catch (error) {
    console.error("Provider capture generate error:", error.response?.data || error.message || error);
    return res.status(500).json({ error: "Provider generation failed" });
  }
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

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeEmail(value) {
  return normalizeText(value);
}

function normalizePhone(value) {
  return String(value || "").replace(/[^\d+]/g, "");
}

function normalizeToken(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, " ").trim();
}

function tokenizeList(value) {
  return normalizeToken(value)
    .split(/[\n,;|/]+/g)
    .map(item => item.trim())
    .filter(Boolean);
}

function tokenizeWords(value) {
  return normalizeToken(value)
    .split(/\s+/g)
    .map(item => item.trim())
    .filter(Boolean);
}

function jaccardSimilarity(aTokens, bTokens) {
  if (!aTokens.length || !bTokens.length) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let intersection = 0;
  for (const token of aSet) {
    if (bSet.has(token)) intersection += 1;
  }
  const union = new Set([...aSet, ...bSet]).size;
  return union ? intersection / union : 0;
}

function getOverlap(a, b) {
  const aTokens = tokenizeList(a);
  const bTokens = tokenizeList(b);
  if (!aTokens.length || !bTokens.length) return [];
  const bSet = new Set(bTokens);
  return [...new Set(aTokens.filter(token => bSet.has(token)))];
}

function getConfidenceLabel(score) {
  if (score >= 80) return "very_high";
  if (score >= 60) return "high";
  if (score >= 40) return "medium";
  return "low";
}

function scoreProviderDuplicate(draft, existing) {
  const reasons = [];
  const matchedFields = new Set();
  let score = 0;

  const draftEmail = normalizeEmail(draft.email);
  const existingEmail = normalizeEmail(existing.email);
  if (draftEmail && existingEmail && draftEmail === existingEmail) {
    score += 50;
    matchedFields.add("email");
    reasons.push("Exact email match");
  }

  const draftPhone = normalizePhone(draft.phone);
  const existingPhone = normalizePhone(existing.phone);
  if (draftPhone && existingPhone && draftPhone === existingPhone) {
    score += 45;
    matchedFields.add("phone");
    reasons.push("Exact phone match");
  }

  const draftWhatsapp = normalizePhone(draft.whatsapp);
  const existingWhatsapp = normalizePhone(existing.whatsapp);
  if (draftWhatsapp && existingWhatsapp && draftWhatsapp === existingWhatsapp) {
    score += 45;
    matchedFields.add("whatsapp");
    reasons.push("Exact WhatsApp match");
  }

  const draftFullName = normalizeToken(draft.full_name);
  const existingFullName = normalizeToken(existing.full_name);
  if (draftFullName && existingFullName) {
    if (draftFullName === existingFullName) {
      score += 35;
      matchedFields.add("full_name");
      reasons.push("Exact full name match");
    } else {
      const similarity = jaccardSimilarity(tokenizeWords(draftFullName), tokenizeWords(existingFullName));
      if (similarity >= 0.75) {
        score += 20;
        matchedFields.add("full_name");
        reasons.push("Highly similar full name");
      }
    }
  }

  const draftOrg = normalizeToken(draft.organization_name);
  const existingOrg = normalizeToken(existing.organization_name);
  if (draftOrg && existingOrg) {
    if (draftOrg === existingOrg) {
      score += 30;
      matchedFields.add("organization_name");
      reasons.push("Exact organization match");
    } else {
      const similarity = jaccardSimilarity(tokenizeWords(draftOrg), tokenizeWords(existingOrg));
      if (similarity >= 0.7) {
        score += 18;
        matchedFields.add("organization_name");
        reasons.push("Similar organization name");
      }
    }
  }

  const draftContact = normalizeToken(draft.contact_person);
  const existingContact = normalizeToken(existing.contact_person);
  if (draftContact && existingContact && draftContact === existingContact) {
    score += 15;
    matchedFields.add("contact_person");
    reasons.push("Exact contact person match");
  }

  const countryMatch = normalizeToken(draft.country) && normalizeToken(draft.country) === normalizeToken(existing.country);
  const cityMatch = normalizeToken(draft.city) && normalizeToken(draft.city) === normalizeToken(existing.city);
  if (countryMatch) {
    score += 8;
    matchedFields.add("country");
    reasons.push("Same country");
  }
  if (cityMatch) {
    score += 7;
    matchedFields.add("city");
    reasons.push("Same city");
  }

  const draftNameTokens = tokenizeWords(draftFullName || draftOrg || "");
  const existingNameTokens = tokenizeWords(existingFullName || existingOrg || "");
  const partialNameSimilarity = jaccardSimilarity(draftNameTokens, existingNameTokens);
  if (partialNameSimilarity >= 0.5 && (countryMatch || cityMatch)) {
    score += 12;
    matchedFields.add("name_location");
    reasons.push("Partial name similarity with matching location");
  }

  const languageOverlap = getOverlap(draft.working_languages, existing.working_languages);
  if (languageOverlap.length) {
    score += Math.min(6, languageOverlap.length * 2);
    matchedFields.add("working_languages");
    reasons.push(`Shared working languages: ${languageOverlap.join(", ")}`);
  }

  const pairOverlap = getOverlap(draft.language_pairs, existing.language_pairs);
  if (pairOverlap.length) {
    score += Math.min(8, pairOverlap.length * 2);
    matchedFields.add("language_pairs");
    reasons.push(`Shared language pairs: ${pairOverlap.join(", ")}`);
  }

  const servicesOverlap = getOverlap(draft.services, existing.services);
  if (servicesOverlap.length) {
    score += Math.min(6, servicesOverlap.length * 2);
    matchedFields.add("services");
    reasons.push(`Shared services: ${servicesOverlap.join(", ")}`);
  }

  const specOverlap = getOverlap(draft.specializations, existing.specializations);
  if (specOverlap.length) {
    score += Math.min(5, specOverlap.length * 2);
    matchedFields.add("specializations");
    reasons.push(`Shared specializations: ${specOverlap.join(", ")}`);
  }

  return {
    score,
    reasons,
    matchedFields: [...matchedFields]
  };
}

// ===== PROVIDER API: DUPLICATE CHECK =====
app.post("/api/providers/duplicate-check", async (req, res) => {
  try {
    const draft = req.body?.draft || req.body || {};
    const excludeId = req.body?.exclude_id || null;

    const keyFields = [
      draft.full_name,
      draft.organization_name,
      draft.contact_person,
      draft.email,
      draft.phone,
      draft.whatsapp,
      draft.country,
      draft.city
    ].map(value => String(value || "").trim()).filter(Boolean);

    if (!keyFields.length) {
      return res.json({
        ok: true,
        duplicates: [],
        summary: "No candidate data provided for duplicate detection."
      });
    }

    const { data, error } = await supabase
      .from("providers")
      .select("id, full_name, organization_name, contact_person, email, phone, whatsapp, country, city, working_languages, language_pairs, services, specializations, provider_type, status")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      return res.status(500).json({ error });
    }

    const ranked = (data || [])
      .filter(item => !excludeId || String(item.id) !== String(excludeId))
      .map(item => {
        const result = scoreProviderDuplicate(draft, item);
        return {
          provider_id: item.id,
          provider_name: item.full_name || "Unnamed Provider",
          organization_name: item.organization_name || "",
          contact: {
            email: item.email || "",
            phone: item.phone || "",
            whatsapp: item.whatsapp || ""
          },
          country: item.country || "",
          city: item.city || "",
          matched_fields: result.matchedFields,
          reasons: result.reasons,
          confidence_score: result.score,
          confidence_level: getConfidenceLabel(result.score)
        };
      })
      .filter(item => item.confidence_score >= 35 || item.matched_fields.includes("email") || item.matched_fields.includes("phone") || item.matched_fields.includes("whatsapp"))
      .sort((a, b) => b.confidence_score - a.confidence_score)
      .slice(0, 8);

    return res.json({
      ok: true,
      duplicates: ranked,
      summary: ranked.length
        ? `Found ${ranked.length} possible duplicate provider(s).`
        : "No likely duplicates found."
    });
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
