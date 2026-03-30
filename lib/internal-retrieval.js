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
  registration: ["inscription", "registro", "iscrizione", "registration", "enrollment"],
  certificate: ["certificat", "certificado", "certificato", "attestation", "proof"],
  provider: ["teacher", "translator", "interpreter", "vendor", "partner", "prestataire"]
};

const INTENT_KEYWORDS = {
  fees: ["fee", "fees", "price", "prix", "tarifs", "cost", "coût", "frais", "precio", "prezzo"],
  duration: ["duration", "durée", "duracion", "durata", "length"],
  schedule: ["schedule", "horaires", "horaire", "horario", "orario", "timetable"],
  levels: ["level", "levels", "niveau", "niveaux", "nivel", "niveles", "a1", "a2", "b1", "b2", "c1", "c2"],
  location: ["location", "lieu", "centre", "city", "ville", "campus"],
  format: ["format", "online", "presentiel", "présentiel", "onsite", "in person"],
  registration: ["registration", "inscription", "enrolment", "enrollment", "admission", "apply"],
  certificate: ["certificate", "attestation", "proof", "certificat", "certification"],
  provider_matching: ["provider", "teacher", "translator", "interpreter", "matching", "services", "language_pairs", "working_languages", "specializations", "availability"]
};

const INTENT_PRIORITY = [
  "provider_matching", "fees", "duration", "schedule", "levels", "location", "format", "registration", "certificate"
];

