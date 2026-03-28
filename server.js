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

const KB_STOP_WORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "de", "des", "du", "en", "et",
  "for", "i", "in", "is", "je", "la", "le", "les", "los", "me", "my", "of", "on",
  "or", "por", "que", "the", "to", "un", "une", "vos", "votre", "want", "we", "with",
  "please", "pls", "bonjour", "hello", "hi", "salut", "hola", "ciao", "hallo", "ola", "olá", "obrigado"
]);

const CROSS_LANGUAGE_TERM_MAP = {
  course: ["courses", "cours", "curso", "cursos", "corso", "corsi", "kurs", "kurse", "class", "classes"],
  italian: ["italien", "italiana", "italiano", "italian"],
  french: ["francais", "français", "francese", "frances", "french"],
  spanish: ["espagnol", "español", "spagnolo", "spanish"],
  portuguese: ["portugais", "portugués", "portugues", "portoghese", "portuguese"],
  english: ["anglais", "ingles", "inglés", "inglese", "english"],
  translation: ["traduction", "traduccion", "traduzione", "ubersetzung", "translation", "translator"],
  interpreting: ["interpretation", "interpreting", "interpretariat", "interpretazione", "interpretacion"],
  exam: ["examen", "exam", "certification", "test", "deadline"],
  schedule: ["horaire", "horario", "orario", "schedule", "timetable", "time"],
  price: ["prix", "precio", "prezzo", "price", "tarif", "tariffa", "fee", "fees", "cost", "tuition"],
  duration: ["durée", "duracion", "durata", "duration", "length"],
  level: ["niveau", "nivel", "livello", "level"],
  registration: ["inscription", "registro", "iscrizione", "registration", "enrollment"]
};

const CROSS_LANGUAGE_CANONICAL_INDEX = Object.entries(CROSS_LANGUAGE_TERM_MAP).reduce((acc, [canonical, variants]) => {
  for (const variant of [canonical, ...variants]) {
    acc[variant] = canonical;
  }
  return acc;
}, {});

const SPECIFIC_INTENT_PATTERNS = {
  fee: /\b(fee|fees|price|prix|precio|prezzo|cost|tarif|tariffa|tuition)\b/i,
  duration: /\b(duration|durée|duracion|durata|length|long)\b/i,
  schedule: /\b(schedule|horaire|horario|orario|timetable|time|date)\b/i,
  exam: /\b(exam|examen|test|certification)\b/i,
  registration: /\b(register|registration|enroll|enrollment|inscription|iscrizione|registro)\b/i,
  course: /\b(course|courses|cours|curso|cursos|corso|corsi|class|classes|program)\b/i
};

const NARROW_INTENT_KEYWORDS = {
  fees: ["fee", "fees", "price", "prices", "pricing", "cost", "costs", "tariff", "tariffs", "prix", "tarifs", "coût", "cout", "frais"],
  duration: ["duration", "durée", "duree", "length", "how long"],
  schedule: ["schedule", "schedules", "horaires", "timetable", "hours", "time"],
  levels: ["level", "levels", "niveau", "niveaux", "a1", "a2", "b1", "b2", "c1", "c2"],
  location: ["location", "lieu", "centre", "campus", "city", "douala", "london", "newark"],
  format: ["format", "online", "onsite", "in-person", "presentiel", "présentiel", "distance"],
  registration: ["registration", "inscription", "enroll", "enrol", "enrollment", "admission", "apply"],
  certification: ["certificate", "certification", "attestation", "testimonial", "proof", "verification"]
};

const MENU_KEYWORDS = {
  translation: ["1", "translation", "traduction", "traduccion", "traduzione", "übersetzung", "ubersetzung", "traducao", "tradução"],
  courses: ["2", "course", "courses", "cours", "curso", "corsi", "kurse", "formacion", "formação", "formation"],
  interpreting: ["3", "interpreting", "interpretation", "interpretariat", "interpretazione", "interpretacion", "interpretação"],
  advisor: ["4", "advisor", "adviser", "human", "agent", "conseiller", "asesor", "berater", "consulente"]
};

const SENSITIVE_ESCALATION_PATTERNS = /\b(discount|special offer|negotiat|exception|urgent complaint|legal issue|refund|remboursement|rembolso|rimborso|reembolso)\b/i;

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

