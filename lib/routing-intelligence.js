const SUPPORTED_ROUTING_LANGUAGES = Object.freeze([
  "en", "fr", "es", "de", "pt", "it", "ar", "zh", "ja", "da", "nl", "ro", "pl", "sv", "no", "ru"
]);

const ROLE_INTENTS = Object.freeze({
  CUSTOMER: "customer",
  LEARNER: "learner",
  TRANSLATOR: "translator",
  INTERPRETER: "interpreter",
  TEACHER_TRAINER: "teacher_trainer",
  PROVIDER_COLLABORATOR: "provider_collaborator",
  FREELANCER: "freelancer",
  JOB_SEEKER_APPLICANT: "job_seeker_applicant",
  SUPPORT_SEEKER: "support_seeker",
  ADVISOR_REQUEST: "advisor_request",
  TECH_SERVICE_PROVIDER: "tech_service_provider",
  AI_SYSTEMS_COLLABORATOR: "ai_systems_collaborator",
  OTHER_BUSINESS_CONTACT: "other_business_contact",
  UNKNOWN: "unknown"
});

const SERVICE_INTENTS = Object.freeze({
  TRANSLATION: "translation",
  LANGUAGE_COURSES: "language_courses",
  INTERPRETING: "interpreting",
  SUPPORT_ADVISOR: "support_advisor",
  QUOTE: "quote",
  CERTIFICATE: "certificate",
  PROVIDER_INTAKE: "provider_intake",
  TECH_SERVICES: "tech_services",
  AI_AUTOMATION: "ai_automation",
  FUTURE_DOMAIN: "future_domain",
  UNKNOWN: "unknown"
});

function normalizeRoutingText(text = "") {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’'`]/g, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function firstPatternMatch(normalized, patterns = []) {
  for (const item of patterns) {
    if (item.pattern.test(normalized)) return item;
  }
  return null;
}

function detectRoutingLanguage(text = "", fallback = "en") {
  const value = String(text || "").toLowerCase();
  if (!value.trim()) return fallback;
  if (/[\u0600-\u06ff]/.test(value)) return "ar";
  if (/[\u4e00-\u9fff]/.test(value)) return "zh";
  if (/[\u3040-\u30ff]/.test(value)) return "ja";
  if (/[\u0400-\u04ff]/.test(value)) return "ru";
  if (/\b(bonjour|merci|traducteur|traductrice|enseignant|professeur|cours|emploi|travail|collaborer|freelance|conseiller)\b/i.test(value)) return "fr";
  if (/\b(hola|gracias|traductor|traductora|profesor|maestro|curso|trabajo|empleo|colaborar|asesor)\b/i.test(value)) return "es";
  if (/\b(hallo|danke|ubersetzer|übersetzer|dolmetscher|lehrer|kurs|arbeit|mitarbeiten|berater)\b/i.test(value)) return "de";
  if (/\b(ola|olá|obrigad[oa]|tradutor|tradutora|professor|curso|trabalho|emprego|colaborar|consultor)\b/i.test(value)) return "pt";
  if (/\b(ciao|grazie|traduttore|traduttrice|insegnante|corso|lavoro|collaborare|consulente)\b/i.test(value)) return "it";
  if (/\b(hej|tak|oversaetter|oversætter|laerer|lærer|kursus|arbejde|job|samarbejde|radgiver|rådgiver)\b/i.test(value)) return "da";
  return fallback;
}

