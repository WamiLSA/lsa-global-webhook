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
const ENTITY_CATALOG = {
  italian_course: { domain: "course", terms: ["italian", "italiano", "italien", "italiana", "italian course", "corso italiano"] },
  english_course: { domain: "course", terms: ["english", "ingles", "inglés", "anglais", "inglese", "english course"] },
  french_course: { domain: "course", terms: ["french", "francais", "français", "francese", "frances", "french course"] },
  spanish_course: { domain: "course", terms: ["spanish", "espanol", "español", "espagnol", "spagnolo", "spanish course"] },
  portuguese_course: { domain: "course", terms: ["portuguese", "portugais", "portugues", "portoghese", "portuguese course"] },
  translation_service: { domain: "translation", terms: ["translation", "traduction", "traduccion", "traduzione", "translator"] },
  interpreting_service: { domain: "interpreting", terms: ["interpreting", "interpretation", "interpretariat", "interpretazione", "interpreter"] },
  partnership: { domain: "partnership", terms: ["partnership", "partner", "collaboration", "affiliate"] },
  certificate_verification: { domain: "certificate", terms: ["certificate verification", "verify certificate", "certification verification", "attestation", "proof"] },
  provider_search: { domain: "provider", terms: ["provider", "provider search", "vendor", "translator", "interpreter", "teacher matching"] }
};
const DOMAIN_SOURCE_RULES = {
  provider: new Set(["providers"]),
  course: new Set(["kb_articles", "kb_capture_assistant", "kb_quick_capture"]),
  translation: new Set(["kb_articles", "kb_capture_assistant", "kb_quick_capture", "providers"]),
  interpreting: new Set(["kb_articles", "kb_capture_assistant", "kb_quick_capture", "providers"]),
  certificate: new Set(["kb_articles", "kb_capture_assistant", "kb_quick_capture"]),
  partnership: new Set(["kb_articles", "kb_capture_assistant", "kb_quick_capture"])
};
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

function toSafeFilterToken(term) {
  const normalized = normalizeForRetrievalTerms(term).join(" ").trim();
  if (!normalized) return "";
  return normalized.replace(/[^\p{L}\p{N}\s-]/gu, " ").replace(/\s+/g, " ").trim();
}

function buildSafeOrClause(fields, token) {
  const safeToken = toSafeFilterToken(token);
  if (!safeToken) return "";
  const wildcardToken = safeToken.replace(/\s+/g, "%");
  if (!wildcardToken) return "";
  return (fields || [])
    .map(field => `${field}.ilike.%${wildcardToken}%`)
    .join(",");
}