function extractRelevantKbSection(answerText, intent) {
  if (!answerText || !intent || !NARROW_INTENT_KEYWORDS[intent]) return null;

  const keywords = NARROW_INTENT_KEYWORDS[intent].map(normalizeForIntent);
  const normalizedAnswer = normalizeForIntent(answerText);
  const hasIntentSignal = keywords.some((keyword) => keyword && normalizedAnswer.includes(keyword));
  if (!hasIntentSignal) return null;

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

  if (!scored.length) return null;
  return scored.join("\n");
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
  const rawMessage = (userMessage || "").trim();
  if (!rawMessage) return [];

  const normalizeForTerms = value =>
    (value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, " ")
      .replace(/[’'`]/g, " ")
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .map(part => part.trim())
      .filter(Boolean);

  const dedupe = items => Array.from(new Set(items.filter(Boolean)));

  let englishQuery = rawMessage;
  const queryVariants = [rawMessage];
  try {
    const translation = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      messages: [
        {
          role: "system",
          content:
            "Rewrite user requests as a concise KB retrieval query in English. " +
            "Preserve product/service names and proper nouns. Return plain text only."
        },
        { role: "user", content: rawMessage }
      ],
      max_tokens: 60
    });

    const translated = translation.choices?.[0]?.message?.content?.trim();
    if (translated) {
      englishQuery = translated;
      queryVariants.push(translated);
    }
  } catch (translationError) {
    console.error("KB query translation error:", translationError?.message || translationError);
  }

  try {
    const multilingualExpansion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Expand the user query for multilingual retrieval. " +
            "Return JSON only with shape {\"queries\":[...]} containing short search queries in English, French, Spanish, Italian, Portuguese, and German."
        },
        { role: "user", content: rawMessage }
      ],
      max_tokens: 180
    });

    const parsed = JSON.parse(multilingualExpansion.choices?.[0]?.message?.content || "{}");
    const expansions = Array.isArray(parsed?.queries) ? parsed.queries : [];
    for (const expansion of expansions) {
      if (typeof expansion === "string" && expansion.trim()) {
        queryVariants.push(expansion.trim());
      }
    }
  } catch (expansionError) {
    console.error("KB query expansion error:", expansionError?.message || expansionError);
  }

  const originalTerms = normalizeForTerms(rawMessage).filter(term => !KB_STOP_WORDS.has(term));
  const englishTerms = normalizeForTerms(englishQuery).filter(term => !KB_STOP_WORDS.has(term));
  const expandedTerms = queryVariants.flatMap(value => normalizeForTerms(value));
  const crossLanguageTerms = [];
  for (const term of dedupe([...originalTerms, ...englishTerms, ...expandedTerms])) {
    const canonical = CROSS_LANGUAGE_CANONICAL_INDEX[term] || term;
    const variants = CROSS_LANGUAGE_TERM_MAP[canonical];
    if (Array.isArray(variants)) {
      crossLanguageTerms.push(canonical, ...variants);
    }
  }
  const terms = dedupe(
    [...expandedTerms, ...englishTerms, ...originalTerms, ...crossLanguageTerms]
      .filter(term => !KB_STOP_WORDS.has(term))
  ).slice(0, 24);

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
    .limit(120);

  if (terms.length > 0) {
    const escapedTerms = terms.map(term => term.replace(/[%,]/g, ""));
    const orParts = [];
    for (const term of escapedTerms) {
      if (!term) continue;
      orParts.push(`title.ilike.%${term}%`);
      orParts.push(`question.ilike.%${term}%`);
      orParts.push(`answer.ilike.%${term}%`);
      orParts.push(`keywords.ilike.%${term}%`);
      orParts.push(`kb_categories.name.ilike.%${term}%`);
    }
    if (orParts.length) {
      query = query.or(orParts.join(","));
    }
  }

  const { data, error } = await query;

  if (error) {
    console.error("KB search error:", error);
    return [];
  }

  const records = data || [];
  if (!records.length) return [];

  const scoreArticle = article => {
    const title = (article.title || "").toLowerCase();
    const question = (article.question || "").toLowerCase();
    const answer = (article.answer || "").toLowerCase();
    const keywords = (article.keywords || "").toLowerCase();
    const category = (article.kb_categories?.name || "").toLowerCase();

    let score = 0;
    const specificIntent = detectSpecificIntent(rawMessage);
    for (const term of terms) {
      if (!term || term.length < 2) continue;
      if (title.includes(term)) score += 14;
      if (question.includes(term)) score += 10;
      if (keywords.includes(term)) score += 8;
      if (category.includes(term)) score += 7;
      if (answer.includes(term)) score += 4;
    }

    const uniqueVariants = dedupe(queryVariants.map(q => (q || "").toLowerCase().trim()));
    for (const variant of uniqueVariants) {
      if (!variant || variant.length < 5) continue;
      if (title.includes(variant)) score += 9;
      if (question.includes(variant)) score += 7;
      if (keywords.includes(variant)) score += 6;
      if (answer.includes(variant)) score += 4;
    }

    const messageLanguage = detectMessageLanguage(rawMessage);
    const articleLanguage = (article.language || "").toLowerCase();
    if (messageLanguage && articleLanguage && messageLanguage === articleLanguage) {
      score += 2;
    }

    if (specificIntent) {
      if (title.includes(specificIntent)) score += 8;
      if (question.includes(specificIntent)) score += 6;
      if (keywords.includes(specificIntent)) score += 6;
    }

    const phrase = normalizeForTerms(rawMessage).slice(0, 5).join(" ");
    if (phrase.length > 8) {
      if (question.includes(phrase)) score += 8;
      if (title.includes(phrase)) score += 8;
    }

    return score;
  };

  const ranked = records
    .map(article => ({ ...article, relevance_score: scoreArticle(article) }))
    .sort((a, b) => b.relevance_score - a.relevance_score);

  const bestScore = ranked[0]?.relevance_score || 0;
  const minScore = bestScore >= 18 ? 10 : 12;

  return ranked
    .filter(article => article.relevance_score >= minScore)
    .slice(0, 6)
    .map(({ relevance_score, ...article }) => article);
}