const ROLE_PATTERNS = [
  { role: ROLE_INTENTS.TRANSLATOR, reason: "arabic_translator_identity", weight: 6, pattern: /(?:انا|أنا).*مترجم|مترجم(?:ة)?/i },
  { role: ROLE_INTENTS.TEACHER_TRAINER, reason: "arabic_teacher_identity", weight: 6, pattern: /(?:انا|أنا).*(?:مدرس|معلم)|(?:مدرس|معلم)(?:ة)?/i },
  { role: ROLE_INTENTS.INTERPRETER, reason: "arabic_interpreter_identity", weight: 6, pattern: /ترجمة\s+فورية|مترجم\s+فوري/i },
  { role: ROLE_INTENTS.JOB_SEEKER_APPLICANT, reason: "arabic_job_seeker", weight: 6, pattern: /(?:احتاج|أحتاج|اريد|أريد).*(?:عمل|وظيفة)|(?:عمل|وظيفة).*(?:مع|من)\s*lsa/i },
  {
    role: ROLE_INTENTS.AI_SYSTEMS_COLLABORATOR,
    reason: "ai_systems_provider_identity",
    weight: 6,
    pattern: /\b(i\s+am|i\s*m|je\s+suis|soy|sou|ich\s+bin|sono|انا)\b.*\b(ai|automation|automations|workflow|workflows|chatbot|agent|agents|system|systems|automatisation|automatizacion|automatizacao|ki|ia)\b|\b(build|create|develop|provide|offer|construis|construyo|desenvolvo)\b.*\b(ai|automation|workflows?|systems?)\b/i
  },
  {
    role: ROLE_INTENTS.TECH_SERVICE_PROVIDER,
    reason: "tech_service_provider_identity",
    weight: 6,
    pattern: /\b(i\s+am|i\s*m|je\s+suis|soy|sou|ich\s+bin|sono|انا)\b.*\b(web\s+developer|developer|programmer|lms|it\s+support|software|website|digital\s+operations|devops|tech)\b|\b(provide|offer|build|develop|cree|créer|desarrollo|desenvolvo)\b.*\b(websites?|lms|it|software|platforms?|tech\s+services?)\b/i
  },
  {
    role: ROLE_INTENTS.TEACHER_TRAINER,
    reason: "teacher_trainer_identity",
    weight: 6,
    pattern: /\b(i\s+am|i\s*m|am|je\s+suis|soy|sou|eu\s+sou|ich\s+bin|sono|انا)\b.*\b(teacher|trainer|tutor|professor|instructor|enseignant|enseignante|professeur|formateur|formadora|profesor|profesora|maestro|maestra|professor|professora|lehrer|lehrerin|insegnante|مدرس|معلم)\b|\b(i\s+can|je\s+peux|puedo|posso|ich\s+kann|sono\s+disponibile\s+per)\b.*\b(teach|train|enseigner|donner\s+des\s+cours|ensenar|enseñar|dar\s+clases|ensinar|unterrichten|insegnare)\b/i
  },
  {
    role: ROLE_INTENTS.TRANSLATOR,
    reason: "translator_identity",
    weight: 6,
    pattern: /\b(i\s+am|i\s*m|am|je\s+suis|soy|sou|eu\s+sou|ich\s+bin|sono|انا)\b.*\b(translator|traducteur|traductrice|traductor|traductora|tradutor|tradutora|ubersetzer|übersetzer|traduttore|traduttrice|مترجم)\b/i
  },
  {
    role: ROLE_INTENTS.INTERPRETER,
    reason: "interpreter_identity",
    weight: 6,
    pattern: /\b(i\s+am|i\s*m|am|je\s+suis|soy|sou|eu\s+sou|ich\s+bin|sono|انا)\b.*\b(interpreter|interprete|interprète|interprete|intérprete|interprete|dolmetscher|interprete|مترجم\s+فوري)\b|\b(provide|offer|can\s+do)\b.*\b(interpreting|interpretation)\b/i
  },
  {
    role: ROLE_INTENTS.FREELANCER,
    reason: "freelancer_identity",
    weight: 5,
    pattern: /\b(freelancer|freelance|independent\s+contractor|prestataire|autonome|freelanceur|freelancero)\b/i
  },
  {
    role: ROLE_INTENTS.JOB_SEEKER_APPLICANT,
    reason: "job_seeker_or_applicant",
    weight: 6,
    pattern: /\b(need|want|looking\s+for|seeking|apply\s+for|application|send\s+me|give\s+me|join)\b.*\b(work|job|jobs|employment|assignments|projects|vacancy|position)\b|\b(emploi|travail|poste|mission|missions|recrutement|candidature|contrat|trabajo|empleo|puesto|proyectos|trabalho|emprego|arbeit|stelle|auftrag|auftrage|lavoro|impiego|وظيفة|عمل)\b/i
  },
  {
    role: ROLE_INTENTS.PROVIDER_COLLABORATOR,
    reason: "provider_collaboration_request",
    weight: 5,
    pattern: /\b(work\s+with\s+(lsa\s+global|you)|collaborat(e|ion)|partner\s+with\s+you|provider|collaborator|vendor|supplier|prestataire|collaborer|partenaire|proveedor|colaborador|fornecedor|anbieter)\b/i
  },
  {
    role: ROLE_INTENTS.LEARNER,
    reason: "learner_or_student_request",
    weight: 4,
    pattern: /\b(i\s+want\s+to\s+learn|i\s+need\s+a\s+course|student|learner|study|enroll|je\s+veux\s+apprendre|etudiant|étudiant|apprenant|quiero\s+aprender|estudiante|alumno|quero\s+aprender|estudante|ich\s+mochte\s+lernen|ich\s+möchte\s+lernen|schuler|student|voglio\s+imparare|studente)\b/i
  },
  {
    role: ROLE_INTENTS.SUPPORT_SEEKER,
    reason: "support_request",
    weight: 4,
    pattern: /\b(help|support|issue|problem|complaint|assistance|aide|probleme|problème|soporte|ayuda|problema|suporte|hilfe|problema|assistenza)\b/i
  },
  {
    role: ROLE_INTENTS.ADVISOR_REQUEST,
    reason: "advisor_request",
    weight: 4,
    pattern: /\b(advisor|adviser|consultant|conseiller|asesor|consultor|berater|consulente|مستشار)\b/i
  }
];