async function runTokenizedOrSearch({
  supabase,
  table,
  select,
  baseFilters = [],
  fields = [],
  terms = [],
  limit = 120,
  perTokenLimit = 60,
  maxTokens = 12
}) {
  const uniqueTerms = dedupeTerms((terms || []).map(toSafeFilterToken).filter(Boolean)).slice(0, maxTokens);
  const buildBaseQuery = () => {
    let query = supabase
      .from(table)
      .select(select)
      .limit(perTokenLimit);
    for (const applyFilter of baseFilters) {
      query = applyFilter(query);
    }
    return query;
  };

  if (!uniqueTerms.length) {
    let fallbackQuery = supabase
      .from(table)
      .select(select)
      .limit(limit);
    for (const applyFilter of baseFilters) {
      fallbackQuery = applyFilter(fallbackQuery);
    }
    return fallbackQuery;
  }

  const collected = [];
  const seenIds = new Set();
  for (const term of uniqueTerms) {
    const orClause = buildSafeOrClause(fields, term);
    if (!orClause) continue;
    const { data, error } = await buildBaseQuery().or(orClause);
    if (error) return { data: null, error };
    for (const row of (data || [])) {
      if (!row?.id || seenIds.has(row.id)) continue;
      seenIds.add(row.id);
      collected.push(row);
      if (collected.length >= limit) {
        return { data: collected, error: null };
      }
    }
  }

  return { data: collected, error: null };
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

function detectLikelyLanguage(query, detectLanguage) {
  if (typeof detectLanguage === "function") {
    return detectLanguage(query || "");
  }
  return "en";
}

function isShortFollowUpQuery(query) {
  const terms = normalizeForRetrievalTerms(query || "");
  return terms.length > 0 && terms.length <= 3;
}

function detectRequestedField(intent) {
  if (!intent || intent === "general") return null;
  return intent;
}

function detectEntity(query, recentContext = {}, intent = "general") {
  const normalized = normalizeForRetrievalTerms(query).join(" ");
  const scored = Object.entries(ENTITY_CATALOG)
    .map(([entity, config]) => {
      let score = 0;
      for (const term of config.terms) {
        const normalizedTerm = normalizeForRetrievalTerms(term).join(" ");
        if (!normalizedTerm) continue;
        if (normalized.includes(normalizedTerm)) score += normalizedTerm.includes(" ") ? 3 : 1;
      }
      return { entity, score, domain: config.domain, terms: config.terms };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scored.length) return scored[0];
  if (isShortFollowUpQuery(query) && intent !== "general" && recentContext.entity && ENTITY_CATALOG[recentContext.entity]) {
    return {
      entity: recentContext.entity,
      score: 0,
      domain: ENTITY_CATALOG[recentContext.entity].domain,
      terms: ENTITY_CATALOG[recentContext.entity].terms
    };
  }
  return null;
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

function classifyRecordDomain(source, textBlob = "") {
  const normalized = normalizeForRetrievalTerms(textBlob).join(" ");
  if (source === "providers") return "provider";
  if (/\b(course|courses|class|classes|a1|a2|b1|b2|c1|c2)\b/.test(normalized)) return "course";
  if (/\b(traduction|translation|traduzione|translator)\b/.test(normalized)) return "translation";
  if (/\b(interpreting|interpretation|interprete|interpretariat)\b/.test(normalized)) return "interpreting";
  if (/\b(certificate|certification|attestation|verify)\b/.test(normalized)) return "certificate";
  if (/\b(partnership|partner|affiliate|collaboration)\b/.test(normalized)) return "partnership";
  return "general";
}

function sourceAllowedForDomain(source, domain) {
  if (!domain) return true;
  const allowed = DOMAIN_SOURCE_RULES[domain];
  if (!allowed) return true;
  return allowed.has(source);
}

function recordMatchesEntity(recordText, entityTerms = []) {
  if (!entityTerms.length) return true;
  const normalized = normalizeForRetrievalTerms(recordText).join(" ");
  return entityTerms.some(term => {
    const token = normalizeForRetrievalTerms(term).join(" ");
    return token && normalized.includes(token);
  });
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

function detectCourseLanguageMentions(value) {
  const normalized = normalizeForRetrievalTerms(value || "");
  if (!normalized.length) return new Set();
  const joined = normalized.join(" ");
  const mentions = new Set();

  for (const [language, variants] of Object.entries(COURSE_LANGUAGE_KEYWORDS)) {
    const hasMatch = variants.some((variant) => {
      const normalizedVariant = normalizeForRetrievalTerms(variant).join(" ");
      if (!normalizedVariant) return false;
      return joined.includes(normalizedVariant);
    });
    if (hasMatch) mentions.add(language);
  }
  return mentions;
}

function isCourseRelatedQuery(query, intent, options = {}) {
  if (options.courseTopicActive) return true;
  if (intent === "fees" || intent === "duration" || intent === "schedule" || intent === "levels" || intent === "registration") {
    return true;
  }
  const normalized = normalizeForRetrievalTerms(query || "").join(" ");
  return /\b(course|courses|cours|curso|corsi|class|classes|program|language)\b/.test(normalized);
}

function detectRequestedCourseLanguage(query, recentContext = {}) {
  const mentions = detectCourseLanguageMentions(query);
  if (mentions.size) return [...mentions][0];
  return recentContext.preferredCourseLanguage || null;
}

function scoreRecord({
  source,
  title,
  category,
  body,
  terms,
  intent,
  providerBoost,
  articleLanguage = "",
  queryCourseLanguages = new Set(),
  preferredCourseLanguage = null
}) {
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

  if (source === "kb_articles") {
    const articleCourseLanguages = detectCourseLanguageMentions(
      `${titleLower}\n${categoryLower}\n${bodyLower}\n${String(articleLanguage || "").toLowerCase()}`
    );

    if (queryCourseLanguages.size) {
      const hasExplicitMatch = [...queryCourseLanguages].some(language => articleCourseLanguages.has(language));
      if (hasExplicitMatch) {
        score += 120;
      } else {
        score -= 80;
      }
    } else if (preferredCourseLanguage) {
      if (articleCourseLanguages.has(preferredCourseLanguage)) {
        score += 90;
      } else if (articleCourseLanguages.size) {
        score -= 30;
      }
    }
  }

  return score;
}

function mapRecordBySource(source, record) {
  if (source === "kb_articles") {
    return {
      title: record.title || "Untitled KB Article",
      category: record.kb_categories?.name || "kb_article",
      body: [record.question, record.answer, record.keywords].filter(Boolean).join("\n"),
      language: record.language || ""
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
    language: "",
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
    const detectedLanguage = detectLikelyLanguage(rawQuery, detectLanguage);
    const intent = options.intent || detectIntent(rawQuery);
    const detectedEntity = detectEntity(rawQuery, options.contextMemory || {}, intent);
    const entityTerms = detectedEntity?.terms || [];
    const terms = dedupeTerms([...buildVariantTerms(rawQuery), ...entityTerms]).slice(0, 40);
    const requestedField = detectRequestedField(intent);
    const providerBoost = shouldSearchProviders(rawQuery, intent, options);
    const queryCourseLanguages = detectCourseLanguageMentions(rawQuery);
    const preferredCourseLanguage = detectRequestedCourseLanguage(rawQuery, {
      preferredCourseLanguage: options.preferredCourseLanguage || null
    });
    const courseRelated = isCourseRelatedQuery(rawQuery, intent, options) || detectedEntity?.domain === "course";
    const filteredRequestedSources = requestedSources.filter(source =>
      sourceAllowedForDomain(source, detectedEntity?.domain || null)
    );

    const sourceQueries = [];

    if (filteredRequestedSources.includes("kb_articles")) {
      const languageTerms = (courseRelated && queryCourseLanguages.size)
        ? [...queryCourseLanguages]
          .flatMap(language => COURSE_LANGUAGE_KEYWORDS[language] || [])
          .map(toSafeFilterToken)
          .filter(Boolean)
          .slice(0, 20)
        : [];
      const articleTerms = dedupeTerms([...terms, ...languageTerms]);
      sourceQueries.push(
        runTokenizedOrSearch({
          supabase,
          table: "kb_articles",
          select: "id,title,question,answer,keywords,audience,language,status,kb_categories ( name )",
          baseFilters: [(query) => query.eq("status", "published")],
          fields: ["title", "question", "answer", "keywords"],
          terms: articleTerms,
          limit: 120
        }).then(result => ({ source: "kb_articles", ...result }))
      );
    }

    if (filteredRequestedSources.includes("kb_capture_assistant")) {
      sourceQueries.push(
        runTokenizedOrSearch({
          supabase,
          table: "kb_capture_assistant",
          select: "id,title,raw_question,raw_answer,suggested_category,audience,source_channel,status,notes",
          fields: ["title", "raw_question", "raw_answer", "suggested_category", "notes"],
          terms,
          limit: 120
        }).then(result => ({ source: "kb_capture_assistant", ...result }))
      );
    }

    if (filteredRequestedSources.includes("kb_quick_capture")) {
      sourceQueries.push(
        runTokenizedOrSearch({
          supabase,
          table: "kb_quick_capture",
          select: "id,title,raw_text,source_type,status,notes",
          fields: ["title", "raw_text", "source_type", "notes"],
          terms,
          limit: 120
        }).then(result => ({ source: "kb_quick_capture", ...result }))
      );
    }

    if (filteredRequestedSources.includes("providers") && providerBoost) {
      sourceQueries.push(
        runTokenizedOrSearch({
          supabase,
          table: "providers",
          select: "id,provider_type,full_name,organization_name,country,city,working_languages,language_pairs,services,specializations,availability_status,status,notes",
          baseFilters: [(query) => query.eq("status", "active")],
          fields: [
            "provider_type",
            "full_name",
            "organization_name",
            "country",
            "city",
            "working_languages",
            "language_pairs",
            "services",
            "specializations",
            "availability_status",
            "notes"
          ],
          terms,
          limit: 120
        }).then(result => ({ source: "providers", ...result }))
      );
    }

    const sourceResults = await Promise.all(sourceQueries);
    const scoredMatches = [];

    for (const result of sourceResults) {
      if (result.error) {
        console.error(`Internal retrieval error (${result.source}):`, result.error);
        continue;
      }
      for (const record of (result.data || [])) {
        const { title, category, body, language } = mapRecordBySource(result.source, record);
        const recordBlob = `${title || ""}\n${category || ""}\n${body || ""}\n${language || ""}`;
        const recordDomain = classifyRecordDomain(result.source, recordBlob);
        if (!sourceAllowedForDomain(result.source, detectedEntity?.domain || null)) continue;
        if (detectedEntity?.domain && recordDomain !== "general" && recordDomain !== detectedEntity.domain) continue;
        if (detectedEntity?.terms?.length && !recordMatchesEntity(recordBlob, detectedEntity.terms)) continue;
        if (result.source === "kb_articles" && courseRelated && queryCourseLanguages.size) {
          const articleCourseLanguages = detectCourseLanguageMentions(
            `${title || ""}\n${category || ""}\n${body || ""}\n${String(language || "")}`
          );
          const hasRequestedLanguage = [...queryCourseLanguages].some(item => articleCourseLanguages.has(item));
          if (!hasRequestedLanguage) continue;
        }
        const score = scoreRecord({
          source: result.source,
          title,
          category,
          body,
          terms,
          intent,
          providerBoost,
          articleLanguage: language,
          queryCourseLanguages,
          preferredCourseLanguage
        });
        if (score <= 0) continue;
        const reasons = [];
        if (detectedEntity?.entity) reasons.push(`entity:${detectedEntity.entity}`);
        if (requestedField) reasons.push(`field:${requestedField}`);
        if (intent !== "general") reasons.push(`intent:${intent}`);
        if (result.source) reasons.push(`source:${result.source}`);
        const matchedTerms = terms.filter(term => recordBlob.toLowerCase().includes(term)).slice(0, 6);
        if (matchedTerms.length) reasons.push(`terms:${matchedTerms.join(",")}`);

        scoredMatches.push({
          source: result.source,
          source_id: record.id,
          title,
          category,
          score,
          snippet: extractSnippetFromText(body, terms),
          reasons,
          raw_reference: record,
          record_domain: recordDomain
        });
      }
    }

    const ranked = scoredMatches.sort((a, b) => b.score - a.score).slice(0, maxMatches);
    return {
      normalized_query: normalizedQuery,
      detected_language: detectedLanguage,
      intent,
      requested_field: requestedField,
      entity: detectedEntity?.entity || null,
      entity_domain: detectedEntity?.domain || null,
      matches: ranked,
      debug: options.debug ? {
        allowed_sources: allowedSources,
        requested_sources: requestedSources,
        filtered_sources: filteredRequestedSources,
        fallback_reason: ranked.length ? null : "no_match_after_filters"
      } : undefined
    };
  };
}

module.exports = { createInternalRetriever, detectIntent, normalizeForRetrievalTerms };