function detectMessageLanguage(text) {
  const value = (text || "").toLowerCase();
  if (!value.trim()) return "en";

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
      return "Bien sûr. Que souhaitez-vous savoir exactement sur LSA GLOBAL (tarif, durée, horaires, inscription, ou autre) ?";
    case "es":
      return "Claro. ¿Qué desea saber exactamente sobre LSA GLOBAL (precio, duración, horario, inscripción u otro punto)?";
    case "de":
      return "Gern. Was genau möchten Sie über LSA GLOBAL wissen (Preis, Dauer, Zeitplan, Anmeldung oder etwas anderes)?";
    case "it":
      return "Certo. Cosa desidera sapere esattamente su LSA GLOBAL (prezzo, durata, orario, iscrizione o altro)?";
    case "pt":
      return "Claro. O que deseja saber exatamente sobre a LSA GLOBAL (preço, duração, horário, inscrição ou outro ponto)?";
    default:
      return "Sure. What exactly would you like to know about LSA GLOBAL (fee, duration, schedule, registration, or something else)?";
  }
}

function isGreetingMessage(text) {
  const normalized = normalizeForIntent(text);
  return /\b(hi|hello|hey|bonjour|salut|hola|hallo|ciao|olá|ola|guten tag|buenos dias|buongiorno)\b/i.test(normalized);
}

function getLocalizedMainMenu(language) {
  switch (language) {
    case "fr":
      return "Bonjour 👋 Bienvenue chez LSA GLOBAL.\n\nVeuillez choisir un service :\n1️⃣ Services de traduction\n2️⃣ Cours de langues\n3️⃣ Services d’interprétation\n4️⃣ Parler à un conseiller";
    case "es":
      return "Hola 👋 Bienvenido a LSA GLOBAL.\n\nPor favor, elija un servicio:\n1️⃣ Servicios de traducción\n2️⃣ Cursos de idiomas\n3️⃣ Servicios de interpretación\n4️⃣ Hablar con un asesor";
    case "it":
      return "Ciao 👋 Benvenuto in LSA GLOBAL.\n\nScegli un servizio:\n1️⃣ Servizi di traduzione\n2️⃣ Corsi di lingua\n3️⃣ Servizi di interpretariato\n4️⃣ Parlare con un consulente";
    case "pt":
      return "Olá 👋 Bem-vindo à LSA GLOBAL.\n\nEscolha um serviço:\n1️⃣ Serviços de tradução\n2️⃣ Cursos de línguas\n3️⃣ Serviços de interpretação\n4️⃣ Falar com um consultor";
    case "de":
      return "Hallo 👋 Willkommen bei LSA GLOBAL.\n\nBitte wählen Sie einen Service:\n1️⃣ Übersetzungsdienste\n2️⃣ Sprachkurse\n3️⃣ Dolmetschdienste\n4️⃣ Mit einem Berater sprechen";
    default:
      return "Hello 👋 Welcome to LSA GLOBAL.\n\nPlease choose a service:\n1️⃣ Translation services\n2️⃣ Language courses\n3️⃣ Interpreting services\n4️⃣ Speak to an advisor";
  }
}