const SERVICE_PATTERNS = [
  { service: SERVICE_INTENTS.TRANSLATION, reason: "arabic_translation_keyword", weight: 4, pattern: /ترجمة|مترجم/i },
  { service: SERVICE_INTENTS.LANGUAGE_COURSES, reason: "arabic_course_keyword", weight: 4, pattern: /دورة|دورات|تعليم|مدرس|معلم/i },
  { service: SERVICE_INTENTS.INTERPRETING, reason: "arabic_interpreting_keyword", weight: 4, pattern: /ترجمة\s+فورية|مترجم\s+فوري/i },
  { service: SERVICE_INTENTS.AI_AUTOMATION, reason: "ai_automation_keyword", weight: 5, pattern: /\b(ai|artificial\s+intelligence|automation|automations|workflow|workflows|chatbot|agent|agents|ia|ki|automatisation|automatizacion|automatizacao)\b/i },
  { service: SERVICE_INTENTS.TECH_SERVICES, reason: "tech_services_keyword", weight: 5, pattern: /\b(web\s+development|website|lms|it\s+support|software|platform|app|digital\s+operations|tech\s+services?|developer|devops)\b/i },
  { service: SERVICE_INTENTS.TRANSLATION, reason: "translation_keyword", weight: 4, pattern: /\b(translation|translate|translator|certified\s+translation|sworn\s+translation|localization|traduction|traducteur|traductor|traduccion|traducción|traducao|tradução|ubersetzung|übersetzung|traduzione|مترجم|ترجمة)\b/i },
  { service: SERVICE_INTENTS.LANGUAGE_COURSES, reason: "language_course_keyword", weight: 4, pattern: /\b(course|courses|class|classes|language\s+training|teacher|teach|trainer|student|cours|formation|enseignant|professeur|curso|clase|profesor|aula|cursos|kurs|unterricht|corso|مدرس|دورة)\b/i },
  { service: SERVICE_INTENTS.INTERPRETING, reason: "interpreting_keyword", weight: 4, pattern: /\b(interpreting|interpretation|interpreter|interpretariat|interprétation|interprete|intérprete|interpretacao|interpretação|dolmetsch|مترجم\s+فوري)\b/i },
  { service: SERVICE_INTENTS.QUOTE, reason: "quote_keyword", weight: 3, pattern: /\b(quote|quotation|estimate|price|cost|fee|devis|prix|tarif|presupuesto|cotizacion|cotización|precio|orcamento|orçamento|preis|angebot|preventivo)\b/i },
  { service: SERVICE_INTENTS.CERTIFICATE, reason: "certificate_keyword", weight: 3, pattern: /\b(certificate|certification|attestation|verify|verification|certificat|attestation|certificado|certificacao|certificação|zertifikat|bescheinigung|certificato|شهادة)\b/i },
  { service: SERVICE_INTENTS.SUPPORT_ADVISOR, reason: "support_advisor_keyword", weight: 3, pattern: /\b(support|help|advisor|adviser|assistance|aide|conseiller|soporte|ayuda|asesor|suporte|consultor|hilfe|berater|assistenza|consulente)\b/i },
  { service: SERVICE_INTENTS.PROVIDER_INTAKE, reason: "provider_intake_keyword", weight: 3, pattern: /\b(provider|collaborator|freelancer|vendor|supplier|applicant|prestataire|collaborateur|proveedor|colaborador|fornecedor|anbieter|applicant)\b/i }
];