function normalizeForRetrievalTerms(value) {
  return (value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, " ")
    .replace(/[’'`]/g, " ")
    .replace(/[^\p{L}\p{N}\s/-]/gu, " ")
    .split(/\s+/)
    .map(part => part.trim())
    .filter(Boolean);
}

function dedupeTerms(items) {
  return Array.from(new Set((items || []).filter(Boolean)));
}

function escapeLikeTerm(term) {
  return (term || "").replace(/[%,]/g, "").trim();
}

function detectIntent(query) {
  const normalized = normalizeForRetrievalTerms(query).join(" ");
  for (const intent of INTENT_PRIORITY) {
    const terms = INTENT_KEYWORDS[intent] || [];
    if (terms.some(term => normalized.includes(normalizeForRetrievalTerms(term).join(" ")))) {
      return intent;
    }
  }
  return "general";
}

function shouldSearchProviders(query, intent, options) {
  if (options.forceProviderSearch) return true;
  if (intent === "provider_matching") return true;
  const normalized = normalizeForRetrievalTerms(query).join(" ");
  return /(provider|translator|interpreter|teacher|matching|language pair|service|specialization|availability|city|country)/.test(normalized);
}

function buildVariantTerms(rawQuery) {
  const seedTerms = normalizeForRetrievalTerms(rawQuery).filter(term => !KB_STOP_WORDS.has(term));
  const expanded = [];
  for (const term of seedTerms) {
    expanded.push(term);
    for (const [canonical, variants] of Object.entries(CROSS_LANGUAGE_TERM_MAP)) {
      if (canonical === term || variants.includes(term)) {
        expanded.push(canonical, ...variants);
      }
    }
  }
  return dedupeTerms(expanded.map(escapeLikeTerm).filter(Boolean)).slice(0, 30);
}

function extractSnippetFromText(text, terms, maxLength = 280) {
  const source = (text || "").trim();
  if (!source) return "";

  const sections = source
    .split(/(?<=[.!?])\s+|\n+/)
    .map(section => section.trim())
    .filter(Boolean);

  let best = sections[0] || source;
  let bestScore = -1;
  for (const section of (sections.length ? sections : [source])) {
    const normalized = normalizeForRetrievalTerms(section).join(" ");
    let score = 0;
    for (const term of terms) {
      if (normalized.includes(term)) score += term.length >= 6 ? 2 : 1;
    }
    if (score > bestScore || (score === bestScore && section.length < best.length)) {
      best = section;
      bestScore = score;
    }
  }

  return best.length <= maxLength ? best : `${best.slice(0, maxLength - 3).trim()}...`;
}

function scoreRecord({ source, title, category, body, terms, intent, providerBoost }) {
  const titleLower = (title || "").toLowerCase();
  const categoryLower = (category || "").toLowerCase();
  const bodyLower = (body || "").toLowerCase();

  let score = 0;
  for (const term of terms) {
    if (!term || term.length < 2) continue;
    if (titleLower.includes(term)) score += 12;
    if (categoryLower.includes(term)) score += 7;
    if (bodyLower.includes(term)) score += source === "providers" ? 8 : 5;
  }

  const intentTerms = INTENT_KEYWORDS[intent] || [];
  for (const term of intentTerms) {
    const token = term.toLowerCase();
    if (titleLower.includes(token)) score += 8;
    if (bodyLower.includes(token)) score += 6;
  }

  if (source === "kb_articles") score += 4;
  if (source === "providers" && providerBoost) score += 8;
  return score;
}

function mapRecordBySource(source, record) {
  if (source === "kb_articles") {
    return {
      title: record.title || "Untitled KB Article",
      category: record.kb_categories?.name || "kb_article",
      body: [record.question, record.answer, record.keywords].filter(Boolean).join("\n")
    };
  }
  if (source === "kb_capture_assistant") {
    return {
      title: record.title || record.raw_question || "Captured knowledge",
      category: record.suggested_category || "capture_assistant",
      body: [record.raw_question, record.raw_answer, record.notes].filter(Boolean).join("\n")
    };
  }
  if (source === "kb_quick_capture") {
    return {
      title: record.title || "Quick capture",
      category: record.source_type || "quick_capture",
      body: [record.raw_text, record.notes].filter(Boolean).join("\n")
    };
  }
  return {
    title: record.organization_name || record.full_name || "Provider",
    category: record.provider_type || "provider",
    body: [
      record.services,
      record.language_pairs,
      record.working_languages,
      record.specializations,
      record.country,
      record.city,
      record.availability_status,
      record.notes
    ].filter(Boolean).join("\n")
  };
}

function createInternalRetriever({ supabase, detectLanguage }) {
  return async function retrieveInternalKnowledge(query, options = {}) {
    const rawQuery = (query || "").trim();
    if (!rawQuery) {
      return { normalized_query: "", detected_language: "en", intent: "general", matches: [] };
    }

    const allowedSources = ["kb_articles", "kb_capture_assistant", "kb_quick_capture", "providers"];
    const requestedSources = Array.isArray(options.sources) && options.sources.length
      ? options.sources.filter(source => allowedSources.includes(source))
      : allowedSources;
    const maxMatches = Math.max(1, Math.min(Number(options.maxMatches) || 10, 25));

    const normalizedQuery = normalizeForRetrievalTerms(rawQuery).join(" ");
    const detectedLanguage = typeof detectLanguage === "function" ? detectLanguage(rawQuery) : "en";
    const intent = options.intent || detectIntent(rawQuery);
    const terms = buildVariantTerms(rawQuery);
    const providerBoost = shouldSearchProviders(rawQuery, intent, options);

    const sourceQueries = [];

    if (requestedSources.includes("kb_articles")) {
      let articleQuery = supabase
        .from("kb_articles")
        .select(`id,title,question,answer,keywords,audience,language,status,kb_categories ( name )`)
        .eq("status", "published")
        .limit(120);
      if (terms.length) {
        const orParts = terms.flatMap(term => [
          `title.ilike.%${term}%`,
          `question.ilike.%${term}%`,
          `answer.ilike.%${term}%`,
          `keywords.ilike.%${term}%`,
          `kb_categories.name.ilike.%${term}%`
        ]);
        articleQuery = articleQuery.or(orParts.join(","));
      }
      sourceQueries.push(articleQuery.then(result => ({ source: "kb_articles", ...result })));
    }

    if (requestedSources.includes("kb_capture_assistant")) {
      let captureQuery = supabase
        .from("kb_capture_assistant")
        .select("id,title,raw_question,raw_answer,suggested_category,audience,source_channel,status,notes")
        .limit(120);
      if (terms.length) {
        const orParts = terms.flatMap(term => [
          `title.ilike.%${term}%`,
          `raw_question.ilike.%${term}%`,
          `raw_answer.ilike.%${term}%`,
          `suggested_category.ilike.%${term}%`,
          `notes.ilike.%${term}%`
        ]);
        captureQuery = captureQuery.or(orParts.join(","));
      }
      sourceQueries.push(captureQuery.then(result => ({ source: "kb_capture_assistant", ...result })));
    }

    if (requestedSources.includes("kb_quick_capture")) {
      let quickCaptureQuery = supabase
        .from("kb_quick_capture")
        .select("id,title,raw_text,source_type,status,notes")
        .limit(120);
      if (terms.length) {
        const orParts = terms.flatMap(term => [
          `title.ilike.%${term}%`,
          `raw_text.ilike.%${term}%`,
          `source_type.ilike.%${term}%`,
          `notes.ilike.%${term}%`
        ]);
        quickCaptureQuery = quickCaptureQuery.or(orParts.join(","));
      }
      sourceQueries.push(quickCaptureQuery.then(result => ({ source: "kb_quick_capture", ...result })));
    }

    if (requestedSources.includes("providers") && providerBoost) {
      let providerQuery = supabase
        .from("providers")
        .select("id,provider_type,full_name,organization_name,country,city,working_languages,language_pairs,services,specializations,availability_status,status,notes")
        .eq("status", "active")
        .limit(120);
      if (terms.length) {
        const orParts = terms.flatMap(term => [
          `provider_type.ilike.%${term}%`,
          `full_name.ilike.%${term}%`,
          `organization_name.ilike.%${term}%`,
          `country.ilike.%${term}%`,
          `city.ilike.%${term}%`,
          `working_languages.ilike.%${term}%`,
          `language_pairs.ilike.%${term}%`,
          `services.ilike.%${term}%`,
          `specializations.ilike.%${term}%`,
          `availability_status.ilike.%${term}%`,
          `notes.ilike.%${term}%`
        ]);
        providerQuery = providerQuery.or(orParts.join(","));
      }
      sourceQueries.push(providerQuery.then(result => ({ source: "providers", ...result })));
    }

    const sourceResults = await Promise.all(sourceQueries);
    const scoredMatches = [];

    for (const result of sourceResults) {
      if (result.error) {
        console.error(`Internal retrieval error (${result.source}):`, result.error);
        continue;
      }
      for (const record of (result.data || [])) {
        const { title, category, body } = mapRecordBySource(result.source, record);
        const score = scoreRecord({
          source: result.source,
          title,
          category,
          body,
          terms,
          intent,
          providerBoost
        });
        if (score <= 0) continue;
        scoredMatches.push({
          source: result.source,
          source_id: record.id,
          title,
          category,
          score,
          snippet: extractSnippetFromText(body, terms),
          raw_reference: record
        });
      }
    }

    const ranked = scoredMatches.sort((a, b) => b.score - a.score).slice(0, maxMatches);
    return {
      normalized_query: normalizedQuery,
      detected_language: detectedLanguage,
      intent,
      matches: ranked
    };
  };
}

module.exports = { createInternalRetriever, detectIntent, normalizeForRetrievalTerms };