function detectMenuSelection(text) {
  const normalized = normalizeForIntent(text);
  if (!normalized) return null;
  for (const [selection, terms] of Object.entries(MENU_KEYWORDS)) {
    if (terms.some((term) => normalizeForIntent(term) === normalized || new RegExp(`\\b${normalizeForIntent(term)}\\b`, "i").test(normalized))) {
      return selection;
    }
  }
  return null;
}

function getLocalizedMenuReply(language, selection) {
  const content = {
    translation: {
      en: "🌍 Translation Services\n\nPlease send:\n- document type\n- source language\n- target language\n- deadline",
      fr: "🌍 Services de traduction\n\nMerci d’envoyer :\n- type de document\n- langue source\n- langue cible\n- délai",
      es: "🌍 Servicios de traducción\n\nPor favor envíe:\n- tipo de documento\n- idioma de origen\n- idioma de destino\n- fecha límite",
      it: "🌍 Servizi di traduzione\n\nInvii:\n- tipo di documento\n- lingua di partenza\n- lingua di arrivo\n- scadenza",
      pt: "🌍 Serviços de tradução\n\nEnvie:\n- tipo de documento\n- idioma de origem\n- idioma de destino\n- prazo",
      de: "🌍 Übersetzungsdienste\n\nBitte senden Sie:\n- Dokumenttyp\n- Ausgangssprache\n- Zielsprache\n- Frist"
    },
    courses: {
      en: "📚 Language Courses\n\nPlease tell us:\n- language\n- current level\n- target exam (if any)",
      fr: "📚 Cours de langues\n\nMerci d’indiquer :\n- langue\n- niveau actuel\n- examen visé (si applicable)",
      es: "📚 Cursos de idiomas\n\nPor favor indique:\n- idioma\n- nivel actual\n- examen objetivo (si aplica)",
      it: "📚 Corsi di lingua\n\nPer favore indichi:\n- lingua\n- livello attuale\n- esame target (se previsto)",
      pt: "📚 Cursos de línguas\n\nIndique:\n- idioma\n- nível atual\n- exame-alvo (se houver)",
      de: "📚 Sprachkurse\n\nBitte teilen Sie uns mit:\n- Sprache\n- aktuelles Niveau\n- Zielprüfung (falls vorhanden)"
    },
    interpreting: {
      en: "🎤 Interpreting Services\n\nPlease tell us:\n- language pair\n- date\n- duration\n- online or onsite",
      fr: "🎤 Services d’interprétation\n\nMerci d’indiquer :\n- paire de langues\n- date\n- durée\n- en ligne ou sur site",
      es: "🎤 Servicios de interpretación\n\nPor favor indique:\n- combinación de idiomas\n- fecha\n- duración\n- en línea o presencial",
      it: "🎤 Servizi di interpretariato\n\nIndichi:\n- combinazione linguistica\n- data\n- durata\n- online o in presenza",
      pt: "🎤 Serviços de interpretação\n\nIndique:\n- par de idiomas\n- data\n- duração\n- online ou presencial",
      de: "🎤 Dolmetschdienste\n\nBitte teilen Sie mit:\n- Sprachkombination\n- Datum\n- Dauer\n- online oder vor Ort"
    },
    advisor: {
      en: "👨‍💼 Advisor Request\n\nPlease describe your need briefly. Our team will contact you shortly.",
      fr: "👨‍💼 Demande de conseiller\n\nDécrivez brièvement votre besoin. Notre équipe vous contactera rapidement.",
      es: "👨‍💼 Solicitud de asesor\n\nDescriba brevemente su necesidad. Nuestro equipo le contactará pronto.",
      it: "👨‍💼 Richiesta consulente\n\nDescriva brevemente la sua esigenza. Il nostro team la contatterà presto.",
      pt: "👨‍💼 Pedido de consultor\n\nDescreva brevemente a sua necessidade. A nossa equipa entrará em contacto em breve.",
      de: "👨‍💼 Berateranfrage\n\nBitte beschreiben Sie Ihr Anliegen kurz. Unser Team meldet sich in Kürze."
    }
  };

  const safeLang = ["en", "fr", "es", "it", "pt", "de"].includes(language) ? language : "en";
  return content[selection]?.[safeLang] || "";
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
  const hasSpecificSignals = /\b(price|prix|precio|prezzo|fee|fees|cost|date|exam|duration|horaire|schedule|orario|course|cours|curso|corso|translation|traduction|traduzione)\b/.test(normalized);
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

function enforceReplyStyle(text, language = "en") {
  const fallback = getLocalizedAck(language);
  const safeText = (text || "").trim();
  if (!safeText) return fallback;

  const blockedMentions = /\b(other school|other provider|another institute|competitor|outside lsa|go elsewhere|another center|another company|external institute)\b/i;
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

async function generateAIAnswerMessage({ customerMessage, kbMatches, specificIntent = null }) {
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

  const vagueHint = isVagueCustomerMessage(customerMessage) ? "YES" : "NO";
  const kbMode = kbMatches.length ? "KB_PRESENT" : "KB_MISSING";
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
11) If KB is insufficient, say briefly that a human advisor will assist.
12) Reply in the same language as the customer message.
13) Never send users outside LSA GLOBAL, even when information is missing.
14) If the customer asks a broad question, ask one clarifying question only.
15) When a relevant KB answer exists in another language, use it and answer in the customer's language.
16) Keep output under 80 words unless the customer explicitly asks for details.
17) If a specific intent is provided (fee, duration, schedule, exam, registration), answer only that intent.

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

    console.log("Message received from:", from, "| text:", text);

    await saveMessage({
      wa_id: from,
      contact_name: contactName,
      direction: "in",
      body: text,
      message_type: message.type || "text"
    });

    let reply = "";

    const detectedLanguage = detectMessageLanguage(text);
    const menuSelection = detectMenuSelection(text);

    if (isGreetingMessage(text)) {
      reply = getLocalizedMainMenu(detectedLanguage);
    } else if (menuSelection) {
      reply = getLocalizedMenuReply(detectedLanguage, menuSelection);
    } else {
      const kbMatches = await searchKnowledgeBase(text);
      const narrowIntent = detectNarrowIntent(text);
      const specificIntent = detectSpecificIntent(text);
      const vagueMessage = isVagueCustomerMessage(text);

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
        } else if ((narrowIntent || specificIntent) && kbMatches.length) {
          let extractedSection = null;
          const targetIntent = narrowIntent || specificIntent;
          for (const article of kbMatches) {
            extractedSection = extractRelevantKbSection(article.answer || "", targetIntent);
            if (extractedSection) break;
          }

          if (extractedSection) {
            reply = await localizeNarrowAnswer({
              text: extractedSection,
              language: detectedLanguage
            });
          } else if (!vagueMessage && kbMatches[0]?.answer) {
            reply = await localizeNarrowAnswer({
              text: kbMatches[0].answer,
              language: detectedLanguage
            });
          } else {
            reply = getLocalizedClarifyingQuestion(detectedLanguage);
          }
        } else if (vagueMessage && !specificIntent && !kbMatches.length) {
          reply = getLocalizedClarifyingQuestion(detectedLanguage);
        } else if (kbMatches.length && !vagueMessage) {
          reply = await localizeNarrowAnswer({
            text: kbMatches[0].answer || "",
            language: detectedLanguage
          });
        } else {
          reply = await generateAIAnswerMessage({
            customerMessage: text,
            kbMatches,
            specificIntent: specificIntent || narrowIntent
          });
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
  if (reply.length > 180) {
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
5. Keep every answer strictly inside LSA GLOBAL context. Never recommend competitors or external alternatives.
6. If the message looks like a quote request, partnership request, student inquiry, or support issue, mention that a human advisor can assist.
7. If the question is vague, ask one clarifying question.
8. If a relevant KB article is in another language, still use it and answer in the user's language.
9. Keep replies concise and narrow to the user's exact question.
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
      kb_matches: kbMatches.length
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