const CUSTOMER_REQUEST_PATTERNS = [
  /\b(i\s+need|i\s+want|i\s+would\s+like|request|looking\s+for)\b.*\b(service|translation|interpreter|course|class|quote|certificate|support)\b/i,
  /\b(translate\s+my|my\s+document|need\s+a\s+translation|need\s+an\s+interpreter|want\s+to\s+study|want\s+to\s+learn)\b/i,
  /\b(je\s+veux|j\s+ai\s+besoin|quisiera|quiero|necesito|preciso|gostaria|ich\s+brauche|ich\s+mochte|ich\s+möchte|vorrei)\b.*\b(traduction|traduc|traduz|ubersetz|übersetz|cours|curso|kurs|corso|devis|precio|preco|preço|preis)\b/i
];

function detectRoleIntent(text = "") {
  const normalized = normalizeRoutingText(text);
  if (!normalized) return { intent: ROLE_INTENTS.UNKNOWN, score: 0, reason: "empty", matches: [] };
  const matches = ROLE_PATTERNS.filter((item) => item.pattern.test(normalized));
  if (CUSTOMER_REQUEST_PATTERNS.some((pattern) => pattern.test(normalized))) {
    matches.push({ role: ROLE_INTENTS.CUSTOMER, reason: "customer_service_request", weight: 4 });
  }
  if (!matches.length) return { intent: ROLE_INTENTS.UNKNOWN, score: 0, reason: "no_role_signal", matches: [] };
  matches.sort((a, b) => b.weight - a.weight);
  return {
    intent: matches[0].role,
    score: matches[0].weight,
    reason: matches[0].reason,
    matches: matches.map((item) => ({ intent: item.role, reason: item.reason, score: item.weight }))
  };
}

function detectServiceIntent(text = "") {
  const normalized = normalizeRoutingText(text);
  if (!normalized) return { intent: SERVICE_INTENTS.UNKNOWN, score: 0, reason: "empty", matches: [] };
  const matches = SERVICE_PATTERNS.filter((item) => item.pattern.test(normalized));
  if (!matches.length) return { intent: SERVICE_INTENTS.UNKNOWN, score: 0, reason: "no_service_signal", matches: [] };
  matches.sort((a, b) => b.weight - a.weight);
  return {
    intent: matches[0].service,
    score: matches[0].weight,
    reason: matches[0].reason,
    matches: matches.map((item) => ({ intent: item.service, reason: item.reason, score: item.weight }))
  };
}

const PROVIDER_ROLES = new Set([
  ROLE_INTENTS.TRANSLATOR,
  ROLE_INTENTS.INTERPRETER,
  ROLE_INTENTS.TEACHER_TRAINER,
  ROLE_INTENTS.PROVIDER_COLLABORATOR,
  ROLE_INTENTS.FREELANCER,
  ROLE_INTENTS.JOB_SEEKER_APPLICANT,
  ROLE_INTENTS.TECH_SERVICE_PROVIDER,
  ROLE_INTENTS.AI_SYSTEMS_COLLABORATOR
]);

function roleIntentOverridesService(roleIntent, serviceIntent) {
  if (!PROVIDER_ROLES.has(roleIntent)) return false;
  return [
    SERVICE_INTENTS.TRANSLATION,
    SERVICE_INTENTS.LANGUAGE_COURSES,
    SERVICE_INTENTS.INTERPRETING,
    SERVICE_INTENTS.TECH_SERVICES,
    SERVICE_INTENTS.AI_AUTOMATION,
    SERVICE_INTENTS.PROVIDER_INTAKE,
    SERVICE_INTENTS.UNKNOWN,
    SERVICE_INTENTS.FUTURE_DOMAIN
  ].includes(serviceIntent);
}

function isCustomerRole(roleIntent) {
  return [ROLE_INTENTS.CUSTOMER, ROLE_INTENTS.LEARNER, ROLE_INTENTS.SUPPORT_SEEKER, ROLE_INTENTS.ADVISOR_REQUEST].includes(roleIntent);
}

function resolveGeneralizedRouting({ text = "", previousBranch = "none", previousRoleIntent = null, previousServiceIntent = null, platform = "unknown", language = null } = {}) {
  const detectedLanguage = language || detectRoutingLanguage(text, "en");
  const role = detectRoleIntent(text);
  const service = detectServiceIntent(text);
  const providerBranchActive = /provider|collaboration|freelancer|job|applicant|teacher|trainer|translator|interpreter|tech|ai/i.test(String(previousBranch || ""))
    || PROVIDER_ROLES.has(previousRoleIntent);
  const strongCustomerShift = isCustomerRole(role.intent) && role.score >= 4;
  const overrideTriggered = roleIntentOverridesService(role.intent, service.intent);
  const branchRetained = providerBranchActive && !strongCustomerShift && (role.intent === ROLE_INTENTS.UNKNOWN || PROVIDER_ROLES.has(role.intent));
  const ambiguous = !overrideTriggered
    && !branchRetained
    && role.intent !== ROLE_INTENTS.UNKNOWN
    && service.intent !== SERVICE_INTENTS.UNKNOWN
    && ((PROVIDER_ROLES.has(role.intent) && isCustomerRole(previousRoleIntent)) || (isCustomerRole(role.intent) && PROVIDER_ROLES.has(previousRoleIntent)));

  let route = "general_safe_handoff";
  let reason = "default_safe_handoff";
  if (overrideTriggered || branchRetained) {
    route = "provider_collaboration";
    reason = overrideTriggered ? `role_override_${role.reason}` : "provider_branch_retained";
  } else if (ambiguous) {
    route = "clarification";
    reason = "role_service_ambiguity";
  } else if (service.intent === SERVICE_INTENTS.TRANSLATION) {
    route = "translation_client";
    reason = service.reason;
  } else if (service.intent === SERVICE_INTENTS.LANGUAGE_COURSES) {
    route = role.intent === ROLE_INTENTS.TEACHER_TRAINER ? "provider_collaboration" : "courses";
    reason = role.intent === ROLE_INTENTS.TEACHER_TRAINER ? "teacher_role_override" : service.reason;
  } else if (service.intent === SERVICE_INTENTS.INTERPRETING) {
    route = "interpreting";
    reason = service.reason;
  } else if ([SERVICE_INTENTS.TECH_SERVICES, SERVICE_INTENTS.AI_AUTOMATION].includes(service.intent)) {
    route = PROVIDER_ROLES.has(role.intent) ? "provider_collaboration" : "advisor";
    reason = PROVIDER_ROLES.has(role.intent) ? `future_domain_role_override_${role.reason}` : service.reason;
  } else if (service.intent === SERVICE_INTENTS.SUPPORT_ADVISOR) {
    route = "advisor";
    reason = service.reason;
  } else if (service.intent === SERVICE_INTENTS.CERTIFICATE) {
    route = "certificates";
    reason = service.reason;
  }

  return {
    platform,
    detectedLanguage,
    roleIntent: role.intent,
    roleReason: role.reason,
    roleScore: role.score,
    serviceIntent: service.intent,
    serviceReason: service.reason,
    serviceScore: service.score,
    previousBranch: previousBranch || "none",
    previousRoleIntent: previousRoleIntent || null,
    previousServiceIntent: previousServiceIntent || null,
    route,
    reason,
    overrideTriggered,
    branchRetained,
    clarificationTriggered: ambiguous,
    fallbackReason: route === "general_safe_handoff" ? reason : "none",
    roleMatches: role.matches,
    serviceMatches: service.matches
  };
}

module.exports = {
  SUPPORTED_ROUTING_LANGUAGES,
  ROLE_INTENTS,
  SERVICE_INTENTS,
  PROVIDER_ROLES,
  normalizeRoutingText,
  detectRoutingLanguage,
  detectRoleIntent,
  detectServiceIntent,
  roleIntentOverridesService,
  resolveGeneralizedRouting
};
