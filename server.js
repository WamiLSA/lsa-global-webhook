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
const { AI_TOOLS_CATALOG } = require("./lib/ai-tools-catalog");
const { createAutomationHub } = require("./lib/automation-hub");
const {
  SUPPORTED_ROUTING_LANGUAGES,
  detectRoutingLanguage,
  resolveGeneralizedRouting
} = require("./lib/routing-intelligence");

const crypto = require("crypto");

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
const SUPABASE_URL = process.env.SUPABASE_URL?.trim();
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
  process.env.SUPABASE_SECRET_KEY?.trim() ||
  process.env.SUPABASE_ANON_KEY?.trim();
const OPENAI_API_KEY = process.env.OPENAI_API_KEY?.trim();
const APP_ENV = String(process.env.APP_ENV || "live").toLowerCase();
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || "LSA_GLOBAL_TOKEN";
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const INBOX_USERNAME = process.env.INBOX_USERNAME;
const INBOX_PASSWORD = process.env.INBOX_PASSWORD;
const WHATSAPP_GRAPH_VERSION = process.env.WHATSAPP_GRAPH_VERSION || "v18.0";
const AI_AUTOREPLY_ENABLED = String(process.env.AI_AUTOREPLY_ENABLED || "false").toLowerCase() === "true";
const AI_EXPERIMENTS_ENABLED = String(process.env.AI_EXPERIMENTS_ENABLED || "false").toLowerCase() === "true";
const TEST_RETRIEVAL_FORCE_ENABLE = String(process.env.TEST_RETRIEVAL_FORCE_ENABLE || "false").toLowerCase() === "true";
const INTERNAL_MODE_ADMIN_USERS = String(process.env.INTERNAL_MODE_ADMIN_USERS || "")
  .split(",")
  .map(item => item.trim().toLowerCase())
  .filter(Boolean);
const MEDIA_STORAGE_DIR = path.join(__dirname, "uploads", "whatsapp");
const SYSTEM_MODE_FILE = path.join(__dirname, "data", "system-mode.json");
const SYSTEM_MODE_CONFIG_KEY = "system_mode";
const ACCOUNT_SETTINGS_CONFIG_KEY = "account_settings_store";
const FALLBACK_BRAND_NAME = "LSA GLOBAL";
const SYSTEM_MODE_REFRESH_MS = Number(process.env.SYSTEM_MODE_REFRESH_MS || 5000);
const automationHub = createAutomationHub({
  getSystemMode: () => runtimeSystemState.mode
});

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



const PROFILE_AVATAR_STORAGE_DIR = path.join(__dirname, "uploads", "profile-avatars");
const avatarUploadStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.mkdir(PROFILE_AVATAR_STORAGE_DIR, { recursive: true });
      cb(null, PROFILE_AVATAR_STORAGE_DIR);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const originalName = (file.originalname || "avatar").replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${originalName.slice(0, 120)}`);
  }
});

const avatarUpload = multer({
  storage: avatarUploadStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const mimeType = String(file.mimetype || "").toLowerCase();
    if (!mimeType.startsWith("image/")) {
      cb(new Error("Avatar must be an image file."));
      return;
    }
    cb(null, true);
  }
});

const BRANDING_STORAGE_DIR = path.join(__dirname, "uploads", "branding");
const brandingLogoUploadStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.mkdir(BRANDING_STORAGE_DIR, { recursive: true });
      cb(null, BRANDING_STORAGE_DIR);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const originalName = (file.originalname || "branding-logo").replace(/[^a-zA-Z0-9._-]/g, "_");
    const timestamp = Date.now();
    cb(null, `branding-logo-${timestamp}-${originalName}`);
  }
});
const brandingLogoUpload = multer({
  storage: brandingLogoUploadStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const mimeType = String(file.mimetype || "").toLowerCase();
    if (mimeType.startsWith("image/")) return cb(null, true);
    cb(new Error("Branding logo must be an image file."));
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

const PROVIDER_DOCUMENTS_STORAGE_DIR = path.join(__dirname, "uploads", "provider-documents");
const PROVIDER_DOCUMENT_ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/rtf",
  "text/rtf",
  "text/plain",
  "application/zip"
]);
const PROVIDER_DOCUMENT_ALLOWED_EXTENSIONS = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".rtf",
  ".txt",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".zip"
]);
const PROVIDER_DOCUMENT_TYPES = new Set([
  "CV",
  "Certificate",
  "Company Profile",
  "Contract",
  "Portfolio",
  "Reference",
  "Other"
]);

function sanitizeProviderFolder(providerId) {
  return String(providerId || "").replace(/[^a-zA-Z0-9_-]/g, "");
}

const providerDocumentUploadStorage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const providerFolder = sanitizeProviderFolder(req.params.providerId);
      if (!providerFolder) {
        cb(new Error("Provider id is required for document upload."));
        return;
      }
      const providerPath = path.join(PROVIDER_DOCUMENTS_STORAGE_DIR, providerFolder);
      await fs.mkdir(providerPath, { recursive: true });
      cb(null, providerPath);
    } catch (error) {
      cb(error);
    }
  },
  filename: (req, file, cb) => {
    const originalName = (file.originalname || "provider_document").replace(/[^a-zA-Z0-9._-]/g, "_");
    cb(null, `${Date.now()}_${originalName.slice(0, 120)}`);
  }
});

const providerDocumentUpload = multer({
  storage: providerDocumentUploadStorage,
  limits: {
    fileSize: 25 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const mimeType = String(file.mimetype || "").toLowerCase();
    const extension = path.extname(String(file.originalname || "")).toLowerCase();
    const isAllowed = PROVIDER_DOCUMENT_ALLOWED_MIME_TYPES.has(mimeType)
      || mimeType.startsWith("image/")
      || PROVIDER_DOCUMENT_ALLOWED_EXTENSIONS.has(extension);
    if (!isAllowed) {
      cb(new Error("Unsupported file type for Provider Documents."));
      return;
    }
    cb(null, true);
  }
});

const PROVIDER_DOCUMENTS_PREFERRED_COLUMNS = [
  "id",
  "provider_id",
  "file_name",
  "original_name",
  "file_path",
  "file_url",
  "mime_type",
  "file_size",
  "document_type",
  "notes",
  "uploaded_at",
  "uploaded_by",
  "created_at"
];
let providerDocumentsColumnsCache = null;
let providerDocumentsColumnsCachedAt = 0;
const PROVIDER_DOCUMENTS_COLUMNS_CACHE_TTL_MS = 60 * 1000;

async function getProviderDocumentsColumnSet() {
  const now = Date.now();
  if (
    providerDocumentsColumnsCache
    && (now - providerDocumentsColumnsCachedAt) < PROVIDER_DOCUMENTS_COLUMNS_CACHE_TTL_MS
  ) {
    return providerDocumentsColumnsCache;
  }

  const { data, error } = await supabase
    .from("information_schema.columns")
    .select("column_name")
    .eq("table_schema", "public")
    .eq("table_name", "provider_documents");

  if (error) {
    return null;
  }

  providerDocumentsColumnsCache = new Set((data || []).map(row => row.column_name));
  providerDocumentsColumnsCachedAt = now;
  return providerDocumentsColumnsCache;
}

function providerDocumentsSelectColumns(columnSet) {
  if (!(columnSet instanceof Set)) {
    return [
      "id",
      "provider_id",
      "file_name",
      "original_name",
      "mime_type",
      "file_size",
      "document_type",
      "notes",
      "file_url",
      "created_at"
    ];
  }
  const selected = PROVIDER_DOCUMENTS_PREFERRED_COLUMNS.filter(column => columnSet.has(column));
  if (!selected.length) {
    return ["id", "provider_id", "file_name"];
  }
  return selected;
}

function getProviderDocumentsOrderColumn(columnSet, blockedColumns = new Set()) {
  if (!(columnSet instanceof Set)) return null;
  if (columnSet.has("uploaded_at") && !blockedColumns.has("uploaded_at")) return "uploaded_at";
  if (columnSet.has("created_at") && !blockedColumns.has("created_at")) return "created_at";
  return null;
}

async function queryProviderDocumentsWithSchemaFallback({
  providerId,
  columnSet,
  filterId = null,
  maxAttempts = 3
}) {
  const blockedColumns = new Set();

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let selectColumns = providerDocumentsSelectColumns(columnSet).filter(column => !blockedColumns.has(column));
    if (!selectColumns.length) {
      selectColumns = ["id", "provider_id", "file_name"];
    }

    const orderColumn = getProviderDocumentsOrderColumn(columnSet, blockedColumns);
    let query = supabase
      .from("provider_documents")
      .select(selectColumns.join(", "))
      .eq("provider_id", providerId);

    if (filterId) {
      query = query.eq("id", filterId);
    }

    if (orderColumn && !filterId) {
      query = query.order(orderColumn, { ascending: false });
    }

    const { data, error } = await query;
    if (!error) {
      return { data, error: null, blockedColumns };
    }

    const missingColumn = extractMissingColumnName(error);
    const missingSelectable = missingColumn && selectColumns.includes(missingColumn);
    const missingOrdered = missingColumn && orderColumn === missingColumn;
    if (!missingSelectable && !missingOrdered) {
      return { data: null, error, blockedColumns };
    }

    blockedColumns.add(missingColumn);
  }

  return {
    data: null,
    error: {
      message: "Provider documents query failed due to repeated schema mismatch on metadata columns."
    },
    blockedColumns
  };
}

function normalizeProviderDocumentRow(row, providerId) {
  const fileName = row.file_name || row.file_path || "file";
  const fileUrl = row.file_url
    || (row.file_path ? `/uploads/provider-documents/${sanitizeProviderFolder(providerId)}/${row.file_path}` : null)
    || `/uploads/provider-documents/${sanitizeProviderFolder(providerId)}/${fileName}`;
  return {
    id: row.id,
    provider_id: row.provider_id,
    file_name: fileName,
    original_name: row.original_name || fileName,
    file_path: row.file_path || fileName,
    file_url: fileUrl,
    mime_type: row.mime_type || null,
    file_size: row.file_size || null,
    document_type: row.document_type || "Other",
    notes: row.notes || null,
    uploaded_at: row.uploaded_at || row.created_at || null,
    uploaded_by: row.uploaded_by || null,
    created_at: row.created_at || row.uploaded_at || null
  };
}

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

if (!SUPABASE_URL) {
  throw new Error("Missing SUPABASE_URL environment variable");
}

if (!SUPABASE_KEY) {
  throw new Error("Missing Supabase key. Set SUPABASE_SERVICE_ROLE_KEY, SUPABASE_SECRET_KEY, or SUPABASE_ANON_KEY.");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const openai = OPENAI_API_KEY ? new OpenAI({ apiKey: OPENAI_API_KEY }) : null;
if (!OPENAI_API_KEY) {
  console.warn("[ai] OPENAI_API_KEY missing: AI-enhanced features disabled; deterministic messaging remains active.");
}
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
  updatedAt: new Date().toISOString(),
  lastRefreshedAt: new Date(0).toISOString()
};

async function persistSystemMode(mode) {
  await fs.mkdir(path.dirname(SYSTEM_MODE_FILE), { recursive: true });
  await fs.writeFile(
    SYSTEM_MODE_FILE,
    JSON.stringify({ mode, updated_at: new Date().toISOString() }, null, 2),
    "utf-8"
  );
}

async function readPersistedSystemModeFromDatabase() {
  try {
    const { data, error } = await supabase
      .from("app_config")
      .select("value, updated_at")
      .eq("key", SYSTEM_MODE_CONFIG_KEY)
      .maybeSingle();
    if (error) {
      console.warn("[mode] Failed to read mode from app_config:", error.message);
      return null;
    }
    const dbMode = String(data?.value || "").toLowerCase();
    if (dbMode !== "test" && dbMode !== "live") {
      return null;
    }
    return {
      mode: dbMode,
      updatedAt: data?.updated_at || new Date().toISOString()
    };
  } catch (error) {
    console.warn("[mode] Unexpected DB mode read failure:", error.message || error);
    return null;
  }
}

async function persistSystemModeToDatabase(mode) {
  const payload = {
    key: SYSTEM_MODE_CONFIG_KEY,
    value: mode,
    updated_at: new Date().toISOString()
  };
  const { error } = await supabase
    .from("app_config")
    .upsert(payload, { onConflict: "key" });
  if (error) {
    throw new Error(`Unable to persist mode in app_config: ${error.message}`);
  }
}

async function refreshRuntimeSystemMode() {
  const now = Date.now();
  const lastRefreshedAt = Date.parse(runtimeSystemState.lastRefreshedAt || 0) || 0;
  if (now - lastRefreshedAt < SYSTEM_MODE_REFRESH_MS) {
    return runtimeSystemState.mode;
  }
  const persisted = await readPersistedSystemModeFromDatabase();
  runtimeSystemState.lastRefreshedAt = new Date(now).toISOString();
  if (persisted && persisted.mode !== runtimeSystemState.mode) {
    runtimeSystemState.mode = persisted.mode;
    runtimeSystemState.updatedAt = persisted.updatedAt;
    console.log(`[mode] Runtime mode refreshed from DB: ${persisted.mode.toUpperCase()}`);
  }
  return runtimeSystemState.mode;
}

async function getCurrentSystemMode() {
  await refreshRuntimeSystemMode();
  return runtimeSystemState.mode;
}

async function isTestModeEnabled() {
  const mode = await getCurrentSystemMode();
  return mode === "test";
}

async function isAutonomousReplyAllowed() {
  return (await isTestModeEnabled()) && AI_EXPERIMENTS_ENABLED && AI_AUTOREPLY_ENABLED;
}
async function isTestRetrievalEnabled() {
  return (await isTestModeEnabled()) || TEST_RETRIEVAL_FORCE_ENABLE;
}

async function canRunTestRetrievalExperiments() {
  return await isTestRetrievalEnabled();
}

function isOpenAiQuotaOrBillingError(error) {
  const status = Number(error?.status || error?.response?.status || 0);
  const code = String(error?.code || error?.error?.code || error?.response?.data?.error?.code || "").toLowerCase();
  const message = String(error?.message || error?.response?.data?.error?.message || "").toLowerCase();
  return status === 429 || code.includes("insufficient_quota") || code.includes("billing") || message.includes("quota") || message.includes("billing");
}

function logAiLayerFailure(error, context = "unknown") {
  const quotaRelated = isOpenAiQuotaOrBillingError(error);
  console.warn("[ai-layer-fallback]", {
    context,
    quota_related: quotaRelated,
    status: error?.status || error?.response?.status || null,
    code: error?.code || error?.error?.code || error?.response?.data?.error?.code || null,
    message: error?.message || error?.response?.data?.error?.message || String(error)
  });
}

function formatRoutingBranchForModeLog(branch) {
  if (!branch) return "unknown";
  if (String(branch).startsWith("test_retrieval")) return "test_retrieval";
  if (branch === "live_menu_fallback") return "safe_handoff";
  if (branch === "live_safe_handoff") return "safe_handoff";
  return branch;
}

function logInboundRoutingDecision({
  mode,
  branch,
  text,
  normalizedText = "",
  testRetrievalEnabled = false,
  reason = "none",
  retrievalBlocked = false,
  retrievalBlockedReason = "none",
  controlledAction = "none",
  detectedLanguage = "unknown",
  roleIntent = "unknown",
  serviceIntent = "unknown",
  overrideTriggered = false,
  clarificationTriggered = false,
  activeBranchBefore = "none",
  activeBranchAfter = "none",
  platformContext = "unknown"
}) {
  const resolvedMode = String(mode || "live").toLowerCase() === "test" ? "TEST" : "LIVE";
  const resolvedBranch = formatRoutingBranchForModeLog(branch);
  const safeText = String(text || "").replace(/"/g, '\\"').slice(0, 160);
  const safeNormalizedText = String(normalizedText || "").replace(/"/g, '\\"').slice(0, 160);
  const safeReason = String(reason || "none").replace(/"/g, '\\"').slice(0, 120);
  const safeRetrievalBlockedReason = String(retrievalBlockedReason || "none").replace(/"/g, '\\"').slice(0, 120);
  const safeControlledAction = String(controlledAction || "none").replace(/"/g, '\"').slice(0, 120);
  const safeLanguage = String(detectedLanguage || "unknown").replace(/"/g, '\"').slice(0, 20);
  const safeRoleIntent = String(roleIntent || "unknown").replace(/"/g, '\"').slice(0, 80);
  const safeServiceIntent = String(serviceIntent || "unknown").replace(/"/g, '\"').slice(0, 80);
  const safeBranchBefore = String(activeBranchBefore || "none").replace(/"/g, '\"').slice(0, 120);
  const safeBranchAfter = String(activeBranchAfter || "none").replace(/"/g, '\"').slice(0, 120);
  const safePlatformContext = String(platformContext || "unknown").replace(/"/g, '\"').slice(0, 80);
  console.log(`[routing-runtime] mode=${resolvedMode} text="${safeText}" normalized_text="${safeNormalizedText}" test_retrieval_enabled=${testRetrievalEnabled ? "true" : "false"} branch=${resolvedBranch} reason=${safeReason} retrieval_blocked=${retrievalBlocked ? "true" : "false"} retrieval_blocked_reason=${safeRetrievalBlockedReason} controlled_action=${safeControlledAction} detected_language=${safeLanguage} service_intent=${safeServiceIntent} role_intent=${safeRoleIntent} override_triggered=${overrideTriggered ? "true" : "false"} clarification_triggered=${clarificationTriggered ? "true" : "false"} active_branch_before=${safeBranchBefore} active_branch_after=${safeBranchAfter} platform_context=${safePlatformContext} mode_source=app_config`);
}

async function retrieveInternalKnowledgeForTestMode(query, options = {}) {
  if (!(await canRunTestRetrievalExperiments())) {
    return {
      normalized_query: "",
      detected_language: detectMessageLanguage(query || ""),
      intent: "general",
      requested_field: null,
      entity: null,
      entity_domain: null,
      matches: [],
      debug: options.debug ? { fallback_reason: "test_retrieval_disabled" } : undefined
    };
  }
  return retrieveInternalKnowledge(query, options);
}


function getModeCapabilities() {
  return {
    autonomous_ai_answering: runtimeSystemState.mode === "test" && AI_EXPERIMENTS_ENABLED && AI_AUTOREPLY_ENABLED,
    ai_experimentation: runtimeSystemState.mode === "test" || TEST_RETRIEVAL_FORCE_ENABLE
  };
}

console.log(`[mode] APP_ENV=${APP_ENV} | IS_TEST_ENV=${IS_TEST_MODE ? "true" : "false"} | START_MODE=${runtimeSystemState.mode.toUpperCase()}`);
console.log(`[safety] AI_EXPERIMENTS_ENABLED=${AI_EXPERIMENTS_ENABLED ? "true" : "false"} | AI_AUTOREPLY_ENABLED=${AI_AUTOREPLY_ENABLED ? "true" : "false"} | TEST_RETRIEVAL_FORCE_ENABLE=${TEST_RETRIEVAL_FORCE_ENABLE ? "true" : "false"} | AUTONOMOUS_REPLY_ALLOWED=${runtimeSystemState.mode === "test" && AI_EXPERIMENTS_ENABLED && AI_AUTOREPLY_ENABLED ? "true" : "false"}`);

async function requireAiExperimentMode(res) {
  if (await canRunTestRetrievalExperiments()) return true;
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

const ACCOUNT_SETTINGS_FILE = path.join(__dirname, "data", "account-settings.json");
const COMMUNICATIONS_LAYER_FILE = path.join(__dirname, "data", "communications-layer.json");

function buildDefaultCommunicationsLayerState() {
  return {
    mail: {
      threads: [
        {
          thread_id: "mail-demo-001",
          sender: "contact@client-example.net",
          recipients: ["operations@lsa.global"],
          subject: "Request for certified translation timeline",
          preview: "Hello, please confirm delivery timeline for three certified documents.",
          timestamp: new Date().toISOString(),
          is_read: false,
          is_archived: false,
          entries: [
            {
              entry_id: "mail-entry-001",
              sender: "contact@client-example.net",
              recipients: ["operations@lsa.global"],
              subject: "Request for certified translation timeline",
              preview: "Hello, please confirm delivery timeline for three certified documents.",
              body: "Hello, please confirm delivery timeline for three certified documents.",
              timestamp: new Date().toISOString(),
              is_read: false,
              channel: "mail"
            }
          ],
          channel: "mail",
          source: "email"
        }
      ]
    },
    forms: { queue: [] },
    signature_manager: {
      default_signature_id: null,
      signatures: [],
      allow_no_signature: true
    },
    reply_templates: []
  };
}

async function readCommunicationsLayerState() {
  try {
    const raw = await fs.readFile(COMMUNICATIONS_LAYER_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : buildDefaultCommunicationsLayerState();
  } catch (error) {
    if (error.code === "ENOENT") return buildDefaultCommunicationsLayerState();
    throw error;
  }
}

async function writeCommunicationsLayerState(state) {
  await fs.mkdir(path.dirname(COMMUNICATIONS_LAYER_FILE), { recursive: true });
  await fs.writeFile(COMMUNICATIONS_LAYER_FILE, JSON.stringify(state, null, 2));
}


function normalizeUserIdentifier(value) {
  return String(value || "").trim().toLowerCase();
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = crypto.pbkdf2Sync(String(password), salt, 100000, 64, "sha512").toString("hex");
  return `pbkdf2$100000$${salt}$${derived}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== "string") return false;
  const [scheme, rounds, salt, expected] = storedHash.split("$");
  if (scheme !== "pbkdf2" || !rounds || !salt || !expected) return false;
  const derived = crypto.pbkdf2Sync(String(password), salt, Number(rounds), 64, "sha512").toString("hex");
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(derived, "hex"));
}

async function readLocalAccountSettingsStore() {
  try {
    const raw = await fs.readFile(ACCOUNT_SETTINGS_FILE, "utf8");
    const data = JSON.parse(raw);
    return data && typeof data === "object" ? data : { users: {} };
  } catch (error) {
    if (error.code === "ENOENT") return { users: {} };
    throw error;
  }
}

async function writeLocalAccountSettingsStore(store) {
  await fs.mkdir(path.dirname(ACCOUNT_SETTINGS_FILE), { recursive: true });
  await fs.writeFile(ACCOUNT_SETTINGS_FILE, JSON.stringify(store, null, 2));
}

async function readAccountSettingsStoreFromDatabase() {
  try {
    const { data, error } = await supabase
      .from("app_config")
      .select("value")
      .eq("key", ACCOUNT_SETTINGS_CONFIG_KEY)
      .maybeSingle();
    if (error) {
      console.warn("[settings] Failed to read account settings from app_config:", error.message);
      return null;
    }
    if (!data?.value) return null;
    const parsed = JSON.parse(data.value);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    console.warn("[settings] Unexpected app_config settings read failure:", error.message || error);
    return null;
  }
}

async function persistAccountSettingsStoreToDatabase(store) {
  const payload = {
    key: ACCOUNT_SETTINGS_CONFIG_KEY,
    value: JSON.stringify(store || { users: {} }),
    updated_at: new Date().toISOString()
  };
  const { error } = await supabase
    .from("app_config")
    .upsert(payload, { onConflict: "key" });
  if (error) {
    throw new Error(`Unable to persist account settings in app_config: ${error.message}`);
  }
}

async function readAccountSettingsStore() {
  const databaseStore = await readAccountSettingsStoreFromDatabase();
  if (databaseStore) return databaseStore;

  const localStore = await readLocalAccountSettingsStore();
  if (Object.keys(localStore.users || {}).length || localStore.branding) {
    try {
      await persistAccountSettingsStoreToDatabase(localStore);
      console.log("[settings] Migrated local account settings store to app_config.");
    } catch (error) {
      console.warn("[settings] Local settings migration to app_config failed:", error.message || error);
    }
  }
  return localStore;
}

async function writeAccountSettingsStore(store) {
  await persistAccountSettingsStoreToDatabase(store);
  try {
    await writeLocalAccountSettingsStore(store);
  } catch (error) {
    console.warn("[settings] Local settings mirror write failed after app_config persistence:", error.message || error);
  }
}

async function brandingLogoFileToDataUrl(file) {
  const mimeType = String(file?.mimetype || "image/png").toLowerCase();
  const raw = await fs.readFile(file.path);
  return `data:${mimeType};base64,${raw.toString("base64")}`;
}

function buildDefaultUserRecord(username) {
  const normalized = normalizeUserIdentifier(username || INBOX_USERNAME);
  return {
    username: normalized,
    first_name: "",
    last_name: "",
    display_name: normalized,
    email: "",
    avatar_url: "",
    password_hash: null,
    updated_at: new Date().toISOString()
  };
}

function sanitizeProfileInput(input, existing) {
  const normalizedUsername = normalizeUserIdentifier(input.username || existing.username || INBOX_USERNAME);
  if (!normalizedUsername) throw new Error("Username is required");
  const email = String(input.email || "").trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email format");
  return {
    first_name: String(input.first_name || "").trim(),
    last_name: String(input.last_name || "").trim(),
    display_name: String(input.display_name || "").trim() || normalizedUsername,
    username: normalizedUsername,
    email,
    avatar_url: String(input.avatar_url || "").trim()
  };
}

const DEFAULT_BRANDING_SETTINGS = Object.freeze({
  brand_name: FALLBACK_BRAND_NAME,
  logo_url: "",
  logo_file_url: "",
  primary_color: "#0B3A8C",
  dark_primary_color: "#072C70",
  accent_color: "#C81E1E",
  text_on_primary: "#FFFFFF",
  animation_style: "fade-zoom"
});

function pickPersistedValue(input, previous, key, fallback) {
  if (Object.prototype.hasOwnProperty.call(input || {}, key)) return input[key];
  if (Object.prototype.hasOwnProperty.call(previous || {}, key)) return previous[key];
  return fallback;
}

function sanitizeBrandingInput(input = {}, existing = {}) {
  const previous = existing && typeof existing === "object" ? existing : {};
  const next = {
    brand_name: String(pickPersistedValue(input, previous, "brand_name", DEFAULT_BRANDING_SETTINGS.brand_name) || "").trim() || DEFAULT_BRANDING_SETTINGS.brand_name,
    logo_url: String(pickPersistedValue(input, previous, "logo_url", DEFAULT_BRANDING_SETTINGS.logo_url) || "").trim(),
    logo_file_url: String(pickPersistedValue(input, previous, "logo_file_url", DEFAULT_BRANDING_SETTINGS.logo_file_url) || "").trim(),
    primary_color: String(pickPersistedValue(input, previous, "primary_color", DEFAULT_BRANDING_SETTINGS.primary_color) || "").trim() || DEFAULT_BRANDING_SETTINGS.primary_color,
    dark_primary_color: String(pickPersistedValue(input, previous, "dark_primary_color", DEFAULT_BRANDING_SETTINGS.dark_primary_color) || "").trim() || DEFAULT_BRANDING_SETTINGS.dark_primary_color,
    accent_color: String(pickPersistedValue(input, previous, "accent_color", DEFAULT_BRANDING_SETTINGS.accent_color) || "").trim() || DEFAULT_BRANDING_SETTINGS.accent_color,
    text_on_primary: String(pickPersistedValue(input, previous, "text_on_primary", DEFAULT_BRANDING_SETTINGS.text_on_primary) || "").trim() || DEFAULT_BRANDING_SETTINGS.text_on_primary,
    animation_style: String(pickPersistedValue(input, previous, "animation_style", DEFAULT_BRANDING_SETTINGS.animation_style) || "").trim() || DEFAULT_BRANDING_SETTINGS.animation_style
  };
  return next;
}

function getBrandingSettings(store) {
  return sanitizeBrandingInput(store?.branding || {}, {});
}

async function getUserSettings(identifier) {
  const normalized = normalizeUserIdentifier(identifier || INBOX_USERNAME);
  const store = await readAccountSettingsStore();
  const users = store.users || {};
  const record = users[normalized] || buildDefaultUserRecord(normalized);
  return { store, normalized, record, users };
}

function findUserRecordByUsername(users, username) {
  const normalizedUsername = normalizeUserIdentifier(username);
  if (!normalizedUsername) return null;
  const direct = users[normalizedUsername];
  if (direct) return { key: normalizedUsername, record: direct };
  for (const [key, record] of Object.entries(users)) {
    if (normalizeUserIdentifier(record?.username) === normalizedUsername) {
      return { key, record };
    }
  }
  return null;
}

async function verifyInboxCredentials(username, password) {
  const normalizedUsername = normalizeUserIdentifier(username);
  if (!normalizedUsername || !password) return { ok: false };

  const store = await readAccountSettingsStore();
  store.users = store.users || {};
  const matchedUser = findUserRecordByUsername(store.users, normalizedUsername);

  if (matchedUser) {
    const { key, record } = matchedUser;
    if (record.password_hash) {
      if (!verifyPassword(password, record.password_hash)) return { ok: false };
    } else {
      const bootstrapMatches = normalizedUsername === normalizeUserIdentifier(INBOX_USERNAME) && password === INBOX_PASSWORD;
      if (!bootstrapMatches) return { ok: false };
    }
    const canonicalUsername = normalizeUserIdentifier(record.username || key || normalizedUsername);
    return { ok: true, username: canonicalUsername };
  }

  if (normalizedUsername === normalizeUserIdentifier(INBOX_USERNAME) && password === INBOX_PASSWORD) {
    return { ok: true, username: normalizeUserIdentifier(INBOX_USERNAME), bootstrap: true };
  }

  return { ok: false };
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
      <title>LSA GLOBAL Login</title>
      <style>
        :root {
          --brand-primary: #0B3A8C;
          --brand-primary-dark: #072C70;
          --brand-text: #FFFFFF;
          --brand-accent: #C81E1E;
        }
        body {
          font-family: Arial, sans-serif;
          background: linear-gradient(135deg, var(--brand-primary), var(--brand-primary-dark));
          display: flex;
          justify-content: center;
          align-items: center;
          height: 100vh;
          margin: 0;
        }
        .entry-wrap { width: min(420px, 92vw); animation: fadeIn 420ms ease-out; }
        .brand-stage {
          color: var(--brand-text);
          display: flex;
          align-items: center;
          justify-content: center;
          flex-direction: column;
          margin-bottom: 14px;
          animation: logoRise 700ms ease-out;
        }
        .brand-logo {
          width: 96px;
          height: 96px;
          object-fit: contain;
          margin-bottom: 8px;
          filter: drop-shadow(0 6px 18px rgba(0,0,0,0.25));
        }
        .box {
          width: 100%;
          background: rgba(255,255,255,0.97);
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
          border: 0;
          border-radius: 8px;
          background: var(--brand-primary);
          color: var(--brand-text);
          font-weight: 700;
        }
        .err {
          color: #b91c1c;
          margin-bottom: 12px;
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        @keyframes logoRise { from { transform: translateY(6px) scale(0.96); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
      </style>
    </head>
    <body>
      <div class="entry-wrap">
        <div class="brand-stage">
          <img id="brandLogo" class="brand-logo" alt="LSA GLOBAL logo" hidden />
          <h2 id="brandNameText">LSA GLOBAL</h2>
        </div>
        <div class="box">
        ${req.query.error ? '<div class="err">Invalid username or password.</div>' : ""}
        <form method="POST" action="/login">
          <input type="text" name="username" placeholder="Username" required />
          <input type="password" name="password" placeholder="Password" required />
          <button type="submit">Login</button>
        </form>
      </div>
      </div>
      <script>
        (async function loadBranding() {
          try {
            const res = await fetch('/api/branding/settings');
            const payload = await res.json();
            const branding = payload.branding || {};
            const root = document.documentElement;
            if (branding.primary_color) root.style.setProperty('--brand-primary', branding.primary_color);
            if (branding.dark_primary_color) root.style.setProperty('--brand-primary-dark', branding.dark_primary_color);
            if (branding.text_on_primary) root.style.setProperty('--brand-text', branding.text_on_primary);
            if (branding.accent_color) root.style.setProperty('--brand-accent', branding.accent_color);
            const brandText = branding.brand_name || 'LSA GLOBAL';
            const title = document.getElementById('brandNameText');
            if (title) title.textContent = brandText;
            const logo = document.getElementById('brandLogo');
            if (logo && branding.logo_url) {
              logo.src = branding.logo_url;
              logo.hidden = false;
            }
          } catch (error) {}
        })();
      </script>
    </body>
    </html>
  `);
});

app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const authResult = await verifyInboxCredentials(username, password);
  if (authResult.ok) {
    req.session.authenticated = true;
    req.session.username = authResult.username;
    return res.redirect("/inbox");
  }

  return res.redirect("/login?error=1");
});



function createMobileAuthToken(username) {
  return Buffer.from(`${normalizeUserIdentifier(username)}:${Date.now()}`).toString("base64url");
}

function requestUsesBearerAuth(req) {
  return String(req.headers.authorization || "").startsWith("Bearer ");
}

app.post("/api/mobile/auth/login", async (req, res) => {
  const { username, password } = req.body || {};

  const authResult = await verifyInboxCredentials(username, password);
  if (!authResult.ok) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  return res.json({
    token: createMobileAuthToken(authResult.username),
    user: { username: authResult.username }
  });
});

app.get("/api/branding/settings", async (req, res) => {
  try {
    const store = await readAccountSettingsStore();
    return res.json({ ok: true, branding: getBrandingSettings(store) });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
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
  certification: ["certificate", "certification", "attestation", "testimonial", "proof", "verification", "certificat", "certificado", "certificato", "zertifikat", "nachweis"],
  payment_options: ["payment", "payments", "payment options", "installment", "installments", "paiement", "tranche", "tranches", "versement"],
  turnaround: ["turnaround", "delivery time", "processing time", "délai", "delai", "urgent", "rush"],
  requirements: ["requirements", "required", "documents", "documents needed", "pieces", "pièces", "conditions", "needed"],
  refund_policy: ["refund", "refunds", "refund policy", "remboursement", "rembolso", "rimborso"],
  contact: ["contact", "contacts", "phone", "email", "whatsapp", "address", "coordonnées", "coordonnees"],
  availability: ["availability", "available", "disponibilite", "disponibilité", "available slots", "places left", "remaining seats", "openings", "business hours", "opening hours", "hours"]
};

const NARROW_INTENT_ALIASES = {
  fee: "fees",
  exam: "certification",
  course: null,
  payment: "payment_options",
  payments: "payment_options",
  documents: "requirements",
  requirement: "requirements",
  refund: "refund_policy",
  availability: "availability",
  hours: "availability"
};

const MENU_KEYWORDS = {
  translation: ["1", "translation", "traduction", "traduccion", "traduzione", "übersetzung", "ubersetzung", "traducao", "tradução"],
  courses: ["2", "course", "courses", "cours", "curso", "corsi", "kurse", "formacion", "formação", "formation"],
  interpreting: ["3", "interpreting", "interpretation", "interpretariat", "interpretazione", "interpretacion", "interpretação"],
  advisor: ["4", "advisor", "adviser", "human", "agent", "conseiller", "asesor", "berater", "consulente"]
};

const GREETING_PHRASES = {
  en: ["hello", "hi", "hey", "heya", "greetings", "good morning", "good afternoon", "good evening", "good day"],
  fr: ["bonjour", "bonsoir", "salut", "coucou", "allo"],
  es: ["hola", "holaa", "buenos días", "buenos dias", "buenas tardes", "buenas noches"],
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
const SUPPORTED_LIVE_MODE_LANGUAGES = Array.from(new Set([...SUPPORTED_ROUTING_LANGUAGES, "en", "fr", "de", "es", "it", "pt", "zh", "ru", "ja", "nl", "ro", "pl", "sv", "da", "no"]));
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
  chinese: ["chinois", "chinese", "chino", "china", "mandarin", "mandarim", "mandarín", "cinese"],
  arabic: ["arabe", "arabe", "arabic", "arabo", "árabe"]
};
const SUB_VARIANT_KEYWORDS = {
  standard: ["standard", "regular", "general", "normal", "classic", "cours standard", "standard course"],
  accelerated: ["accelerated", "accelere", "accéléré", "express", "fast track", "speed", "rapide"],
  intensive: ["intensive", "intensif", "intensivo", "intensiva", "immersion"],
  online: ["online", "remote", "distance", "virtual", "e learning", "elearning", "en ligne"],
  in_person: ["in person", "in-person", "onsite", "on site", "presentiel", "présentiel", "face to face"],
  private: ["private", "one to one", "one-to-one", "individual", "cours particulier", "privado", "privé"],
  group: ["group", "group class", "small group", "collective", "collectif", "grupo"],
  beginner: ["beginner", "debutant", "débutant", "a1", "starter", "intro"],
  advanced: ["advanced", "avance", "avancé", "expert", "c1", "c2"]
};
const SUB_VARIANT_CORRECTION_PATTERN = /\b(no|non|rather|instead|plutot|plutôt|prefer|pas celui|not that|correction)\b/i;
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
  ar: {
    greeting_menu: "مرحباً 👋 أهلاً بكم في LSA GLOBAL.\n\nنقدّم:\n1️⃣ خدمات الترجمة\n2️⃣ دورات اللغات\n3️⃣ خدمات الترجمة الفورية\n4️⃣ التحدث إلى مستشار\n\nيرجى الرد بـ 1 أو 2 أو 3 أو 4.",
    options: {
      translation: "🌍 خدمات الترجمة.\nيرجى إرسال زوج اللغات ونوع المستند والموعد النهائي.\nطلب عرض سعر: https://lsaglobal-translate.co.uk/get-your-free-quote-lsa-global/",
      courses: "🎓 دورات اللغات A1–C2 (عبر الإنترنت/بإشراف).\nأخبرنا باللغة التي تريدها ومستواك الحالي.\nالتسجيل: https://lsa-global.com/register-now-2/",
      interpreting: "🎧 خدمات الترجمة الفورية (عن بعد/حضورياً).\nيرجى إرسال زوج اللغات والتاريخ والمدة.",
      advisor: "👨‍💼 طلب مستشار\n\nيرجى وصف احتياجك بإيجاز. سيتواصل معك فريقنا قريباً."
    },
    safe_handoff: "شكراً لك. تم استلام طلبك. سيرد عليك أحد أعضاء فريق LSA GLOBAL قريباً.",
    fallback: "يرجى الرد بـ 1 أو 2 أو 3 أو 4."
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
  return normalizeDeterministicText(text);
}

function normalizeDeterministicText(text) {
  return normalizeForIntent(text)
    .replace(/([\p{L}])\1{2,}/gu, "$1$1")
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

function isFeeRelevantLine(text, { allowSupplementOnly = true } = {}) {
  const normalized = normalizeForIntent(text || "");
  if (!normalized) return false;

  const currencySymbolPattern = /(?:€|\$|£|fcfa|xaf|xof|usd|eur|cad|frs?\s*cfa)/i;
  const amountWithUnitPattern = /\b\d{1,3}(?:[\s.,]\d{3})*(?:\s*(?:€|\$|£|fcfa|xaf|xof|usd|eur|cad|frs?\s*cfa))\b/i;
  const priceTermPattern = /\b(fee|fees|price|prices|pricing|cost|costs|tarif|tarifs|tariff|tariffs|tuition|rate|rates|quote|quotation|montant|amount|frais)\b/i;
  const rateUnitPattern = /\b(per|par)\s+(?:hour|heure|word|mot|page|participant|session|month|mois|week|semaine)\b/i;
  const supplementPattern = /\b(registration|inscription|enrollment|enrolment|payment|paiement|installment|installments|instalment|instalments|deposit|acompte|advance|versement|tranche|tranches)\b/i;
  const freeOrInclusionPattern = /\b(free|gratuit|gratuite|gratuits|included|inclus|incluse|sans frais|no additional charge)\b/i;
  const nonPricingPattern = /\b(duration|durée|duree|schedule|horaire|horaires|level|levels|niveau|niveaux|materials?|support de cours|certificate|certification|location|adresse|address|format|online|onsite|présentiel|presentiel)\b/i;

  const hasAmount = amountWithUnitPattern.test(normalized);
  const hasCurrency = currencySymbolPattern.test(normalized);
  const hasPriceTerm = priceTermPattern.test(normalized);
  const hasRateUnit = rateUnitPattern.test(normalized);
  const hasSupplement = supplementPattern.test(normalized);
  const hasFreeOrInclusion = freeOrInclusionPattern.test(normalized);
  const hasNonPricing = nonPricingPattern.test(normalized);

  if (hasAmount && (hasCurrency || hasPriceTerm || hasRateUnit || hasSupplement)) return true;
  if (hasPriceTerm && (hasCurrency || hasAmount || hasRateUnit || hasSupplement)) return true;
  if (allowSupplementOnly && hasSupplement && (hasFreeOrInclusion || hasCurrency || hasAmount || hasPriceTerm)) return true;
  if ((hasCurrency || hasAmount) && !hasNonPricing) return true;

  return false;
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

  const candidates = lines.length ? lines : fallbackChunks;
  const selected = [];
  for (const chunk of candidates) {
    if (/^\s*(duration|durée|duree|schedule|horaire|horaires|levels?|niveau|registration|inscription|address|location)\s*:/i.test(chunk)) {
      continue;
    }
    if (isFeeRelevantLine(chunk, { allowSupplementOnly: true })) {
      selected.push(chunk);
    }
  }

  if (!selected.length) return null;
  return Array.from(new Set(selected)).join("\n");
}

const FIELD_EXTRACTION_RULES = {
  fees: {
    headingKeywords: ["fee", "fees", "tarif", "tarifs", "prix", "frais", "pricing", "cost", "tuition"],
    lineSignals: [
      /\b(fee|fees|price|prices|pricing|cost|costs|tarif|tarifs|prix|frais|tuition|montant|amount)\b/i,
      /\b\d{1,3}(?:[\s.,]\d{3})*(?:\s*(?:frs?\s*cfa|fcfa|xaf|xof|eur|usd|cad|€|\$|£))?\b/i,
      /\bfees?\s+per\s+level\b/i
    ]
  },
  duration: {
    headingKeywords: ["duration", "durée", "duree", "longueur", "length"],
    lineSignals: [/\b(duration|durée|duree|length|weeks?|months?|jours?|semaines?|mois|hours?|heures?)\b/i]
  },
  schedule: {
    headingKeywords: ["schedule", "horaires", "horaire", "timetable", "planning", "orario", "horario"],
    lineSignals: [/\b(schedule|horaires?|timetable|planning|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|mon|tue|wed|thu|fri|sat|sun|\d{1,2}[:h]\d{0,2})\b/i]
  },
  levels: {
    headingKeywords: ["level", "levels", "niveau", "niveaux", "nivel", "niveles", "livello", "livelli"],
    lineSignals: [/\b(level|levels|niveau|niveaux|nivel|niveles|livello|livelli|a1|a2|b1|b2|c1|c2|beginner|intermediate|advanced|débutant|debutant)\b/i]
  },
  location: {
    headingKeywords: ["location", "localisation", "lieu", "adresse", "address", "campus", "site"],
    lineSignals: [/\b(location|localisation|lieu|adresse|address|city|ville|campus|onsite|présentiel|presentiel)\b/i]
  },
  registration: {
    headingKeywords: ["registration", "inscription", "enrollment", "enrolment", "admission", "apply"],
    lineSignals: [/\b(registration|inscription|register|enrollment|enrolment|deadline|apply|admission|dossier)\b/i]
  },
  payment_options: {
    headingKeywords: ["payment", "payment options", "installments", "tranches", "paiement", "versement"],
    lineSignals: [/\b(payment|payments|installments?|tranches?|paiement|versement|bank transfer|mobile money|cash|card)\b/i]
  },
  turnaround: {
    headingKeywords: ["turnaround", "delivery", "délai", "delai", "processing time"],
    lineSignals: [/\b(turnaround|delivery|processing time|business days?|jours ouvrables?|urgent|rush)\b/i]
  },
  requirements: {
    headingKeywords: ["requirements", "documents", "conditions", "needed", "pièces", "pieces"],
    lineSignals: [/\b(requirements?|required|documents?|pieces|pièces|conditions|passport|id|identity)\b/i]
  },
  refund_policy: {
    headingKeywords: ["refund", "refund policy", "remboursement", "policy", "absence"],
    lineSignals: [/\b(refund|refunds|remboursement|rembolso|rimborso|policy|absence|cancellation|annulation)\b/i]
  },
  contact: {
    headingKeywords: ["contact", "contacts", "phone", "email", "address", "whatsapp"],
    lineSignals: [/\b(contact|phone|email|whatsapp|address|city|branch|office|douala|yaounde|london|usa)\b/i]
  },
  availability: {
    headingKeywords: ["availability", "available", "slots", "places", "opening hours", "business hours", "hours"],
    lineSignals: [/\b(availability|available|slots?|places?|openings?|opening hours|business hours|hours?|mon|tue|wed|thu|fri|sat|sun|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i]
  }
};

const STRICT_FIELD_ONLY_INTENTS = new Set(["fees", "duration", "schedule", "levels", "registration", "location", "certification", "requirements"]);

function hasStrongFieldSignal(line, intent) {
  const rule = FIELD_EXTRACTION_RULES[intent];
  if (!rule) return false;
  const signals = rule.lineSignals || [];
  return signals.some((signal) => signal.test(line));
}

function lineHasCompetingFieldSignal(line, intent) {
  const normalized = normalizeForIntent(line);
  if (!normalized) return false;

  const strictIntents = [...STRICT_FIELD_ONLY_INTENTS];
  for (const otherIntent of strictIntents) {
    if (otherIntent === intent) continue;
    const otherRule = FIELD_EXTRACTION_RULES[otherIntent];
    if (!otherRule) continue;
    const hasOtherSignal = (otherRule.lineSignals || []).some((signal) => signal.test(line));
    if (!hasOtherSignal) continue;

    const selfSignal = hasStrongFieldSignal(line, intent);
    if (!selfSignal) return true;
    return true;
  }

  return false;
}

function enforceStrictFieldOnlyLines(text, intent) {
  if (!STRICT_FIELD_ONLY_INTENTS.has(intent)) return text;
  const lines = String(text || "")
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return null;

  const strictLines = lines.filter((line) => {
    if (!hasStrongFieldSignal(line, intent)) return false;
    if (lineHasCompetingFieldSignal(line, intent)) return false;
    return true;
  });

  if (!strictLines.length) return null;
  return Array.from(new Set(strictLines)).join("\n");
}

function sectionMatchesSubVariant(section, subVariant) {
  if (!subVariant) return true;
  const normalized = normalizeForIntent(section);
  if (!normalized) return false;
  const variantTerms = (SUB_VARIANT_KEYWORDS[subVariant] || []).map(normalizeForIntent).filter(Boolean);
  return variantTerms.some((term) => {
    const escaped = term.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(normalized);
  });
}

function extractSubVariantScopedText(answerText, subVariant) {
  if (!subVariant) return answerText;
  const source = (answerText || "").trim();
  if (!source) return "";

  const sections = source
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter(Boolean);
  const candidates = sections.length ? sections : source.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const matched = candidates.filter(section => sectionMatchesSubVariant(section, subVariant));
  if (!matched.length) return source;
  return matched.join("\n");
}

function extractByFieldRules(answerText, intent, options = {}) {
  const source = (answerText || "").trim();
  if (!source) return null;
  const rule = FIELD_EXTRACTION_RULES[intent];
  if (!rule) return null;
  const scopedSource = extractSubVariantScopedText(source, options.subVariant);

  const lines = scopedSource
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return null;

  const normalizedHeadingKeywords = (rule.headingKeywords || []).map(normalizeForIntent).filter(Boolean);
  const selected = [];

  const isHeadingMatch = (line) => {
    const headingMatch = line.match(/^([^\n:]{2,80})\s*:\s*(.*)$/);
    if (!headingMatch) return false;
    const headingLabel = normalizeForIntent(headingMatch[1]);
    return normalizedHeadingKeywords.some((keyword) => {
      const escaped = keyword.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      return new RegExp(`\\b${escaped}\\b`, "i").test(headingLabel);
    });
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isHeadingMatch(line)) {
      if (intent !== "fees" || isFeeRelevantLine(line, { allowSupplementOnly: false })) {
        selected.push(line);
      }
      for (let j = i + 1; j < lines.length; j += 1) {
        const nextLine = lines[j];
        if (/^[^\n:]{2,80}\s*:/.test(nextLine)) break;
        if (intent !== "fees" || isFeeRelevantLine(nextLine, { allowSupplementOnly: true })) {
          selected.push(nextLine);
        }
      }
    }
  }

  if (!selected.length) {
    const signals = rule.lineSignals || [];
    for (const line of lines) {
      if (intent === "fees" && !isFeeRelevantLine(line, { allowSupplementOnly: true })) {
        continue;
      }
      if (signals.some((signal) => signal.test(line))) {
        selected.push(line);
      }
    }
  }

  if (!selected.length) return null;
  const joined = Array.from(new Set(selected)).join("\n");
  return enforceStrictFieldOnlyLines(joined, intent) || joined;
}

function extractRelevantKbSection(answerText, intent, options = {}) {
  if (!answerText || !intent || !NARROW_INTENT_KEYWORDS[intent]) return null;
  const scopedAnswerText = extractSubVariantScopedText(answerText, options.subVariant);
  if (intent === "fees") {
    const feeOnlySection = extractFeeOnlySection(scopedAnswerText);
    if (feeOnlySection) return feeOnlySection;
  }
  const fieldSpecificSection = extractByFieldRules(scopedAnswerText, intent, options);
  if (fieldSpecificSection) return fieldSpecificSection;

  const keywords = NARROW_INTENT_KEYWORDS[intent].map(normalizeForIntent);
  const normalizedAnswer = normalizeForIntent(scopedAnswerText);
  const hasIntentSignal = keywords.some((keyword) => keyword && normalizedAnswer.includes(keyword));

  const paragraphs = scopedAnswerText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  const fallbackParagraphs = scopedAnswerText
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

  const fallbackLines = scopedAnswerText
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
    certification: /\b(certificate|certification|attestation|proof|exam|examen)\b/i,
    payment_options: /\b(payment|installment|tranche|bank transfer|mobile money|cash|card)\b/i,
    turnaround: /\b(turnaround|delivery|processing|jours ouvrables|business days|urgent|rush)\b/i,
    requirements: /\b(requirements|required|documents|passport|id|identity|pieces|pièces)\b/i,
    refund_policy: /\b(refund|remboursement|policy|absence|cancellation|annulation)\b/i,
    contact: /\b(contact|phone|email|whatsapp|address|city|branch|douala|yaounde|london)\b/i,
    availability: /\b(availability|available|openings|slots|places|opening hours|business hours|mon|tue|wed|thu|fri|sat|sun|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche)\b/i
  };

  const signal = heuristicSignals[intent];
  if (!signal) return null;
  const matchedLine = fallbackLines.find((line) => signal.test(line));
  if (!matchedLine) return null;
  return enforceStrictFieldOnlyLines(matchedLine, intent) || matchedLine;
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

  const summarizeField = (value, label) => {
    const lines = String(value || "")
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (!lines.length) return "";
    const firstLine = lines[0].replace(/\s+/g, " ").trim();
    const withoutHeading = firstLine.replace(/^[^:]{2,40}:\s*/i, "").trim();
    if (!withoutHeading) return "";
    return `${label}: ${withoutHeading}`;
  };

  const compactBits = [
    summarizeField(levels, userLanguage === "fr" ? "Niveaux" : "Levels"),
    summarizeField(duration, userLanguage === "fr" ? "Durée" : "Duration"),
    summarizeField(format, userLanguage === "fr" ? "Format" : "Format"),
    summarizeField(schedule, userLanguage === "fr" ? "Horaires" : "Schedule"),
    summarizeField(certification, userLanguage === "fr" ? "Certification" : "Certification")
  ]
    .filter(Boolean)
    .filter((line, index, arr) => arr.indexOf(line) === index);

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

  let lastFallbackReason = "no_match_candidates";
  const orderedMatches = [...matches].sort((a, b) => {
    if (a.source === "kb_articles" && b.source !== "kb_articles") return -1;
    if (a.source !== "kb_articles" && b.source === "kb_articles") return 1;
    return 0;
  });

  console.log("[narrow-extract-debug] start", JSON.stringify({
    detected_field_intent: safeIntent,
    matches_count: orderedMatches.length
  }));

  for (const match of orderedMatches) {
    const text = extractAnswerTextFromRetrievalMatch(match);
    const section = extractRelevantKbSection(text, safeIntent);
    const snippetLength = section ? section.length : 0;
    console.log("[narrow-extract-debug] candidate", JSON.stringify({
      matched_article_title: match?.title || "Untitled",
      detected_field_intent: safeIntent,
      source: match?.source || "unknown",
      target_field_found: Boolean(section),
      extracted_snippet_length: snippetLength
    }));
    if (section) return section;
    if (!text?.trim()) {
      lastFallbackReason = "empty_match_text";
    } else {
      lastFallbackReason = "target_field_not_found_in_candidate";
    }
  }
  console.log("[narrow-extract-debug] fallback", JSON.stringify({
    detected_field_intent: safeIntent,
    fallback_reason: "source_not_confirmed_by_rules",
    previous_reason: lastFallbackReason
  }));
  return null;
}

const retrieveInternalKnowledge = createInternalRetriever({
  supabase,
  detectLanguage: detectMessageLanguage
});

const customerState = new Map();
const LIVE_PROMPT_REPEAT_THRESHOLD = 2;
const CONTROLLED_AI_ESCALATION_ROUTES = new Set([
  "translation_client",
  "provider_collaboration",
  "courses",
  "interpreting",
  "registration",
  "location",
  "certificates",
  "policy",
  "clarification",
  "manual_review"
]);

function getDefaultCustomerState() {
  return {
    clarifyingAsked: false,
    preferredCourseLanguage: null,
    topicType: null,
    topicLanguage: null,
    topicEntity: null,
    topicIntent: null,
    topicDomain: null,
    topicLabel: null,
    topicSubVariant: null,
    collaboratorSubtype: null,
    liveMenuOption: null,
    liveKnownSlots: {},
    lastPromptKey: null,
    repeatedPromptCount: 0,
    lastRoute: null,
    roleIntent: null,
    serviceIntent: null,
    routingLanguage: null,
    intentShiftDetected: false
  };
}

function getCustomerState(waId) {
  if (!waId) return getDefaultCustomerState();
  return { ...getDefaultCustomerState(), ...(customerState.get(waId) || {}) };
}

function mergeStateValue(state, current, key, fallback = null) {
  if (Object.prototype.hasOwnProperty.call(state || {}, key)) return state[key];
  return Object.prototype.hasOwnProperty.call(current || {}, key) ? current[key] : fallback;
}

function setCustomerState(waId, state) {
  if (!waId) return;
  const current = getCustomerState(waId);
  customerState.set(waId, {
    clarifyingAsked: Object.prototype.hasOwnProperty.call(state || {}, "clarifyingAsked") ? Boolean(state.clarifyingAsked) : Boolean(current.clarifyingAsked),
    preferredCourseLanguage: mergeStateValue(state, current, "preferredCourseLanguage"),
    topicType: mergeStateValue(state, current, "topicType"),
    topicLanguage: mergeStateValue(state, current, "topicLanguage"),
    topicEntity: mergeStateValue(state, current, "topicEntity"),
    topicIntent: mergeStateValue(state, current, "topicIntent"),
    topicDomain: mergeStateValue(state, current, "topicDomain"),
    topicLabel: mergeStateValue(state, current, "topicLabel"),
    topicSubVariant: mergeStateValue(state, current, "topicSubVariant"),
    collaboratorSubtype: mergeStateValue(state, current, "collaboratorSubtype"),
    liveMenuOption: mergeStateValue(state, current, "liveMenuOption"),
    liveKnownSlots: mergeStateValue(state, current, "liveKnownSlots", {}),
    lastPromptKey: mergeStateValue(state, current, "lastPromptKey"),
    repeatedPromptCount: Number(mergeStateValue(state, current, "repeatedPromptCount", 0)) || 0,
    lastRoute: mergeStateValue(state, current, "lastRoute"),
    roleIntent: mergeStateValue(state, current, "roleIntent"),
    serviceIntent: mergeStateValue(state, current, "serviceIntent"),
    routingLanguage: mergeStateValue(state, current, "routingLanguage"),
    intentShiftDetected: Object.prototype.hasOwnProperty.call(state || {}, "intentShiftDetected")
      ? Boolean(state.intentShiftDetected)
      : Boolean(current.intentShiftDetected)
  });
}

function detectRequestedSubVariant(text, recentContext = {}) {
  const normalized = normalizeDeterministicText(text);
  if (!normalized) return { subVariant: recentContext.topicSubVariant || null, correctionOverrideApplied: false };

  let best = null;
  for (const [variant, keywords] of Object.entries(SUB_VARIANT_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      const token = normalizeForIntent(keyword).replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      if (!token) continue;
      if (new RegExp(`\\b${token}\\b`, "i").test(normalized)) {
        score += token.includes(" ") ? 2 : 1;
      }
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { variant, score };
    }
  }
  if (!best) return { subVariant: recentContext.topicSubVariant || null, correctionOverrideApplied: false };
  return {
    subVariant: best.variant,
    correctionOverrideApplied: SUB_VARIANT_CORRECTION_PATTERN.test(normalized)
  };
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

const LIVE_SERVICE_LANGUAGE_KEYWORDS = {
  english: ["english", "anglais", "inglés", "ingles", "inglese"],
  french: ["french", "français", "francais", "francese", "francés", "frances"],
  italian: ["italian", "italien", "italiano", "italiana"],
  german: ["german", "allemand", "deutsch", "alemán", "aleman", "tedesco"],
  spanish: ["spanish", "espagnol", "español", "espanol", "spagnolo"],
  portuguese: ["portuguese", "portugais", "português", "portugues", "portoghese"],
  chinese: ["chinese", "chinois", "mandarin", "cinese"],
  arabic: ["arabic", "arabe", "árabe", "arabo"],
  russian: ["russian", "russe", "ruso", "russo"],
  dutch: ["dutch", "néerlandais", "neerlandais", "holandés", "olandese"],
  japanese: ["japanese", "japonais", "japonés", "giapponese"],
  ukrainian: ["ukrainian", "ukrainien", "ucraniano", "ucraino", "ukrainisch", "українська", "украинский"]
};

function detectServiceLanguages(text = "") {
  const normalized = normalizeForIntent(text);
  if (!normalized) return [];
  const found = [];
  for (const [language, variants] of Object.entries(LIVE_SERVICE_LANGUAGE_KEYWORDS)) {
    if (variants.some((variant) => {
      const token = normalizeForIntent(variant).replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      return token && new RegExp(`\\b${token}\\b`, "i").test(normalized);
    })) {
      found.push(language);
    }
  }
  return found;
}

const COLLABORATOR_SUBTYPES = [
  "translator",
  "interpreter",
  "teacher_trainer",
  "examiner_coach",
  "tech_provider",
  "ai_automation_provider",
  "general_collaborator",
  "unknown_provider"
];

function hasAnyRegexMatch(value, patterns = []) {
  return patterns.some((pattern) => pattern.test(value));
}

function detectProviderCollaborationIntent(text = "") {
  const generalized = resolveGeneralizedRouting({ text, platform: "server_detector" });
  if (generalized.route === "provider_collaboration") {
    return {
      detected: true,
      reason: generalized.overrideTriggered ? generalized.roleReason : generalized.reason,
      roleIntent: generalized.roleIntent,
      serviceIntent: generalized.serviceIntent,
      generalized: true
    };
  }
  const normalized = normalizeForIntent(text);
  if (!normalized) return { detected: false, reason: "empty" };
  const patterns = [
    { reason: "translator_interpreter_identity", pattern: /\b(i am|i m|im|am|je suis|soy|ich bin|sono|sou)\s+(a\s+|an\s+|the\s+|un\s+|une\s+|una\s+|um\s+|uma\s+)?(translator|traducteur|traductrice|traductor|traductora|traduttore|traduttrice|tradutor|tradutora|ubersetzer|uebersetzer|interpreter|interprete|interprete|dolmetscher|linguist|linguiste|linguista|freelancer|freelance|language provider)\b/i },
    { reason: "teacher_trainer_identity", pattern: /\b(i am|i m|im|am|je suis|soy|ich bin|sono|sou)\s+(a\s+|an\s+|the\s+|un\s+|une\s+|una\s+|um\s+|uma\s+)?((language|english|french|spanish|german|italian|portuguese|anglais|francais|espagnol|allemand|italien|portugais|ingles|espanol|aleman|italiano|portugues|deutsch)\s+)?(teacher|trainer|instructor|tutor|professor|coach|enseignant|enseignante|professeur|formateur|formatrice|tuteur|tutrice|profesor|profesora|docente|maestro|maestra|insegnante|docente|professore|professoressa|lehrer|lehrerin|dozent|dozentin|professor|professora|instrutor|instrutora)\b/i },
    { reason: "examiner_coach_identity", pattern: /\b(examiner|examinateur|examinatrice|examinador|examinadora|esaminatore|esaminatrice|prufer|pruefer|coach|ielts|toefl|toeic|tef|delf|dalf)\b.*\b(work|collaborat|position|poste|puesto|stellen|job|lsa global|with you|avec vous|con ustedes|mit ihnen)\b/i },
    { reason: "tech_provider_identity", pattern: /\b(tech|technical|technology|it|web|website|lms|moodle|developer|devops|support|informatique|site web|plateforme|soporte tecnico|desarrollador|sviluppatore|entwickler|suporte tecnico)\b.*\b(provider|prestataire|supplier|vendor|support|collaborat|work|service|services|lsa global)\b/i },
    { reason: "tech_provider_offer", pattern: /\b(provide|offer|build|develop|support|maintain|create|fournis|propose|developpe|desarrollo|ofrezco|sviluppo)\b.*\b(lms|moodle|website|web|site web|platform|plateforme|app|software|technical|technology|tech|it support|informatique)\b/i },
    { reason: "ai_automation_provider_identity", pattern: /\b(ai|ia|artificial intelligence|intelligence artificielle|automat(?:e|ion)|automation|automatisation|workflow|workflows|chatbot|agent|agents|openai|llm|ia generativa)\b.*\b(provider|prestataire|build|create|develop|collaborat|work|service|services|lsa global)\b/i },
    { reason: "ai_automation_provider_offer", pattern: /\b(build|create|develop|provide|offer|automate|design|construis|cree|developpe|automatise|desarrollo|creo|sviluppo)\b.*\b(ai|ia|artificial intelligence|intelligence artificielle|automation|automatisation|workflow|workflows|chatbot|agents?|openai|llm)\b/i },
    { reason: "teaching_position_request", pattern: /\b(teacher|trainer|instructor|tutor|enseignant|enseignante|professeur|formateur|formatrice|profesor|profesora|docente|insegnante|lehrer|lehrerin|professor|professora)\b.*\b(position|poste|puesto|job|work|collaborat|join|recrutement|emploi|vacancy|stellen|lsa global)\b/i },
    { reason: "translation_work_availability", pattern: /\b(available|free|disponible|disponibilidad|disponibilite|verfugbar|verfuegbar)\b.*\b(translation|traduction|traduccion|traduzione|traducao|translator|traducteur|interpreter|interpreting|interpretation|interpretation|work|jobs?|projects?|assignments?|mission|missions)\b/i },
    { reason: "available_for_assignments", pattern: /\b(i\s+am\s+)?(available|disponible|verfugbar|verfuegbar)\s+for\s+(assignments?|projects?|jobs?|work|missions?)\b/i },
    { reason: "send_work_request", pattern: /\b(send|give|offer|provide|envoyez|donnez|manden|envien|datemi|inviatemi)\s+me\s+(work|jobs?|projects?|assignments?|missions?)\b/i },
    { reason: "need_work_request", pattern: /\b(i\s+)?(need|want|looking for|cherche|recherche|busco|cerco)\s+(a\s+)?(work|jobs?|projects?|assignments?|position|poste|emploi|missions?)(\s+(from|with|avec|chez)\s+(lsa\s+global|you|your\s+(company|team)))?\b/i },
    { reason: "work_with_lsa", pattern: /\b(i\s+)?(want|would like|souhaite|veux|voudrais|quiero|quisiera|vorrei|möchte|mochte|gostaria)\s+to\s+(work\s+with\s+(you|lsa\s+global)|collaborate|partner\s+with\s+you|join\s+(your\s+)?team)\b/i },
    { reason: "work_with_lsa_multilingual", pattern: /\b(collaborer|collaborer\s+avec|travailler\s+(avec|chez)|rejoindre|postuler|candidature|candidato|candidata|colaborar|trabajar\s+con|unirme|collaborare|lavorare\s+con|bewerben|zusammenarbeiten|trabalhar\s+com|colaborar)\b.*\b(lsa\s+global|vous|you|ustedes|voi|ihnen|voces|vocês)\b/i },
    { reason: "project_seeking", pattern: /\b(i\s+)?want\s+(translation\s+|interpreting\s+)?(projects?|assignments?|freelance\s+work|work)\b/i },
    { reason: "provider_application", pattern: /\b(provider|prestataire|supplier|vendor|freelancer|freelance|translator|interpreter|teacher|trainer|tech|ai|automation|collaborator|collaborateur|collaboratrice)\s+(application|registration|intake|collaboration|candidature|inscription)\b/i }
  ];
  const match = patterns.find(({ pattern }) => pattern.test(normalized));
  return { detected: Boolean(match), reason: match?.reason || "none", generalized: false };
}

function detectCollaboratorSubtype(text = "", recentContext = {}) {
  const normalized = normalizeForIntent(text);
  const previousSubtype = COLLABORATOR_SUBTYPES.includes(recentContext?.collaboratorSubtype)
    ? recentContext.collaboratorSubtype
    : null;
  if (!normalized) {
    return {
      subtype: previousSubtype || "unknown_provider",
      reason: previousSubtype ? "retained_previous_subtype_empty_message" : "empty",
      confidence: previousSubtype ? "retained" : "low",
      clarificationNeeded: !previousSubtype
    };
  }

  const negatedTranslatorInterpreter = /\b(not|not\s+a|not\s+an|not\s+the|no\s+soy|no\s+sou|non\s+sono|nicht|ne\s+suis\s+pas|je\s+ne\s+suis\s+pas|pas)\b.{0,40}\b(translator|traducteur|traductrice|traductor|traductora|traduttore|traduttrice|tradutor|tradutora|ubersetzer|uebersetzer|interpreter|interprete|dolmetscher|interprete)\b/i.test(normalized);
  const negatedTeacherTrainer = /\b(not|not\s+a|not\s+an|no\s+soy|non\s+sono|nicht|ne\s+suis\s+pas|je\s+ne\s+suis\s+pas|pas)\b.{0,40}\b(teacher|trainer|instructor|tutor|enseignant|enseignante|professeur|formateur|formatrice|profesor|profesora|docente|insegnante|lehrer|lehrerin|professor|professora)\b/i.test(normalized);

  const subtypeRules = [
    {
      subtype: "ai_automation_provider",
      reason: "ai_automation_terms",
      patterns: [/\b(ai|ia|artificial intelligence|intelligence artificielle|inteligencia artificial|intelligenza artificiale|kunstliche intelligenz|ki|automation|automatisation|automatizacion|automazione|automatisierung|workflow|workflows|chatbot|bot|agent|agents|openai|llm|machine learning|generative ai|ia generativa)\b/i]
    },
    {
      subtype: "tech_provider",
      reason: "technology_provider_terms",
      patterns: [/\b(lms|moodle|website|web\s+site|site\s+web|web\s+development|developer|developpeur|développeur|desarrollador|sviluppatore|entwickler|wordpress|software|app|platform|plateforme|plataforma|piattaforma|tech|technology|technical|informatique|it\s+support|support\s+informatique|soporte\s+tecnico|suporte\s+tecnico|devops|hosting|cloud|database|api)\b/i]
    },
    {
      subtype: "teacher_trainer",
      reason: "teacher_trainer_terms",
      blocked: negatedTeacherTrainer,
      patterns: [/\b(teacher|trainer|language\s+trainer|instructor|tutor|professor|enseignant|enseignante|professeur|formateur|formatrice|tuteur|tutrice|profesor|profesora|docente|maestro|maestra|insegnante|professore|professoressa|lehrer|lehrerin|dozent|dozentin|professor|professora|instrutor|instrutora|formation|training|teaching|enseigne|enseigner|enseignement|cours\s+de\s+langue)\b/i]
    },
    {
      subtype: "examiner_coach",
      reason: "examiner_coach_terms",
      patterns: [/\b(examiner|examinateur|examinatrice|examinador|examinadora|esaminatore|esaminatrice|prufer|pruefer|coach|exam\s+coach|exam\s+prep|preparation\s+(ielts|toefl|toeic|tef|delf|dalf)|ielts|toefl|toeic|tef|delf|dalf|cambridge\s+exam)\b/i]
    },
    {
      subtype: "interpreter",
      reason: "interpreter_terms",
      blocked: negatedTranslatorInterpreter,
      patterns: [/\b(interpreter|interpreting|interpretation|interpretariat|interprete|interpretes|dolmetscher|dolmetschen|口译|通訳|устн(?:ый|ого)?\s+перевод)\b/i]
    },
    {
      subtype: "translator",
      reason: "translator_terms",
      blocked: negatedTranslatorInterpreter,
      patterns: [/\b(translator|translation\s+provider|traducteur|traductrice|traductor|traductora|traduttore|traduttrice|tradutor|tradutora|ubersetzer|uebersetzer|переводчик|翻译者|翻訳者)\b/i]
    },
    {
      subtype: "general_collaborator",
      reason: "general_collaboration_terms",
      patterns: [/\b(collaborator|collaborateur|collaboratrice|partner|partenaire|partnership|partenariat|socio|socia|partnerariato|prestataire|supplier|vendor|provider|freelancer|freelance|agency|agence|outsourcing|subcontractor|sous-traitant)\b/i]
    }
  ];

  for (const rule of subtypeRules) {
    if (rule.blocked) continue;
    if (hasAnyRegexMatch(normalized, rule.patterns)) {
      return {
        subtype: rule.subtype,
        reason: rule.reason,
        confidence: "high",
        clarificationNeeded: false
      };
    }
  }

  if (previousSubtype) {
    return {
      subtype: previousSubtype,
      reason: "retained_previous_subtype_active_provider_branch",
      confidence: "retained",
      clarificationNeeded: false
    };
  }

  return {
    subtype: "unknown_provider",
    reason: negatedTranslatorInterpreter ? "translation_interpreting_negated_without_clear_subtype" : "no_subtype_signal",
    confidence: "low",
    clarificationNeeded: true
  };
}

function resolveProviderSubtypeForRouting(text = "", userState = {}) {
  const broadIntent = detectProviderCollaborationIntent(text);
  const subtypeDecision = detectCollaboratorSubtype(text, userState);
  return {
    broadIntent,
    subtypeDecision,
    detected: broadIntent.detected,
    subtype: subtypeDecision.subtype,
    clarificationNeeded: broadIntent.detected && subtypeDecision.clarificationNeeded
  };
}

function isProviderCollaborationActive(userState = {}) {
  const liveMenuOption = normalizeLiveDomain(userState?.liveMenuOption || "");
  const topicDomain = normalizeLiveDomain(userState?.topicDomain || "");
  const lastRoute = String(userState?.lastRoute || "");
  return liveMenuOption === "provider_collaboration"
    || topicDomain === "provider_collaboration"
    || topicDomain === "provider"
    || lastRoute.includes("provider_collaboration");
}

function detectProviderContinuationIntent(text = "") {
  const directIntent = detectProviderCollaborationIntent(text);
  if (directIntent.detected) return directIntent;
  const normalized = normalizeForIntent(text);
  if (!normalized) return { detected: false, reason: "empty" };
  const patterns = [
    { reason: "work_from_lsa_continuation", pattern: /\b(work|jobs?|projects?|assignments?)\s+(from|with)\s+(lsa\s+global|you|your\s+(company|team))\b/i },
    { reason: "send_work_continuation", pattern: /\b(send\s+(work|jobs?|projects?|assignments?)|send\s+me|give\s+me|offer\s+me)\b/i },
    { reason: "project_continuation", pattern: /\b(projects?|assignments?|translation\s+jobs?|interpreting\s+jobs?|freelance\s+work)\b/i },
    { reason: "collaboration_continuation", pattern: /\b(work\s+with\s+you|work\s+with\s+lsa\s+global|collaborat(e|ion)|partner\s+with\s+you|join\s+your\s+team)\b/i },
    { reason: "availability_continuation", pattern: /\b(available|availability|ready)\b.*\b(work|jobs?|projects?|assignments?|translation|interpreting)\b/i }
  ];
  const match = patterns.find(({ pattern }) => pattern.test(normalized));
  return { detected: Boolean(match), reason: match?.reason || "none" };
}

function hasStrongNonProviderRouteIntent(text = "") {
  const normalized = normalizeForIntent(text);
  if (!normalized) return false;
  if (detectTranslationClientIntent(text).detected) return true;
  return /\b(course|courses|cours|fees?|price|schedule|register|registration|location|address|certificate|certificates|interpretation\s+service|need\s+(a\s+)?translation|translate\s+my|my\s+document)\b/i.test(normalized);
}

function detectTranslationClientIntent(text = "") {
  const normalized = normalizeForIntent(text);
  if (!normalized) return { detected: false, reason: "empty" };
  const patterns = [
    { reason: "direct_service_request", pattern: /\b(i\s+)?(need|want|request|require|looking\s+for)\s+(a\s+)?(certified\s+|sworn\s+)?translation\b/i },
    { reason: "translate_my_document", pattern: /\b(translate|translation)\s+(my|a|the)?\s*(document|certificate|passport|contract|transcript|diploma|degree|file|pdf)\b/i },
    { reason: "quote_request", pattern: /\b(quote|quotation|price|cost|fee|deadline|turnaround)\b.*\b(translation|translate|document|certificate)\b/i },
    { reason: "language_pair_request", pattern: /\b(from\s+)?[a-z][a-z\s-]{1,30}\s+(to|into|-)\s+[a-z][a-z\s-]{1,30}\b/i }
  ];
  const match = patterns.find(({ pattern }) => pattern.test(normalized));
  return { detected: Boolean(match), reason: match?.reason || "none" };
}

function extractLooseLanguagePair(text = "") {
  const normalized = normalizeForIntent(text);
  if (!normalized) return null;
  const directPair = normalized.match(/\b(?:from\s+)?([a-z][a-z\s-]{1,30})\s+(?:to|into|-)\s+([a-z][a-z\s-]{1,30})\b/i);
  if (!directPair) return null;
  const clean = (value) => String(value || "")
    .replace(/\b(i|need|want|translation|translate|document|from|to|into)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const source = clean(directPair[1]);
  const target = clean(directPair[2]);
  if (!source || !target || source === target) return null;
  return `${source}-${target}`;
}

function isAmbiguousTranslationFollowUp(text = "", userState = {}) {
  const normalized = normalizeForIntent(text);
  if (!normalized) return false;
  const activeTranslationFlow = normalizeLiveDomain(userState?.liveMenuOption || userState?.topicDomain || "") === "translation";
  if (!activeTranslationFlow) return false;
  return /\b(anything|any|whatever|both|yes|ok|okay|not sure|i do not know|i don't know)\b/i.test(normalized);
}


function getManualReviewReasonReply(languageCode) {
  const language = normalizeLanguageCode(languageCode);
  const messages = {
    en: "Thank you. I want to avoid sending you the wrong automated path. An LSA GLOBAL team member will review this conversation and follow up shortly.",
    fr: "Merci. Je veux éviter de vous orienter vers le mauvais parcours automatique. Un membre de l’équipe LSA GLOBAL examinera cette conversation et reviendra vers vous rapidement.",
    es: "Gracias. Para evitar dirigirle al flujo automático equivocado, un miembro del equipo de LSA GLOBAL revisará esta conversación y responderá pronto.",
    de: "Danke. Damit Sie nicht in den falschen automatischen Ablauf geraten, prüft ein Mitglied des LSA GLOBAL-Teams diese Unterhaltung und meldet sich zeitnah.",
    it: "Grazie. Per evitare di indirizzarla al percorso automatico sbagliato, un membro del team LSA GLOBAL esaminerà questa conversazione e risponderà presto.",
    pt: "Obrigado. Para evitar encaminhá-lo para o fluxo automático errado, um membro da equipa LSA GLOBAL irá rever esta conversa e responder em breve."
  };
  return messages[language] || messages.en;
}

function hasSlotProgress(previousSlots = {}, nextSlots = {}) {
  const keys = new Set([...Object.keys(previousSlots || {}), ...Object.keys(nextSlots || {})]);
  for (const key of keys) {
    const previous = previousSlots?.[key];
    const next = nextSlots?.[key];
    if (!previous && next) return true;
    if (previous && next && String(previous) !== String(next)) return true;
  }
  return false;
}

function detectControlledAiEscalationNeed({ text = "", userState = {}, detectedDomain = "general", knownSlots = {} }) {
  const normalized = normalizeForIntent(text);
  const activeDomain = normalizeLiveDomain(userState?.liveMenuOption || userState?.topicDomain || "") || "general";
  const currentDomain = normalizeLiveDomain(detectedDomain) || detectedDomain || "general";
  const textDomain = detectLiveDomainTopic(text, {}) || "general";
  const providerIntent = detectProviderCollaborationIntent(text);
  const clientIntent = detectTranslationClientIntent(text);
  const missingSlots = getLiveDomainMissingSlots(currentDomain, knownSlots);
  const previousSlots = userState?.liveKnownSlots || {};
  const slotProgress = hasSlotProgress(previousSlots, knownSlots);
  const repeatedPromptCount = Number(userState?.repeatedPromptCount || 0) || 0;
  const reasons = [];

  if (!normalized) return { shouldEscalate: false, reasons, activeDomain, currentDomain, missingSlots, providerIntent, clientIntent };

  if (repeatedPromptCount >= LIVE_PROMPT_REPEAT_THRESHOLD && missingSlots.length) reasons.push("repeated_same_prompt_threshold_reached");
  if (activeDomain !== "general" && missingSlots.length && !slotProgress && normalized.split(/\s+/).length >= 3) reasons.push("slot_filling_failure");
  if (activeDomain === "translation" && providerIntent.detected) reasons.push(`conflicting_user_statement_${providerIntent.reason}`);
  if (activeDomain === "provider" && clientIntent.detected) reasons.push(`conflicting_user_statement_${clientIntent.reason}`);
  if (activeDomain !== "general" && textDomain !== "general" && textDomain !== activeDomain) reasons.push(`conversation_drift_${activeDomain}_to_${textDomain}`);
  if (activeDomain === "translation" && !providerIntent.detected && !clientIntent.detected && /\b(translator|freelancer|provider|work|jobs?|projects?|assignments?|collaborate|available)\b/i.test(normalized)) reasons.push("unclear_client_vs_provider_role");
  if (activeDomain === "general" && textDomain === "general" && normalized.split(/\s+/).length >= 8) reasons.push("natural_language_outside_rigid_menu");

  return {
    shouldEscalate: reasons.length > 0,
    reasons,
    activeDomain,
    currentDomain,
    textDomain,
    missingSlots,
    providerIntent,
    clientIntent
  };
}

function parseControlledAiJson(output = "") {
  const raw = String(output || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (error) {
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (_) {
      return null;
    }
  }
}

async function classifyControlledAiIntent({ text, language, userState = {}, trigger = {} }) {
  if (!openai) {
    return { used: false, route: "manual_review", confidence: 0, reason: "openai_unavailable", recommended_action: "manual_review" };
  }

  const safeState = {
    active_domain: trigger.activeDomain || normalizeLiveDomain(userState?.liveMenuOption || userState?.topicDomain || "") || "general",
    last_route: userState?.lastRoute || null,
    repeated_prompt_count: Number(userState?.repeatedPromptCount || 0) || 0,
    known_slots: userState?.liveKnownSlots || {},
    trigger_reasons: trigger.reasons || []
  };

  const response = await openai.responses.create({
    model: "gpt-5-mini",
    input: [{
      role: "user",
      content: [{
        type: "input_text",
        text: `You are a controlled routing repair layer for LSA GLOBAL Internal OS WhatsApp handling.\nDeterministic routing already ran first. Do not write a customer reply. Choose one safe route only.\nAllowed routes: translation_client, provider_collaboration, courses, interpreting, registration, location, certificates, policy, clarification, manual_review.\nBusiness rule: if the user appears to be a translator/freelancer/provider asking for work, choose provider_collaboration. If they clearly request a translation service for their document, choose translation_client. Sensitive, complaint, legal, refund exception, or low confidence cases must be manual_review.\nReturn strict JSON only with keys: route, confidence, reason, recommended_action. recommended_action must be one of reroute_existing_flow, ask_better_clarification, manual_review.\nLanguage code: ${language || "en"}\nRouting state: ${JSON.stringify(safeState)}\nCustomer message: ${String(text || "").slice(0, 1200)}`
      }]
    }]
  });

  const parsed = parseControlledAiJson(response.output_text);
  const route = CONTROLLED_AI_ESCALATION_ROUTES.has(parsed?.route) ? parsed.route : "manual_review";
  const confidence = Math.max(0, Math.min(1, Number(parsed?.confidence || 0)));
  const recommendedAction = ["reroute_existing_flow", "ask_better_clarification", "manual_review"].includes(parsed?.recommended_action)
    ? parsed.recommended_action
    : "manual_review";

  if (confidence < 0.55 && route !== "manual_review") {
    return {
      used: true,
      route: "clarification",
      confidence,
      reason: parsed?.reason || "low_confidence_needs_clarification",
      recommended_action: "ask_better_clarification"
    };
  }

  return {
    used: true,
    route,
    confidence,
    reason: parsed?.reason || "controlled_ai_classification",
    recommended_action: recommendedAction
  };
}

function buildControlledAiRerouteReply({ aiDecision, text, language, userState = {} }) {
  const route = aiDecision?.route || "manual_review";
  if (route === "provider_collaboration") {
    const subtypeDecision = detectCollaboratorSubtype(text, userState);
    const clarificationNeeded = subtypeDecision.clarificationNeeded;
    const selectedSubtype = subtypeDecision.subtype;
    return {
      branch: clarificationNeeded ? "live_ai_provider_subtype_clarification" : `live_ai_provider_collaboration_${selectedSubtype}_reroute`,
      reply: clarificationNeeded ? getProviderSubtypeClarificationReply(language) : getProviderCollaborationIntakeReply(language, selectedSubtype),
      action: clarificationNeeded ? "provider_collaboration_subtype_clarification" : `provider_collaboration_${selectedSubtype}_intake`,
      state: {
        liveMenuOption: "provider_collaboration",
        topicDomain: "provider",
        collaboratorSubtype: clarificationNeeded ? null : selectedSubtype,
        liveKnownSlots: { collaboratorSubtype: clarificationNeeded ? "unknown_provider" : selectedSubtype },
        intentShiftDetected: true
      }
    };
  }

  if (route === "translation_client") {
    const knownSlots = extractLiveClarificationSlots("translation", text, userState);
    return {
      branch: "live_ai_translation_client_reroute",
      reply: getLiveSafeMenuClarificationReply(language, "translation", knownSlots),
      action: "controlled_clarification",
      state: { liveMenuOption: "translation", topicDomain: "translation", liveKnownSlots: knownSlots, intentShiftDetected: true }
    };
  }

  const domainRoutes = new Set(["courses", "interpreting", "registration", "location", "certificates", "policy"]);
  if (domainRoutes.has(route)) {
    const knownSlots = extractLiveClarificationSlots(route, text, userState);
    return {
      branch: `live_ai_${route}_reroute`,
      reply: getLiveSafeMenuClarificationReply(language, route, knownSlots),
      action: "controlled_clarification",
      state: { liveMenuOption: route, topicDomain: route, liveKnownSlots: knownSlots, intentShiftDetected: true }
    };
  }

  if (route === "clarification") {
    const activeDomain = normalizeLiveDomain(userState?.liveMenuOption || userState?.topicDomain || "") || "general";
    return {
      branch: "live_ai_better_clarification",
      reply: activeDomain === "translation" ? getTranslationRoleClarificationReply(language) : getLiveSafeMenuClarificationReply(language, activeDomain, userState?.liveKnownSlots || {}),
      action: "controlled_clarification",
      state: { liveMenuOption: activeDomain === "general" ? null : activeDomain, intentShiftDetected: true }
    };
  }

  return {
    branch: "live_ai_manual_review",
    reply: getManualReviewReasonReply(language),
    action: "manual_review",
    state: { liveMenuOption: null, topicDomain: "manual_review", intentShiftDetected: true }
  };
}

const PROVIDER_SUBTYPE_LABELS = {
  translator: "translator",
  interpreter: "interpreter",
  teacher_trainer: "language teacher / trainer",
  examiner_coach: "language examiner / coach",
  tech_provider: "tech provider",
  ai_automation_provider: "AI / automation provider",
  general_collaborator: "general collaborator",
  unknown_provider: "unknown provider"
};

function normalizeCollaboratorSubtype(subtype) {
  return COLLABORATOR_SUBTYPES.includes(subtype) ? subtype : "unknown_provider";
}

function getProviderCollaborationIntakeReply(languageCode, subtype = "unknown_provider") {
  const language = normalizeLanguageCode(languageCode);
  const safeSubtype = normalizeCollaboratorSubtype(subtype);
  const messages = {
    en: "Thank you for your interest in working with LSA GLOBAL. To be reviewed for translation, interpreting, teaching/training, technology, AI or systems collaboration, please send your full name, languages/skills, country/city, service areas, availability, and CV or profile link if available. Our team will review and follow up.",
    fr: "Merci pour votre intérêt à collaborer avec LSA GLOBAL. Pour l’étude de votre profil en traduction/interprétation, envoyez votre nom complet, langues/paires de langues, pays/ville, domaines de service, disponibilités, et CV ou lien de profil si disponible. Notre équipe examinera et reviendra vers vous.",
    es: "Gracias por su interés en colaborar con LSA GLOBAL. Para revisar su perfil de traducción/interpretación, envíe nombre completo, idiomas/pares de idiomas, país/ciudad, áreas de servicio, disponibilidad y CV o enlace de perfil si lo tiene. Nuestro equipo revisará y responderá.",
    de: "Vielen Dank für Ihr Interesse an einer Zusammenarbeit mit LSA GLOBAL. Für die Prüfung Ihres Übersetzungs-/Dolmetschprofils senden Sie bitte Namen, Arbeitssprachen/Sprachpaare, Land/Stadt, Leistungsbereiche, Verfügbarkeit und ggf. Lebenslauf oder Profil-Link. Unser Team prüft dies und meldet sich.",
    it: "Grazie per l’interesse a collaborare con LSA GLOBAL. Per valutare il suo profilo di traduzione/interpretariato, insegnamento, tecnologia o AI/sistemi, invii nome completo, lingue/competenze, paese/città, aree di servizio, disponibilità e CV o link profilo se disponibile. Il team esaminerà e risponderà.",
    pt: "Obrigado pelo interesse em colaborar com a LSA GLOBAL. Para avaliação do seu perfil de tradução/interpretação, ensino, tecnologia ou IA/sistemas, envie nome completo, línguas/competências, país/cidade, áreas de serviço, disponibilidade e CV ou link de perfil se disponível. A nossa equipa analisará e responderá.",
    ar: "شكراً لاهتمامك بالتعاون مع LSA GLOBAL. لمراجعة ملفك في الترجمة أو الترجمة الفورية أو التدريس أو التكنولوجيا أو أنظمة الذكاء الاصطناعي، يرجى إرسال الاسم الكامل، اللغات/المهارات، البلد/المدينة، مجالات الخدمة، التوفر، والسيرة الذاتية أو رابط ملف مهني إن وجد.",
    zh: "感谢您有兴趣与 LSA GLOBAL 合作。请发送姓名、语言/技能、国家/城市、服务领域、可用时间，以及简历或个人资料链接（如有），以便我们评估翻译、口译、教学、技术或 AI/系统合作。",
    ja: "LSA GLOBAL との協業にご関心をお寄せいただきありがとうございます。翻訳・通訳・教育・技術・AI/システム分野の確認のため、氏名、言語/スキル、国/都市、対応分野、稼働状況、CVまたはプロフィールリンクをご送付ください。",
    da: "Tak for din interesse i at samarbejde med LSA GLOBAL. Send venligst fulde navn, sprog/færdigheder, land/by, serviceområder, tilgængelighed og CV eller profillink, så vi kan vurdere oversættelse, tolkning, undervisning, teknologi eller AI/system-samarbejde."
  };
  return messages[safeSubtype]?.[language] || messages[safeSubtype]?.en || messages.unknown_provider.en;
}

function getProviderSubtypeClarificationReply(languageCode) {
  return getProviderCollaborationIntakeReply(languageCode, "unknown_provider");
}

function getTranslationRoleClarificationReply(languageCode) {
  const language = normalizeLanguageCode(languageCode);
  const messages = {
    en: "Are you requesting a translation service, or are you a translator/freelancer looking to work with LSA GLOBAL?",
    fr: "Souhaitez-vous demander un service de traduction, ou êtes-vous traducteur/freelance souhaitant collaborer avec LSA GLOBAL ?",
    es: "¿Solicita un servicio de traducción, o es traductor/freelancer y desea trabajar con LSA GLOBAL?",
    de: "Benötigen Sie einen Übersetzungsservice, oder sind Sie Übersetzer/Freelancer und möchten mit LSA GLOBAL zusammenarbeiten?",
    it: "Sta richiedendo questo servizio, oppure desidera collaborare con LSA GLOBAL come fornitore/freelancer in quest’area?",
    pt: "Está a solicitar este serviço, ou deseja colaborar com a LSA GLOBAL como prestador/freelancer nesta área?",
    ar: "هل تطلب هذه الخدمة، أم ترغب في التعاون مع LSA GLOBAL كمقدّم خدمة/فريلانسر في هذا المجال؟",
    zh: "您是想申请这项服务，还是希望作为服务提供者/自由职业者与 LSA GLOBAL 在该领域合作？",
    ja: "このサービスを依頼されていますか、それともこの分野で提供者/フリーランサーとして LSA GLOBAL と協業を希望されていますか？",
    da: "Anmoder du om denne service, eller ønsker du at samarbejde med LSA GLOBAL som leverandør/freelancer på dette område?"
  };
  return messages[language] || messages.en;
}


function getGeneralizedRoleClarificationReply(languageCode, serviceIntent = "") {
  const language = normalizeLanguageCode(languageCode);
  const serviceLabel = String(serviceIntent || "this area").replace(/_/g, " ");
  const messages = {
    en: `Are you requesting ${serviceLabel}, or are you offering to work with LSA GLOBAL in this area?`,
    fr: `Souhaitez-vous demander ${serviceLabel}, ou proposez-vous de collaborer avec LSA GLOBAL dans ce domaine ?`,
    es: `¿Solicita ${serviceLabel}, o desea trabajar con LSA GLOBAL en esta área?`,
    de: `Benötigen Sie ${serviceLabel}, oder möchten Sie in diesem Bereich mit LSA GLOBAL zusammenarbeiten?`,
    it: `Sta richiedendo ${serviceLabel}, oppure desidera collaborare con LSA GLOBAL in quest’area?`,
    pt: `Está a solicitar ${serviceLabel}, ou deseja colaborar com a LSA GLOBAL nesta área?`,
    ar: "هل تطلب هذه الخدمة، أم تعرض العمل/التعاون مع LSA GLOBAL في هذا المجال؟",
    zh: "您是想申请这项服务，还是希望在该领域与 LSA GLOBAL 合作？",
    ja: "このサービスを依頼されていますか、それともこの分野で LSA GLOBAL と協業を希望されていますか？",
    da: "Anmoder du om denne service, eller tilbyder du at samarbejde med LSA GLOBAL på dette område?"
  };
  return messages[language] || messages.en;
}

function getPromptKey(reply = "") {
  const normalized = normalizeForIntent(reply);
  if (!normalized) return "empty";
  if (/\b(for translation|pour la traduction|para traduccion|para tradução|übersetzung|traduzione).*\b(language pair|paire de langues|par de idiomas|coppia linguistica|sprachpaar|par de linguas)\b/i.test(normalized)) {
    return "translation_language_pair";
  }
  return normalized.slice(0, 120);
}

function applyLiveLoopProtection({ waId, userState, branch, reply, language, intentShiftDetected = false, detectedDomain = "general" }) {
  const promptKey = getPromptKey(reply);
  const previousPromptKey = userState?.lastPromptKey || null;
  const previousCount = Number(userState?.repeatedPromptCount || 0);
  const nextCount = previousPromptKey === promptKey ? previousCount + 1 : 1;
  let finalReply = reply;
  let finalBranch = branch;
  let finalAction = "none";
  let finalPromptKey = promptKey;
  let finalRepeatedPromptCount = nextCount;

  if (nextCount > LIVE_PROMPT_REPEAT_THRESHOLD) {
    finalBranch = detectedDomain === "translation" ? "live_translation_loop_role_clarification" : "live_loop_manual_review";
    finalReply = detectedDomain === "translation"
      ? getTranslationRoleClarificationReply(language)
      : getSafeHandoffMessage(language);
    finalAction = detectedDomain === "translation" ? "role_clarification" : "manual_review";
    finalPromptKey = getPromptKey(finalReply);
    finalRepeatedPromptCount = 1;
  }

  setCustomerState(waId, {
    lastPromptKey: finalPromptKey,
    repeatedPromptCount: finalRepeatedPromptCount,
    lastRoute: finalBranch,
    intentShiftDetected
  });

  console.log("[conversation-flow-guard]", JSON.stringify({
    current_branch: branch,
    detected_domain: detectedDomain,
    previous_prompt_key: previousPromptKey,
    prompt_key: finalPromptKey,
    repeated_prompt_count: finalRepeatedPromptCount,
    max_repetition_threshold: LIVE_PROMPT_REPEAT_THRESHOLD,
    intent_shift_detected: Boolean(intentShiftDetected),
    loop_protection_action: finalAction,
    final_route_chosen: finalBranch
  }));

  return {
    reply: finalReply,
    branch: finalBranch,
    controlledAction: finalAction,
    repeatedPromptCount: finalRepeatedPromptCount,
    promptKey: finalPromptKey
  };
}

function normalizeLiveDomain(menuOption) {
  const normalized = normalizeForIntent(menuOption || "");
  if (!normalized) return "";
  if (["courses", "course", "language_course", "exam_prep"].includes(normalized)) return "courses";
  if (["translation", "translations", "certified_translation"].includes(normalized)) return "translation";
  if (["provider", "providers", "provider_collaboration", "collaborator", "collaboration", "freelancer", "translator_provider", "language_provider"].includes(normalized)) return "provider_collaboration";
  if (["interpreting", "interpretation", "interpreter"].includes(normalized)) return "interpreting";
  if (["registration", "enrollment", "enrolment"].includes(normalized)) return "registration";
  if (["location", "address", "branch", "office", "contact"].includes(normalized)) return "location";
  if (["certificate", "certificates", "attestation", "verification"].includes(normalized)) return "certificates";
  if (["policy", "policies", "refund", "support"].includes(normalized)) return "policy";
  if (["tech", "technology", "tech_services", "ai", "ai_automation", "automation", "systems"].includes(normalized)) return "provider_collaboration";
  return "";
}

function detectLiveDomainTopic(text = "", state = {}) {
  const fromState = normalizeLiveDomain(state?.liveMenuOption || state?.topicDomain || "");
  if (fromState) return fromState;
  const normalized = normalizeForIntent(text);
  if (!normalized) return "";
  if (/\b(course|courses|cours|curso|corsi|corso|class|formation|language training|exam prep|ielts|toefl|tef|toeic)\b/.test(normalized)) return "courses";
  if (detectProviderCollaborationIntent(text).detected) return "provider_collaboration";
  if (/\b(translation|traduction|traduccion|traduzione|translate|certified translation|sworn translation|localized|localization|editing|proofreading|writing)\b/.test(normalized)) return "translation";
  if (/\b(interpreting|interpretation|interpreter|interpretariat|interpretazione|interprétation|dolmetsch)\b/.test(normalized)) return "interpreting";
  if (/\b(register|registration|enroll|enrollment|inscription|admission|apply)\b/.test(normalized)) return "registration";
  if (/\b(location|address|branch|office|campus|city|country|where are you|contact)\b/.test(normalized)) return "location";
  if (/\b(certificate|certification|attestation|verification|verify|proof)\b/.test(normalized)) return "certificates";
  if (/\b(policy|refund|absence|support|help|issue|problem|partner|provider)\b/.test(normalized)) return "policy";
  return "";
}

function extractLiveClarificationSlots(menuOption, text = "", state = {}) {
  const resolvedDomain = normalizeLiveDomain(menuOption) || detectLiveDomainTopic(text, state);
  const priorSlots = state?.liveKnownSlots || {};
  const normalized = normalizeForIntent(text);
  const slots = { ...priorSlots };
  if (!normalized) return slots;

  if (resolvedDomain === "courses") {
    const language = detectCourseLanguageMention(text) || priorSlots.language || null;
    const levelMatch = normalized.match(/\b(a1|a2|b1|b2|c1|c2|beginner|debutant|débutant|intermediate|advanced)\b/i);
    const variantDetection = detectRequestedSubVariant(text, { topicSubVariant: priorSlots.course_variant || null });
    const formatMatch = normalized.match(/\b(online|in person|in-person|onsite|on site|presentiel|présentiel|private|prive|privé|intensive|intensif|standard)\b/i);
    const pricingIntent = /\b(price|pricing|fees|fee|prix|precio|prezzo|tarif)\b/i.test(normalized);
    const durationIntent = /\b(duration|duree|durée|duracion|duración|durata|how long|length)\b/i.test(normalized);
    const scheduleIntent = /\b(schedule|horaire|horario|orario|time|timetable)\b/i.test(normalized);
    slots.language = language;
    if (levelMatch) slots.level = levelMatch[1].toLowerCase();
    if (formatMatch) slots.format = formatMatch[1].toLowerCase();
    if (variantDetection?.subVariant) slots.course_variant = variantDetection.subVariant;
    if (pricingIntent) slots.pricing_intent = "true";
    if (durationIntent) slots.duration_intent = "true";
    if (scheduleIntent) slots.schedule_intent = "true";
    return slots;
  }

  if (resolvedDomain === "translation") {
    const languages = detectServiceLanguages(text);
    const looseLanguagePair = extractLooseLanguagePair(text);
    const dateMatch = normalized.match(/\b(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}-\d{2}-\d{2}|today|tomorrow|aujourd hui|demain)\b/i);
    const docMatch = normalized.match(/\b(passport|contract|certificate|transcript|birth certificate|diploma|degree|marriage certificate|bank statement|invoice|document|pdf|docx?)\b/i);
    const pageMatch = normalized.match(/\b(\d{1,3})\s*(pages?|p|pp)\b/i);
    if (languages.length >= 2) slots.language_pair = `${languages[0]}-${languages[1]}`;
    if (!slots.language_pair && looseLanguagePair) slots.language_pair = looseLanguagePair;
    if (docMatch) slots.document_type = docMatch[1].toLowerCase();
    if (dateMatch) slots.deadline = dateMatch[1].toLowerCase();
    if (pageMatch) slots.pages = pageMatch[1];
    return slots;
  }

  if (resolvedDomain === "interpreting") {
    const languages = detectServiceLanguages(text);
    const formatMatch = normalized.match(/\b(online|on site|onsite|in person|in-person|presentiel|présentiel)\b/i);
    const dateMatch = normalized.match(/\b(\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?|\d{4}-\d{2}-\d{2}|today|tomorrow|aujourd hui|demain)\b/i);
    const durationMatch = normalized.match(/\b(\d{1,3}\s*(hours?|hrs?|h|minutes?|mins?))\b/i);
    const locationMatch = normalized.match(/\b(in|at)\s+([a-z][a-z\s-]{1,40})\b/i);
    if (languages.length >= 2) slots.language_pair = `${languages[0]}-${languages[1]}`;
    if (formatMatch) slots.format = formatMatch[1].toLowerCase();
    if (dateMatch) slots.date = dateMatch[1].toLowerCase();
    if (durationMatch) slots.duration = durationMatch[1].toLowerCase();
    if (locationMatch?.[2]) slots.location = locationMatch[2].trim().toLowerCase();
    return slots;
  }

  if (resolvedDomain === "registration") {
    const examMatch = normalized.match(/\b(ielts|toefl|tef|toeic|delf|dalf|course|program|programme|translation|interpreting)\b/i);
    if (examMatch) slots.program = examMatch[1].toLowerCase();
    return slots;
  }

  if (resolvedDomain === "location") {
    const branchMatch = normalized.match(/\b(uk|united kingdom|usa|united states|cameroon|douala|yaounde|london|new york)\b/i);
    if (branchMatch) slots.location = branchMatch[1].toLowerCase();
    return slots;
  }

  if (resolvedDomain === "certificates") {
    const certMatch = normalized.match(/\b(certificate|attestation|verification|tef|ielts|toefl|training certificate)\b/i);
    if (certMatch) slots.certificate_type = certMatch[1].toLowerCase();
    return slots;
  }

  if (resolvedDomain === "policy") {
    const policyMatch = normalized.match(/\b(refund|absence|payment|support|privacy|terms|complaint)\b/i);
    if (policyMatch) slots.policy_type = policyMatch[1].toLowerCase();
    return slots;
  }

  return slots;
}

function getLiveDomainMissingSlots(domain, knownSlots = {}) {
  const rules = {
    courses: ["language", "level", "format"],
    translation: ["language_pair", "document_type", "deadline"],
    interpreting: ["language_pair", "date", "format"],
    registration: ["program"],
    location: ["location"],
    certificates: ["certificate_type"],
    policy: ["policy_type"]
  };
  const required = rules[domain] || [];
  return required.filter((slot) => !knownSlots?.[slot]);
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

function humanizeEntityKey(entityKey) {
  if (!entityKey) return "";
  return String(entityKey)
    .replace(/_/g, " ")
    .replace(/\b(course|service|prep|process)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function getLocalizedTruthfulnessFallback({
  language = "en",
  requestedEntity = null,
  requestedField = null,
  reason = "field_unavailable"
}) {
  const entityLabel = humanizeEntityKey(requestedEntity) || "this topic";
  const fieldLabel = humanizeEntityKey(requestedField) || "this information";
  const messages = {
    en: {
      field_unavailable: `I can’t confirm ${fieldLabel} for ${entityLabel} in the KB yet. Please share the exact variant, or I can hand this to an LSA GLOBAL advisor.`,
      entity_not_found: `I could not find a reliable KB record for ${entityLabel} yet. I can connect you with an LSA GLOBAL advisor.`
    },
    es: {
      field_unavailable: `No puedo confirmar ${fieldLabel} para ${entityLabel} en la base de conocimiento todavía. Indique la variante exacta, o puedo derivarlo a un asesor de LSA GLOBAL.`,
      entity_not_found: `No encontré un registro fiable en la base de conocimiento para ${entityLabel} todavía. Puedo derivarlo a un asesor de LSA GLOBAL.`
    },
    fr: {
      field_unavailable: `Je ne peux pas confirmer ${fieldLabel} pour ${entityLabel} dans la base de connaissance pour le moment. Précisez la variante exacte, ou je peux transférer à un conseiller LSA GLOBAL.`,
      entity_not_found: `Je n’ai pas trouvé d’article KB fiable pour ${entityLabel} pour le moment. Je peux transférer vers un conseiller LSA GLOBAL.`
    },
    it: {
      field_unavailable: `Non posso confermare ${fieldLabel} per ${entityLabel} nella base di conoscenza al momento. Indichi la variante precisa, oppure posso inoltrare a un consulente LSA GLOBAL.`,
      entity_not_found: `Non ho trovato un record KB affidabile per ${entityLabel} al momento. Posso inoltrare a un consulente LSA GLOBAL.`
    },
    pt: {
      field_unavailable: `Ainda não consigo confirmar ${fieldLabel} para ${entityLabel} na base de conhecimento. Indique a variante exata, ou posso encaminhar para um consultor da LSA GLOBAL.`,
      entity_not_found: `Ainda não encontrei um registo KB fiável para ${entityLabel}. Posso encaminhar para um consultor da LSA GLOBAL.`
    },
    de: {
      field_unavailable: `Ich kann ${fieldLabel} für ${entityLabel} in der Wissensdatenbank noch nicht bestätigen. Bitte nennen Sie die genaue Variante, oder ich leite an einen LSA GLOBAL-Berater weiter.`,
      entity_not_found: `Ich habe noch keinen verlässlichen KB-Eintrag für ${entityLabel} gefunden. Ich kann an einen LSA GLOBAL-Berater weiterleiten.`
    }
  };
  const selectedLanguage = messages[language] ? language : "en";
  const selectedReason = reason === "entity_not_found" ? "entity_not_found" : "field_unavailable";
  return finalizeCourseMessage(messages[selectedLanguage][selectedReason]);
}

function isSourceConfirmedForField({
  retrievalResult,
  match,
  requestedLanguage = null
}) {
  if (!retrievalResult?.requested_field || !match?.raw_reference) return false;
  if (requestedLanguage && isCourseLanguageMismatch(requestedLanguage, match.raw_reference)) return false;
  const extracted = extractRelevantKbSection(
    extractAnswerTextFromRetrievalMatch(match),
    retrievalResult.requested_field,
    { subVariant: retrievalResult.sub_variant || null }
  );
  return Boolean(extracted && extracted.trim());
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

function getCourseLanguageFromEntityKey(entityKey) {
  if (!entityKey) return null;
  const match = String(entityKey).match(/^([a-z]+)_course$/);
  return match?.[1] || null;
}

function isMatchEntityLocked({
  retrievalResult,
  match,
  requestedLanguage = null
}) {
  if (!match?.raw_reference) return false;
  const requestedEntityCourseLanguage = getCourseLanguageFromEntityKey(retrievalResult?.entity);
  const strictCourseLanguage = requestedLanguage || requestedEntityCourseLanguage;
  if (strictCourseLanguage && isCourseLanguageMismatch(strictCourseLanguage, match.raw_reference)) {
    return false;
  }
  if (requestedEntityCourseLanguage) {
    const candidateLanguage = detectArticleCourseLanguage(match.raw_reference);
    if (candidateLanguage && candidateLanguage !== requestedEntityCourseLanguage) {
      return false;
    }
  }
  return true;
}

function buildNarrowFieldTruthfulnessContext({
  text = "",
  retrievalResult = null,
  requestedLanguage = null,
  resolvedIntent = null,
  userState = null
}) {
  const requestedEntity = retrievalResult?.entity
    || (requestedLanguage ? `${requestedLanguage}_course` : null)
    || userState?.topicEntity
    || null;
  const entityLockedMatches = (retrievalResult?.matches || []).filter((match) => isMatchEntityLocked({
    retrievalResult: { ...(retrievalResult || {}), entity: requestedEntity },
    match,
    requestedLanguage
  }));
  const entityExistsInKb = Boolean(requestedEntity && entityLockedMatches.length);
  const fieldExistsForEntity = Boolean(entityExistsInKb && entityLockedMatches.find((match) => isSourceConfirmedForField({
    retrievalResult: { ...(retrievalResult || {}), entity: requestedEntity, requested_field: resolvedIntent },
    match,
    requestedLanguage
  })));
  const queryTokens = normalizeText(text).split(/\s+/).filter(Boolean);
  const queryLooksEntitySpecific = queryTokens.length <= 8 || Boolean(requestedLanguage) || Boolean(retrievalResult?.entity);
  return {
    requestedEntity,
    entityLockedMatches,
    entityExistsInKb,
    fieldExistsForEntity,
    queryLooksEntitySpecific
  };
}

async function runDeterministicFieldExtraction({
  retrievalResult,
  requestedLanguage,
  fieldIntent,
  detectedLanguage,
  requestedSubVariant = null
}) {
  const resolvedFieldIntent = resolveNarrowIntent(fieldIntent);
  if (!resolvedFieldIntent) {
    return { text: null, usedFallback: true, reason: "missing_field_intent" };
  }

  const sourcePriority = ["kb_articles", "kb_capture_assistant", "kb_quick_capture", "providers"];
  const candidateMatches = (retrievalResult?.matches || [])
    .filter((match) => match?.source && sourcePriority.includes(match.source))
    .filter((match) => {
      if (!retrievalResult?.entity_domain) return true;
      return !match.record_domain || match.record_domain === "general" || match.record_domain === retrievalResult.entity_domain;
    })
    .filter((match) => isMatchEntityLocked({
      retrievalResult,
      match,
      requestedLanguage
    }));

  const orderedCandidates = candidateMatches.sort((a, b) => sourcePriority.indexOf(a.source) - sourcePriority.indexOf(b.source));
  const fallbackCourseArticle = requestedLanguage && retrievalResult?.entity_domain === "course"
    ? await findCourseArticleByLanguage(requestedLanguage)
    : null;
  const selectedMatch = orderedCandidates[0] || (fallbackCourseArticle ? { title: fallbackCourseArticle.title, raw_reference: fallbackCourseArticle, source: "kb_articles" } : null);
  const selectedTitle = selectedMatch?.title || null;
  const selectedEntity = selectedMatch?.title || selectedMatch?.category || null;

  console.log("[deterministic-retrieval-debug]", JSON.stringify({
    detected_entity: retrievalResult?.entity || requestedLanguage || "unknown",
    detected_field_intent: resolvedFieldIntent,
    candidate_article_count: candidateMatches.length,
    selected_article_title: selectedTitle,
    selected_entity: selectedEntity
  }));

  if (!selectedMatch?.raw_reference) {
    return {
      text: null,
      usedFallback: true,
      reason: "no_matching_article",
      blockedForTruthfulness: true,
      fieldSourceConfirmed: false,
      selectedEntity
    };
  }

  const articleText = extractAnswerTextFromRetrievalMatch(selectedMatch);
  const extracted = extractRelevantKbSection(articleText, resolvedFieldIntent, { subVariant: requestedSubVariant });
  const localized = extracted
    ? await localizeNarrowAnswer({
      text: extracted,
      language: detectedLanguage,
      preserveCompleteness: resolvedFieldIntent === "fees",
      applyStyle: false
    })
    : null;

  const success = Boolean(localized && localized.trim());
  const fieldSourceConfirmed = Boolean(extracted && extracted.trim());
  const blockedForTruthfulness = !fieldSourceConfirmed;
  console.log("[deterministic-retrieval-debug]", JSON.stringify({
    detected_entity: retrievalResult?.entity || requestedLanguage || "unknown",
    selected_entity: selectedEntity,
    detected_field_intent: resolvedFieldIntent,
    selected_article_title: selectedTitle,
    selected_source: selectedMatch?.source || "unknown",
    selected_sub_variant: requestedSubVariant || null,
    extraction_section_used: resolvedFieldIntent,
    source_confirmed_field_exists: fieldSourceConfirmed,
    deterministic_field_extraction_succeeded: success,
    truthfulness_blocked: blockedForTruthfulness,
    fallback_used: !success,
    fallback_reason: success ? null : "field_not_found_or_empty"
  }));

  if (success) return {
    text: localized,
    usedFallback: false,
    reason: null,
    blockedForTruthfulness: false,
    fieldSourceConfirmed: true,
    selectedEntity
  };
  return {
    text: null,
    usedFallback: true,
    reason: "field_not_found_or_empty",
    blockedForTruthfulness: true,
    fieldSourceConfirmed: false,
    selectedEntity
  };
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

function buildCompactStructuredSummary(match, language = "en") {
  if (!match) return "";
  const title = String(match.title || "Internal knowledge").trim();
  const category = String(match.category || match.source || "knowledge").trim();
  const snippet = String(match.snippet || "").trim();
  const lines = [];
  lines.push(`• Topic: ${title}`);
  lines.push(`• Source: ${category}`);
  if (snippet) lines.push(`• Summary: ${snippet}`);
  if (language === "fr") {
    lines.push("Souhaitez-vous un point précis (tarifs, durée, horaires, niveaux, localisation, inscription) ?");
  }
  return finalizeCourseMessage(lines.join("\n"), 520);
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

  if (resolvedIntent && intentFocused) {
    return localizeNarrowAnswer({
      text: intentFocused,
      language,
      preserveCompleteness: resolvedIntent === "fees"
    });
  }

  const compactSummary = buildCompactStructuredSummary(topMatch, language);
  if (compactSummary) {
    return localizeNarrowAnswer({
      text: compactSummary,
      language,
      preserveCompleteness: false,
      applyStyle: false
    });
  }

  return localizeNarrowAnswer({
    text: directText,
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
  sent_reply_language = null,
  conversation_owner = null,
  human_takeover = null,
  last_human_reply_at = null,
  last_customer_message_at = null,
  conversation_type = null,
  followup_eligible = null,
  automation_policy = null,
  bot_suppressed_reason = null,
  ownership_event = null
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
    sent_reply_language,
    conversation_owner,
    human_takeover,
    last_human_reply_at,
    last_customer_message_at,
    conversation_type,
    followup_eligible,
    automation_policy,
    bot_suppressed_reason,
    ownership_event
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
  sent_reply_language = null,
  conversation_owner = null,
  human_takeover = null,
  last_human_reply_at = null,
  last_customer_message_at = null,
  conversation_type = null,
  followup_eligible = null,
  automation_policy = null,
  bot_suppressed_reason = null,
  ownership_event = null
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
    sent_reply_language,
    conversation_owner,
    human_takeover,
    last_human_reply_at,
    last_customer_message_at,
    conversation_type,
    followup_eligible,
    automation_policy,
    bot_suppressed_reason,
    ownership_event
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
  const retrieval = await retrieveInternalKnowledgeForTestMode(rawMessage, {
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

  const routingLanguage = detectRoutingLanguage(text, "");
  if (routingLanguage && SUPPORTED_LIVE_MODE_LANGUAGES.includes(routingLanguage)) return routingLanguage;

  if (/[\u0600-\u06ff]/.test(value)) return "ar";
  if (/[\u4e00-\u9fff]/.test(value)) return "zh";
  if (/[\u3040-\u30ff]/.test(value)) return "ja";
  if (/[\u0400-\u04ff]/.test(value)) return "ru";

  if (/[àâæçéèêëîïôœùûüÿ]/.test(value) || /\b(bonjour|merci|cours|prix|tarif|inscription|formation|horaire|enseignant|enseignante|professeur|formateur|formatrice|traducteur|traductrice|interprete|interprète|poste|emploi)\b/.test(value)) {
    return "fr";
  }
  if (/[¿¡ñáéíóú]/.test(value) || /\b(hola|gracias|curso|precio|horario|duración|inscripción|profesor|profesora|docente|traductor|traductora|interprete|puesto|empleo)\b/.test(value)) {
    return "es";
  }
  if (/[äöüß]/.test(value) || /\b(hallo|danke|kurs|preis|zeitplan|dauer|lehrer|lehrerin|dozent|ubersetzer|uebersetzer|dolmetscher|stelle)\b/.test(value)) {
    return "de";
  }
  if (/\b(ciao|grazie|corso|prezzo|orario|durata|insegnante|docente|traduttore|traduttrice|interprete|lavoro)\b/.test(value)) {
    return "it";
  }
  if (/[ãõçáâàéêíóôú]/.test(value) || /\b(ola|olá|obrigado|obrigada|curso|preco|preço|horario|horário|duração|inscricao|inscrição|professor|professora|instrutor|tradutor|tradutora|interprete|trabalho)\b/.test(value)) {
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
  const normalized = combined.replace(/["']/g, "");
  const patterns = [
    /column (?:[a-zA-Z0-9_]+\.)?([a-zA-Z0-9_]+) does not exist/i,
    /Could not find the ([a-zA-Z0-9_]+) column of [a-zA-Z0-9_]+ in the schema cache/i,
    /([a-zA-Z0-9_]+)\s+column/i
  ];

  for (const source of [combined, normalized]) {
    for (const pattern of patterns) {
      const match = source.match(pattern);
      if (match?.[1]) return match[1];
    }
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
  if (!openai) return safeText;
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
    logAiLayerFailure(error, "inbound_translation");
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


const CONVERSATION_TYPES = Object.freeze([
  "prospect",
  "client",
  "support",
  "provider",
  "freelancer",
  "job_seeker",
  "other_business_contact"
]);

const FOLLOWUP_ELIGIBLE_TYPES = new Set(["prospect", "client"]);

function hasAnyKeyword(value, keywords) {
  const textValue = String(value || "").toLowerCase();
  return keywords.some((keyword) => textValue.includes(keyword));
}

function classifyConversationType({ text = "", previousType = null } = {}) {
  const normalizedPreviousType = CONVERSATION_TYPES.includes(previousType) ? previousType : null;
  const value = String(text || "").toLowerCase();

  if (hasAnyKeyword(value, ["freelance", "freelancer", "translator cv", "interpreter cv", "linguist", "vendor application", "available for translation", "i offer translation", "je suis traducteur", "je suis traductrice"])) {
    return "freelancer";
  }
  if (hasAnyKeyword(value, ["provider", "supplier", "vendor", "partnership", "outsourcing", "collaboration proposal", "agency partnership"])) {
    return "provider";
  }
  if (hasAnyKeyword(value, ["job", "vacancy", "career", "cv", "resume", "application", "internship", "recruitment", "hiring", "emploi", "stage"])) {
    return "job_seeker";
  }
  if (hasAnyKeyword(value, ["support", "issue", "problem", "complaint", "not working", "refund", "invoice", "receipt", "my order", "existing project", "ticket"])) {
    return "support";
  }
  if (hasAnyKeyword(value, ["my course", "my class", "my translation", "our account", "existing client", "we worked", "previous order", "ongoing project"])) {
    return "client";
  }
  if (hasAnyKeyword(value, ["quote", "price", "fee", "fees", "cost", "course", "training", "translation", "translate", "interpreting", "service", "exam", "ielts", "toefl", "register", "enrol", "enroll", "devis", "tarif", "prix", "cours", "formation", "traduction"])) {
    return "prospect";
  }

  return normalizedPreviousType || "other_business_contact";
}

function determineFollowupEligibility(conversationType, { humanTakeover = false } = {}) {
  if (humanTakeover) {
    return {
      eligible: false,
      policy: "human_owned_silence_default"
    };
  }
  if (FOLLOWUP_ELIGIBLE_TYPES.has(conversationType)) {
    return {
      eligible: true,
      policy: "eligible_after_meaningful_inactivity"
    };
  }
  return {
    eligible: false,
    policy: `not_eligible_for_${conversationType || "unknown"}`
  };
}

function isManualHumanReplyRow(row) {
  if (!row) return false;
  if (String(row.direction || "") !== "out") return false;
  if (row.staff_reply_text || row.sent_reply_text) return true;
  if (row.ownership_event === "human_takeover") return true;
  return false;
}

async function getConversationOwnershipState(waId) {
  const emptyState = {
    exists: false,
    owner: "bot",
    humanTakeover: false,
    lastHumanReplyAt: null,
    lastCustomerMessageAt: null,
    conversationType: "other_business_contact",
    followupEligible: false,
    automationPolicy: "new_conversation_default",
    latestOwnershipEvent: null
  };
  if (!waId) return emptyState;

  const fullSelect = "id, created_at, direction, body, staff_reply_text, sent_reply_text, conversation_owner, human_takeover, last_human_reply_at, last_customer_message_at, conversation_type, followup_eligible, automation_policy, ownership_event";
  let { data, error } = await supabase
    .from("conversations")
    .select(fullSelect)
    .eq("wa_id", waId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error && extractMissingColumnName(error)) {
    console.warn("[ownership] ownership columns unavailable; using legacy conversation scan", {
      wa_id: waId,
      missing_column: extractMissingColumnName(error)
    });
    const retry = await supabase
      .from("conversations")
      .select("id, created_at, direction, body, staff_reply_text, sent_reply_text")
      .eq("wa_id", waId)
      .order("created_at", { ascending: false })
      .limit(50);
    data = retry.data;
    error = retry.error;

    if (error && extractMissingColumnName(error)) {
      const coreRetry = await supabase
        .from("conversations")
        .select("id, created_at, direction, body")
        .eq("wa_id", waId)
        .order("created_at", { ascending: false })
        .limit(50);
      data = coreRetry.data;
      error = coreRetry.error;
    }
  }

  if (error || !Array.isArray(data) || !data.length) return emptyState;

  const latest = data[0] || {};
  const latestExplicitOwner = String(latest.conversation_owner || "").toLowerCase();
  const latestOwnershipEvent = latest.ownership_event || null;
  const latestHumanTakeover = latest.human_takeover === true;
  const manualResetActive = latestOwnershipEvent === "manual_reset" && latestExplicitOwner === "bot" && latest.human_takeover === false;
  const lastManualReply = data.find(isManualHumanReplyRow);
  const lastInbound = data.find((row) => String(row.direction || "") === "in");
  const inferredHumanTakeover = !manualResetActive && Boolean(lastManualReply);
  const humanTakeover = latestHumanTakeover || inferredHumanTakeover || latestExplicitOwner === "human";
  const owner = humanTakeover ? "human" : "bot";
  const previousType = CONVERSATION_TYPES.includes(latest.conversation_type) ? latest.conversation_type : null;
  const conversationType = previousType || classifyConversationType({ text: lastInbound?.body || latest.body || "" });
  const followup = determineFollowupEligibility(conversationType, { humanTakeover });

  return {
    exists: true,
    owner,
    humanTakeover,
    lastHumanReplyAt: latest.last_human_reply_at || lastManualReply?.created_at || null,
    lastCustomerMessageAt: latest.last_customer_message_at || lastInbound?.created_at || null,
    conversationType,
    followupEligible: latest.followup_eligible ?? followup.eligible,
    automationPolicy: latest.automation_policy || followup.policy,
    latestOwnershipEvent
  };
}

function buildInboundOwnershipState(previousState, inboundText, receivedAt = new Date().toISOString()) {
  const conversationType = classifyConversationType({
    text: inboundText,
    previousType: previousState?.conversationType
  });
  const humanTakeover = Boolean(previousState?.humanTakeover);
  const owner = humanTakeover ? "human" : "bot";
  const followup = determineFollowupEligibility(conversationType, { humanTakeover });
  return {
    conversation_owner: owner,
    human_takeover: humanTakeover,
    last_human_reply_at: previousState?.lastHumanReplyAt || null,
    last_customer_message_at: receivedAt,
    conversation_type: conversationType,
    followup_eligible: followup.eligible,
    automation_policy: followup.policy,
    bot_suppressed_reason: humanTakeover ? "human_takeover_active" : null,
    ownership_event: humanTakeover ? "human_owned_inbound" : (previousState?.exists ? "bot_owned_inbound" : "new_bot_owned_inbound")
  };
}

function buildBotOutboundOwnershipState(currentState) {
  const conversationType = currentState?.conversation_type || currentState?.conversationType || "other_business_contact";
  const followup = determineFollowupEligibility(conversationType, { humanTakeover: false });
  return {
    conversation_owner: "bot",
    human_takeover: false,
    last_human_reply_at: currentState?.last_human_reply_at || currentState?.lastHumanReplyAt || null,
    last_customer_message_at: currentState?.last_customer_message_at || currentState?.lastCustomerMessageAt || null,
    conversation_type: conversationType,
    followup_eligible: followup.eligible,
    automation_policy: followup.policy,
    bot_suppressed_reason: null,
    ownership_event: "bot_auto_reply"
  };
}

function buildHumanOutboundOwnershipState({ conversationType = "other_business_contact", lastCustomerMessageAt = null } = {}) {
  const now = new Date().toISOString();
  const followup = determineFollowupEligibility(conversationType, { humanTakeover: true });
  return {
    conversation_owner: "human",
    human_takeover: true,
    last_human_reply_at: now,
    last_customer_message_at: lastCustomerMessageAt,
    conversation_type: conversationType,
    followup_eligible: followup.eligible,
    automation_policy: followup.policy,
    bot_suppressed_reason: null,
    ownership_event: "human_takeover"
  };
}

async function updateConversationOwnershipRows(waId, ownershipPatch) {
  if (!waId || !ownershipPatch || typeof ownershipPatch !== "object") return;
  const safePatch = { ...ownershipPatch };
  while (Object.keys(safePatch).length) {
    const { error } = await supabase
      .from("conversations")
      .update(safePatch)
      .eq("wa_id", waId);
    if (!error) return;
    const missingColumn = extractMissingColumnName(error);
    if (missingColumn && missingColumn in safePatch) {
      console.warn("[ownership] schema-dependent ownership field unavailable; continuing without field", {
        wa_id: waId,
        missing_column: missingColumn,
        remaining_columns: Object.keys(safePatch).filter((key) => key !== missingColumn)
      });
      delete safePatch[missingColumn];
      continue;
    }
    console.warn("[ownership] update skipped", {
      wa_id: waId,
      error_message: error?.message || String(error)
    });
    return;
  }
}

function logOwnershipDecision({ waId, channel = "whatsapp", state, event = "state_selected" }) {
  console.log("[ownership] conversation owner selected", {
    channel,
    wa_id: waId,
    event,
    conversation_owner: state?.conversation_owner || state?.owner || null,
    human_takeover: state?.human_takeover ?? state?.humanTakeover ?? null,
    last_human_reply_at: state?.last_human_reply_at || state?.lastHumanReplyAt || null,
    last_customer_message_at: state?.last_customer_message_at || state?.lastCustomerMessageAt || null,
    conversation_type: state?.conversation_type || state?.conversationType || null,
    followup_eligible: state?.followup_eligible ?? state?.followupEligible ?? null,
    automation_policy: state?.automation_policy || state?.automationPolicy || null
  });
}

function applyMailHumanTakeover(thread, replyText) {
  if (!thread) return null;
  const currentType = classifyConversationType({
    text: [thread.subject, thread.preview, replyText].filter(Boolean).join(" "),
    previousType: thread.conversation_type
  });
  const takeover = buildHumanOutboundOwnershipState({
    conversationType: currentType,
    lastCustomerMessageAt: thread.last_customer_message_at || thread.timestamp || null
  });
  Object.assign(thread, {
    conversation_owner: takeover.conversation_owner,
    human_takeover: takeover.human_takeover,
    last_human_reply_at: takeover.last_human_reply_at,
    conversation_type: takeover.conversation_type,
    followup_eligible: takeover.followup_eligible,
    automation_policy: takeover.automation_policy,
    ownership_event: takeover.ownership_event
  });
  logOwnershipDecision({
    channel: "mail",
    waId: thread.thread_id,
    state: takeover,
    event: "human_takeover_activated"
  });
  return takeover;
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

function joinFieldsByLanguage(language, fields = []) {
  const safeFields = fields.filter(Boolean);
  if (!safeFields.length) return "";
  if (safeFields.length === 1) return safeFields[0];
  const conjunctionByLanguage = {
    fr: " et ",
    es: " y ",
    de: " und ",
    it: " e ",
    pt: " e "
  };
  const conjunction = conjunctionByLanguage[language] || " and ";
  return `${safeFields.slice(0, -1).join(", ")}${conjunction}${safeFields[safeFields.length - 1]}`;
}

function getLiveSafeMenuClarificationReply(languageCode, menuOption, knownSlots = {}) {
  const language = normalizeLanguageCode(languageCode);
  const resolvedDomain = normalizeLiveDomain(menuOption) || "general";
  const missingSlots = getLiveDomainMissingSlots(resolvedDomain, knownSlots);
  if (resolvedDomain === "courses") {
    const fieldLabels = {
      en: { language: "language", level: "level", format: "format", course_variant: "course variant" },
      fr: { language: "la langue", level: "le niveau", format: "le format", course_variant: "la variante du cours" },
      es: { language: "el idioma", level: "el nivel", format: "la modalidad", course_variant: "la variante del curso" },
      de: { language: "die Sprache", level: "das Niveau", format: "das Format", course_variant: "die Kursvariante" },
      it: { language: "la lingua", level: "il livello", format: "il formato", course_variant: "la variante del corso" },
      pt: { language: "o idioma", level: "o nível", format: "o formato", course_variant: "a variante do curso" }
    };
    const missing = missingSlots;
    if (!missing.length) {
      const completeByLanguage = {
        en: "Thank you. I have the required details. An advisor will confirm exact pricing and next steps.",
        fr: "Merci. J’ai les informations nécessaires. Un conseiller confirmera le tarif exact et la suite.",
        es: "Gracias. Ya tengo los datos necesarios. Un asesor confirmará el precio exacto y los siguientes pasos.",
        de: "Danke. Ich habe die nötigen Angaben. Ein Berater bestätigt den genauen Preis und die nächsten Schritte.",
        it: "Grazie. Ho le informazioni necessarie. Un consulente confermerà il prezzo esatto e i prossimi passi.",
        pt: "Obrigado. Já tenho os dados necessários. Um consultor confirmará o preço exato e os próximos passos."
      };
      return completeByLanguage[language] || completeByLanguage.en;
    }
    const languageLabelMap = fieldLabels[language] || fieldLabels.en;
    const missingList = joinFieldsByLanguage(language, missing.map((field) => languageLabelMap[field]));
    const languageDescriptor = knownSlots?.language
      ? {
        en: `for the ${knownSlots.language} course`,
        fr: `pour le cours de ${knownSlots.language}`,
        es: `para el curso de ${knownSlots.language}`,
        de: `für den ${knownSlots.language}-Kurs`,
        it: `per il corso di ${knownSlots.language}`,
        pt: `para o curso de ${knownSlots.language}`
      }[language] || `for the ${knownSlots.language} course`
      : {
        en: "for the language course",
        fr: "pour le cours de langues",
        es: "para el curso de idiomas",
        de: "für den Sprachkurs",
        it: "per il corso di lingua",
        pt: "para o curso de idiomas"
      }[language] || "for the language course";
    const responseByLanguage = {
      en: `For ${languageDescriptor.replace(/^for\s+/i, "")}, please specify ${missingList} (standard/intensive/online/private). Exact pricing will be confirmed by an advisor.`,
      fr: `${languageDescriptor.charAt(0).toUpperCase()}${languageDescriptor.slice(1)}, veuillez préciser ${missingList} (standard, intensif, en ligne ou privé). Le tarif exact sera confirmé par un conseiller.`,
      es: `${languageDescriptor.charAt(0).toUpperCase()}${languageDescriptor.slice(1)}, por favor precise ${missingList} (estándar, intensivo, online o privado). El precio exacto será confirmado por un asesor.`,
      de: `${languageDescriptor.charAt(0).toUpperCase()}${languageDescriptor.slice(1)}, bitte geben Sie ${missingList} an (Standard, Intensiv, Online oder Privat). Der genaue Preis wird von einem Berater bestätigt.`,
      it: `${languageDescriptor.charAt(0).toUpperCase()}${languageDescriptor.slice(1)}, indichi ${missingList} (standard, intensivo, online o privato). Il prezzo esatto sarà confermato da un consulente.`,
      pt: `${languageDescriptor.charAt(0).toUpperCase()}${languageDescriptor.slice(1)}, por favor indique ${missingList} (padrão, intensivo, online ou privado). O preço exato será confirmado por um consultor.`
    };
    return responseByLanguage[language] || responseByLanguage.en;
  }

  if (resolvedDomain === "translation") {
    const byLanguage = {
      en: {
        language_pair: "For translation, which language pair do you need?",
        document_type: "What document type is it?",
        deadline: "What is your deadline?"
      },
      fr: {
        language_pair: "Pour la traduction, quelle paire de langues souhaitez-vous ?",
        document_type: "Quel type de document s’agit-il ?",
        deadline: "Quelle est votre échéance ?"
      },
      es: {
        language_pair: "Para traducción, ¿qué par de idiomas necesita?",
        document_type: "¿Qué tipo de documento es?",
        deadline: "¿Cuál es su plazo?"
      },
      de: {
        language_pair: "Für die Übersetzung: Welches Sprachpaar benötigen Sie?",
        document_type: "Um welchen Dokumenttyp handelt es sich?",
        deadline: "Was ist Ihre Frist?"
      },
      it: {
        language_pair: "Per la traduzione, quale coppia linguistica le serve?",
        document_type: "Di quale tipo di documento si tratta?",
        deadline: "Qual è la sua scadenza?"
      },
      pt: {
        language_pair: "Para tradução, qual par de idiomas precisa?",
        document_type: "Que tipo de documento é?",
        deadline: "Qual é o seu prazo?"
      }
    };
    const firstMissing = missingSlots[0];
    if (firstMissing) return byLanguage[language]?.[firstMissing] || byLanguage.en[firstMissing];
  }

  if (resolvedDomain === "interpreting") {
    const byLanguage = {
      en: { language_pair: "For interpreting, which language pair do you need?", date: "For which date do you need interpreting?", format: "Do you need on-site or online interpreting?" },
      fr: { language_pair: "Pour l’interprétation, quelle paire de langues souhaitez-vous ?", date: "Pour quelle date avez-vous besoin d’interprétation ?", format: "Souhaitez-vous une interprétation sur site ou en ligne ?" },
      es: { language_pair: "Para interpretación, ¿qué par de idiomas necesita?", date: "¿Para qué fecha necesita la interpretación?", format: "¿Necesita interpretación presencial o en línea?" },
      de: { language_pair: "Für Dolmetschen: Welches Sprachpaar benötigen Sie?", date: "Für welches Datum benötigen Sie Dolmetschen?", format: "Benötigen Sie Dolmetschen vor Ort oder online?" },
      it: { language_pair: "Per l’interpretariato, quale coppia linguistica le serve?", date: "Per quale data le serve l’interpretariato?", format: "Le serve interpretariato in presenza o online?" },
      pt: { language_pair: "Para interpretação, qual par de idiomas precisa?", date: "Para que data precisa de interpretação?", format: "Precisa de interpretação presencial ou online?" }
    };
    const firstMissing = missingSlots[0];
    if (firstMissing) return byLanguage[language]?.[firstMissing] || byLanguage.en[firstMissing];
  }

  if (resolvedDomain === "registration" && missingSlots.includes("program")) {
    return {
      en: "Which program or exam do you want to register for?",
      fr: "Pour quel programme ou examen souhaitez-vous vous inscrire ?",
      es: "¿Para qué programa o examen desea inscribirse?",
      de: "Für welches Programm oder welche Prüfung möchten Sie sich anmelden?",
      it: "Per quale programma o esame desidera registrarsi?",
      pt: "Para qual programa ou exame deseja se inscrever?"
    }[language] || "Which program or exam do you want to register for?";
  }

  if (resolvedDomain === "location" && missingSlots.includes("location")) {
    return {
      en: "Which branch or country are you asking about?",
      fr: "De quelle agence ou de quel pays parlez-vous ?",
      es: "¿Sobre qué sede o país consulta?",
      de: "Zu welchem Standort oder Land haben Sie eine Frage?",
      it: "Di quale sede o paese sta parlando?",
      pt: "Sobre qual filial ou país está a perguntar?"
    }[language] || "Which branch or country are you asking about?";
  }

  if (resolvedDomain === "certificates" && missingSlots.includes("certificate_type")) {
    return {
      en: "Which certificate or attestation do you mean?",
      fr: "De quel certificat ou de quelle attestation s’agit-il ?",
      es: "¿A qué certificado o constancia se refiere?",
      de: "Welches Zertifikat oder welchen Nachweis meinen Sie?",
      it: "A quale certificato o attestazione si riferisce?",
      pt: "A que certificado ou atestado se refere?"
    }[language] || "Which certificate or attestation do you mean?";
  }

  if (resolvedDomain === "policy" && missingSlots.includes("policy_type")) {
    return {
      en: "Which policy topic do you need: refund, payment, absence, or support?",
      fr: "Quel sujet de politique souhaitez-vous : remboursement, paiement, absence ou assistance ?",
      es: "¿Qué política necesita: reembolso, pago, ausencia o soporte?",
      de: "Welches Richtlinienthema benötigen Sie: Erstattung, Zahlung, Abwesenheit oder Support?",
      it: "Quale policy le serve: rimborso, pagamento, assenza o supporto?",
      pt: "Que política precisa: reembolso, pagamento, ausência ou suporte?"
    }[language] || "Which policy topic do you need: refund, payment, absence, or support?";
  }

  if (resolvedDomain === "general") {
    return {
      en: "How can I help you today: courses, translation, interpreting, registration, location, or certificates?",
      fr: "Comment puis-je vous aider aujourd’hui : cours, traduction, interprétation, inscription, localisation ou certificats ?",
      es: "¿Cómo puedo ayudarle hoy: cursos, traducción, interpretación, inscripción, ubicación o certificados?",
      de: "Wie kann ich Ihnen heute helfen: Kurse, Übersetzung, Dolmetschen, Anmeldung, Standort oder Zertifikate?",
      it: "Come posso aiutarla oggi: corsi, traduzione, interpretariato, iscrizione, sede o certificati?",
      pt: "Como posso ajudar hoje: cursos, tradução, interpretação, inscrição, localização ou certificados?"
    }[language] || "How can I help you today: courses, translation, interpreting, registration, location, or certificates?";
  }

  const byOption = {
    translation: {
      en: "For translation, please share language pair, document type, and deadline. For exact pricing, an advisor will confirm after review.",
      fr: "Pour la traduction, indiquez la paire de langues, le type de document et l’échéance. Pour le tarif exact, un conseiller confirmera après vérification.",
      es: "Para traducción, indique par de idiomas, tipo de documento y plazo. Para precio exacto, un asesor lo confirmará tras revisión.",
      de: "Für Übersetzungen nennen Sie bitte Sprachpaar, Dokumenttyp und Frist. Den exakten Preis bestätigt ein Berater nach Prüfung.",
      it: "Per la traduzione, indichi coppia linguistica, tipo di documento e scadenza. Per il prezzo esatto, un consulente confermerà dopo verifica.",
      pt: "Para tradução, indique par de idiomas, tipo de documento e prazo. Para preço exato, um consultor confirmará após revisão."
    },
    courses: {
      en: "For language courses, please specify language, level, and format (standard/intensive/online/private). Exact pricing is confirmed by an advisor.",
      fr: "Pour les cours de langues, précisez la langue, le niveau et le format (standard/intensif/en ligne/privé). Le tarif exact est confirmé par un conseiller.",
      es: "Para cursos de idiomas, indique idioma, nivel y modalidad (estándar/intensiva/online/privada). El precio exacto lo confirma un asesor.",
      de: "Für Sprachkurse nennen Sie bitte Sprache, Niveau und Format (Standard/Intensiv/Online/Privat). Den genauen Preis bestätigt ein Berater.",
      it: "Per i corsi di lingua, indichi lingua, livello e formato (standard/intensivo/online/privato). Il prezzo esatto viene confermato da un consulente.",
      pt: "Para cursos de idiomas, indique idioma, nível e formato (padrão/intensivo/online/privado). O preço exato é confirmado por um consultor."
    },
    interpreting: {
      en: "For interpreting, do you need on-site or online support, and for which date/language pair? A human advisor confirms final pricing.",
      fr: "Pour l’interprétation, avez-vous besoin d’un service sur site ou en ligne, et pour quelle date/paire de langues ? Un conseiller confirme le tarif final.",
      es: "Para interpretación, ¿necesita servicio presencial u online y para qué fecha/par de idiomas? Un asesor confirma el precio final.",
      de: "Für Dolmetschen: Benötigen Sie Vor-Ort- oder Online-Service und für welches Datum/Sprachpaar? Ein Berater bestätigt den Endpreis.",
      it: "Per l’interpretariato, le serve servizio in presenza o online, e per quale data/coppia linguistica? Un consulente conferma il prezzo finale.",
      pt: "Para interpretação, precisa de serviço presencial ou online e para que data/par de idiomas? Um consultor confirma o preço final."
    },
    advisor: {
      en: "Thank you. Please share your name and WhatsApp number, and an LSA GLOBAL advisor will contact you shortly.",
      fr: "Merci. Partagez votre nom et numéro WhatsApp, et un conseiller LSA GLOBAL vous contactera rapidement.",
      es: "Gracias. Comparta su nombre y número de WhatsApp y un asesor de LSA GLOBAL le contactará pronto.",
      de: "Danke. Bitte teilen Sie Ihren Namen und Ihre WhatsApp-Nummer mit, ein LSA GLOBAL-Berater meldet sich zeitnah.",
      it: "Grazie. Condivida nome e numero WhatsApp e un consulente LSA GLOBAL la contatterà presto.",
      pt: "Obrigado. Partilhe nome e número WhatsApp e um consultor da LSA GLOBAL entrará em contacto em breve."
    }
  };
  return byOption[resolvedDomain]?.[language]
    || byOption[resolvedDomain]?.en
    || byOption[menuOption]?.[language]
    || byOption[menuOption]?.en
    || getControlledFallbackReply(language);
}

function detectClarificationTopic({ text = "", retrievalResult = null, userState = null }) {
  const normalized = normalizeForIntent(text);
  const hintedDomain = retrievalResult?.entity_domain || userState?.topicDomain || "";
  if (hintedDomain === "course") return "course";
  if (/\b(exam|examen|test|ielts|toefl|tef|toeic|certification|certificate)\b/.test(normalized)) return "exam_prep";
  if (/\b(interpreting|interpretation|interpreter|interpretariat|interpretazione|interprétation)\b/.test(normalized)) return "interpreting";
  if (/\b(translation|traduction|traduccion|traduzione|translate|certified translation|sworn translation)\b/.test(normalized)) return "translation";
  if (/\b(registration|register|inscription|enroll|admission)\b/.test(normalized)) return "registration";
  if (/\b(certificate|certification|attestation|proof|verification)\b/.test(normalized)) return "certificates";
  if (/\b(location|branch|office|centre|center|campus|city|adresse|address)\b/.test(normalized)) return "location";
  if (/\b(policy|policies|refund|terms|condition|privacy)\b/.test(normalized)) return "policy";
  if (/\b(help|support|issue|problem|bug|error)\b/.test(normalized)) return "support";
  return "general";
}

function getLocalizedClarifyingQuestion(language, { topic = "general", intent = null } = {}) {
  const feeClarify = {
    en: "Which option do you mean for pricing: standard, intensive, online, or private?",
    fr: "Pour le tarif, quel format voulez-vous : standard, intensif, en ligne ou privé ?",
    es: "Para el precio, ¿qué modalidad desea: estándar, intensiva, online o privada?",
    de: "Für den Preis: Welche Option meinen Sie – Standard, Intensiv, Online oder Privat?",
    it: "Per il prezzo, quale opzione intende: standard, intensivo, online o privato?",
    pt: "Para o preço, qual opção deseja: padrão, intensivo, online ou privado?"
  };

  const byTopic = {
    course: {
      en: "Which point do you want exactly: fee, duration, schedule, level, format, or registration?",
      fr: "Quel point voulez-vous précisément : tarif, durée, horaires, niveau, format ou inscription ?",
      es: "¿Qué punto desea exactamente: precio, duración, horario, nivel, modalidad o inscripción?",
      de: "Welchen Punkt möchten Sie genau: Preis, Dauer, Zeitplan, Niveau, Format oder Anmeldung?",
      it: "Quale punto desidera esattamente: prezzo, durata, orario, livello, formato o iscrizione?",
      pt: "Qual ponto deseja exatamente: preço, duração, horário, nível, formato ou inscrição?"
    },
    exam_prep: {
      en: "For exam prep, do you need pricing, schedule, format, or registration details?",
      fr: "Pour la préparation d’examen, voulez-vous le tarif, le planning, le format ou l’inscription ?",
      es: "Para preparación de exámenes, ¿necesita precio, horario, modalidad o inscripción?",
      de: "Für Prüfungsvorbereitung: Brauchen Sie Preis, Zeitplan, Format oder Anmeldung?",
      it: "Per la preparazione esami, le serve prezzo, orario, formato o iscrizione?",
      pt: "Para preparação para exames, precisa de preço, horário, formato ou inscrição?"
    },
    translation: {
      en: "For translation, which language pair do you need?",
      fr: "Pour la traduction, quelle combinaison de langues souhaitez-vous ?",
      es: "Para traducción, ¿qué combinación de idiomas necesita?",
      de: "Für Übersetzungen: Welche Sprachkombination benötigen Sie?",
      it: "Per la traduzione, quale combinazione linguistica le serve?",
      pt: "Para tradução, qual combinação de idiomas precisa?"
    },
    interpreting: {
      en: "For interpreting, do you need on-site or online service?",
      fr: "Pour l’interprétation, avez-vous besoin d’un service sur site ou en ligne ?",
      es: "Para interpretación, ¿necesita servicio presencial o en línea?",
      de: "Für Dolmetschen: Benötigen Sie vor Ort oder online?",
      it: "Per l’interpretariato, le serve un servizio in presenza o online?",
      pt: "Para interpretação, precisa de serviço presencial ou online?"
    },
    registration: {
      en: "Which program or service are you trying to register for?",
      fr: "Pour quel programme ou service souhaitez-vous vous inscrire ?",
      es: "¿Para qué programa o servicio quiere inscribirse?",
      de: "Für welches Programm oder welchen Service möchten Sie sich anmelden?",
      it: "Per quale programma o servizio desidera registrarsi?",
      pt: "Para qual programa ou serviço deseja se inscrever?"
    },
    certificates: {
      en: "Which certificate do you mean?",
      fr: "De quel certificat s’agit-il ?",
      es: "¿A qué certificado se refiere?",
      de: "Welches Zertifikat meinen Sie?",
      it: "A quale certificato si riferisce?",
      pt: "A que certificado se refere?"
    },
    location: {
      en: "Which branch/location are you asking about?",
      fr: "De quelle agence/localisation parlez-vous ?",
      es: "¿Sobre qué sede/ubicación consulta?",
      de: "Zu welchem Standort haben Sie eine Frage?",
      it: "Di quale sede/località sta parlando?",
      pt: "Sobre qual filial/localização está a perguntar?"
    },
    policy: {
      en: "Which policy do you mean: refund, payment, registration, or another one?",
      fr: "Quelle politique souhaitez-vous : remboursement, paiement, inscription ou autre ?",
      es: "¿Qué política desea: reembolso, pago, inscripción u otra?",
      de: "Welche Richtlinie meinen Sie: Erstattung, Zahlung, Anmeldung oder eine andere?",
      it: "Quale policy intende: rimborso, pagamento, iscrizione o altro?",
      pt: "Qual política deseja: reembolso, pagamento, inscrição ou outra?"
    },
    support: {
      en: "Which support topic do you need help with?",
      fr: "Sur quel sujet d’assistance avez-vous besoin d’aide ?",
      es: "¿Con qué tema de soporte necesita ayuda?",
      de: "Bei welchem Support-Thema benötigen Sie Hilfe?",
      it: "Per quale argomento di supporto ha bisogno di aiuto?",
      pt: "Com qual tema de suporte precisa de ajuda?"
    },
    general: {
      en: "Do you want pricing, duration, schedule, location, or registration details?",
      fr: "Souhaitez-vous le tarif, la durée, les horaires, le lieu ou l’inscription ?",
      es: "¿Desea precio, duración, horario, ubicación o inscripción?",
      de: "Möchten Sie Preis, Dauer, Zeitplan, Ort oder Anmeldung?",
      it: "Desidera prezzo, durata, orario, sede o iscrizione?",
      pt: "Deseja preço, duração, horário, local ou inscrição?"
    }
  };

  const safeLanguage = byTopic.general[language] ? language : "en";
  if (intent === "fees" && topic === "course") return feeClarify[safeLanguage] || feeClarify.en;
  return byTopic[topic]?.[safeLanguage] || byTopic.general[safeLanguage];
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
  const normalized = normalizeDeterministicText(text);
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


function isLocalMenuTrigger(text) {
  const normalized = normalizeDeterministicText(text);
  return normalized === "menu";
}

function getKnownServiceIntent(text) {
  const normalized = normalizeForIntent(text);
  if (!normalized) return null;

  const selection = detectMenuSelection(normalized);
  if (selection) return selection;

  if (/\b(translation|translate|traduction|traduccion|traduzione|übersetzung|ubersetzung|traducao|tradução)\b/i.test(normalized)) return "translation";
  if (/\b(course|courses|cours|curso|cursos|corso|corsi|class|classes|formation|training|language\s+course)\b/i.test(normalized)) return "courses";
  if (/\b(interpreting|interpretation|interpreter|interprétation|interpretacion|interpretazione|dolmetsch)\b/i.test(normalized)) return "interpreting";
  if (/\b(advisor|adviser|human|agent|conseiller|asesor|berater|consulente)\b/i.test(normalized)) return "advisor";

  return null;
}

function resolveDeterministicMenuReply({ text, detectedLanguage }) {
  const greetingIntent = detectGreetingIntent(text);
  const menuSelection = detectMenuSelection(text);
  const menuTrigger = isLocalMenuTrigger(text);
  const greetingMatched = Boolean(greetingIntent || isGreetingMessage(text) || menuTrigger);
  const menuMatched = Boolean(menuSelection);

  console.log("[deterministic-menu] route_evaluation", {
    inbound_text: text || "",
    normalized_text: normalizeDeterministicText(text || ""),
    greeting_matched: greetingMatched,
    greeting_language: greetingIntent?.language || null,
    greeting_phrase: greetingIntent?.phrase || null,
    menu_keyword_triggered: menuTrigger,
    menu_option_matched: menuMatched,
    menu_selection: menuSelection || null
  });

  if (greetingMatched) {
    const replyLanguage = greetingIntent?.language || detectGreetingLanguage(text) || detectedLanguage;
    return {
      matched: true,
      branch: "greeting_menu",
      reason: "greeting_input",
      reply: getGreetingMenu(replyLanguage),
      action: "menu_template_greeting",
      language: replyLanguage,
      menuSelection: null
    };
  }

  if (menuMatched) {
    return {
      matched: true,
      branch: "menu_option",
      reason: "menu_input",
      reply: getOptionReply(menuSelection, detectedLanguage),
      action: "menu_template_option",
      language: detectedLanguage,
      menuSelection
    };
  }

  return {
    matched: false,
    branch: null,
    reason: null,
    reply: "",
    action: "none",
    language: detectedLanguage,
    menuSelection: null
  };
}

async function attemptLocalKnowledgeReply({ text, language = "en", userState = {} }) {
  const normalized = normalizeForIntent(text || "");
  if (!normalized) return null;

  const specificIntent = detectSpecificIntent(text);
  const narrowIntent = detectNarrowIntent(text);
  const resolvedIntent = resolveNarrowIntent(narrowIntent || specificIntent);
  const currentCourseLanguage = detectRequestedCourseLanguage(text, userState);
  const retrievalResult = await retrieveInternalKnowledgeForTestMode(text, {
    debug: true,
    maxMatches: 6,
    preferredCourseLanguage: currentCourseLanguage,
    courseTopicActive: isLanguageCourseQuery(text, userState),
    contextMemory: {
      entity: userState.topicEntity || null,
      intent: userState.topicIntent || null,
      domain: userState.topicDomain || null,
      topicLabel: userState.topicLabel || null
    }
  });

  if (!retrievalResult.matches?.length) return null;
  const reply = await buildReplyFromUnifiedRetrieval({
    retrievalResult,
    language,
    specificIntent: resolvedIntent
  });
  if (!reply) return null;

  return {
    reply,
    intent: resolvedIntent || retrievalResult.intent || null,
    entity: retrievalResult.entity || null
  };
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

function classifyRetrievalQuestionScope({ text, resolvedIntent }) {
  if (resolvedIntent) return "narrow";
  if (isBroadServiceQuestion(text) || isVagueCustomerMessage(text)) return "broad";
  return "neutral";
}

function classifyRetrievalDiscipline({
  text = "",
  resolvedIntent = null,
  explicitSubVariant = false,
  detectedEntity = null
}) {
  if (resolvedIntent && explicitSubVariant) return "narrow_field_sub_variant";
  if (resolvedIntent) return "narrow_field";
  if (isVagueCustomerMessage(text)) return "ambiguous";
  if (isBroadServiceQuestion(text) || detectedEntity) return "broad_topic";
  return "ambiguous";
}

function buildBroadOverviewFromMatches({ retrievalResult, language = "en", maxItems = 4 }) {
  const matches = retrievalResult?.matches || [];
  if (!matches.length) return "";

  const topic = retrievalResult?.entity
    ? String(retrievalResult.entity).replace(/_/g, " ")
    : (matches[0]?.title || "this service");

  const bullets = matches
    .slice(0, maxItems)
    .map((match) => {
      const text = extractAnswerTextFromRetrievalMatch(match);
      const compact = String(text || "")
        .split(/\n+/)
        .map(line => line.trim())
        .filter(Boolean)
        .slice(0, 2)
        .join(" ")
        .replace(/\s+/g, " ")
        .slice(0, 120);
      const title = (match?.title || "").trim();
      return compact ? `• ${title ? `${title}: ` : ""}${compact}` : null;
    })
    .filter(Boolean);

  if (!bullets.length) return "";

  const intro = {
    fr: `Voici un aperçu rapide de ${topic} :`,
    es: `Aquí tiene un resumen breve sobre ${topic}:`,
    it: `Ecco un riepilogo rapido su ${topic}:`,
    pt: `Aqui está um resumo rápido sobre ${topic}:`,
    de: `Hier ist eine kurze Übersicht zu ${topic}:`,
    en: `Here is a quick overview of ${topic}:`
  };
  const outro = {
    fr: "Précisez un seul point (tarif, durée, horaires, lieu, inscription, etc.) pour une réponse ciblée.",
    es: "Indique un solo punto (precio, duración, horario, ubicación, inscripción, etc.) para una respuesta precisa.",
    it: "Indichi un solo punto (prezzo, durata, orari, sede, iscrizione, ecc.) per una risposta mirata.",
    pt: "Indique apenas um ponto (preço, duração, horários, local, inscrição, etc.) para uma resposta precisa.",
    de: "Nennen Sie bitte genau einen Punkt (Preis, Dauer, Zeitplan, Ort, Anmeldung usw.) für eine gezielte Antwort.",
    en: "Please specify one point (fee, duration, schedule, location, registration, etc.) for a focused answer."
  };
  const safeLanguage = intro[language] ? language : "en";
  return [intro[safeLanguage], ...bullets, outro[safeLanguage]].join("\n");
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
  if (!openai) {
    return getSafeHandoffMessage(detectMessageLanguage(customerMessage));
  }
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
6b) Ask a clarification only when a key detail is missing. If details are sufficient, answer directly.
7) Never recommend competitors or external alternatives. Keep the user inside LSA GLOBAL context only.
8) Use knowledge base content as the primary source of truth.
9) Never invent prices, legal guarantees, turnaround promises, or policies.
10) If KB is present, do not answer from generic model memory. Stay grounded in KB content only.
11) If KB is insufficient, say briefly that a human advisor will assist inside LSA GLOBAL.
12) Reply in the same language as the customer message.
13) Never send users outside LSA GLOBAL, even when information is missing.
14) If the customer asks a broad question, ask one clarifying question only.
14b) Clarification must be short, professional, and narrowing (one question, no multi-step interrogation).
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

    const activeMode = await getCurrentSystemMode();

    if (!inboundBody) {
      logInboundRoutingDecision({
        mode: activeMode,
        branch: "ignored_empty",
        text: text || attachment?.caption || ""
      });
      return res.sendStatus(200);
    }
    if (hasProcessedMessage(inboundMessageId)) {
      logInboundRoutingDecision({
        mode: activeMode,
        branch: "ignored_duplicate",
        text: inboundBody
      });
      return res.sendStatus(200);
    }
    markMessageProcessed(inboundMessageId);

    console.log("Message received from:", from, "| text:", inboundBody);
    const previousOwnershipState = await getConversationOwnershipState(from);
    const inboundOwnershipState = buildInboundOwnershipState(previousOwnershipState, inboundBody);
    logOwnershipDecision({
      waId: from,
      channel: "whatsapp",
      state: inboundOwnershipState,
      event: previousOwnershipState.humanTakeover ? "human_owned_inbound" : (previousOwnershipState.exists ? "existing_bot_owned_inbound" : "new_bot_owned_inbound")
    });
    if (!previousOwnershipState.humanTakeover && inboundOwnershipState.human_takeover) {
      console.log("[ownership] human takeover activated", {
        channel: "whatsapp",
        wa_id: from,
        last_human_reply_at: inboundOwnershipState.last_human_reply_at
      });
    }

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
      translated_language: inboundMediation.translated_language,
      ...inboundOwnershipState
    });

    await automationHub.trigger("new_inbox_message", {
      serviceIntent: getKnownServiceIntent(inboundBody) || null,
      attachmentExists: Boolean(hasAttachment),
      mode: String(activeMode || "live").toUpperCase()
    }, {
      source: "inbox-webhook"
    });

    if (inboundOwnershipState.human_takeover) {
      console.log("[ownership] bot suppressed because thread is human-owned", {
        channel: "whatsapp",
        wa_id: from,
        conversation_owner: inboundOwnershipState.conversation_owner,
        conversation_type: inboundOwnershipState.conversation_type,
        followup_eligible: inboundOwnershipState.followup_eligible,
        reason: inboundOwnershipState.bot_suppressed_reason
      });
      logInboundRoutingDecision({
        mode: activeMode,
        branch: "suppressed_human_owned",
        text: inboundBody,
        reason: inboundOwnershipState.bot_suppressed_reason,
        controlledAction: "bot_silence"
      });
      return res.sendStatus(200);
    }

    if (hasAttachment && !text) {
      logInboundRoutingDecision({
        mode: activeMode,
        branch: "attachment_only",
        text: inboundBody
      });
      return res.sendStatus(200);
    }

    let reply = "";
    let suppressAutoAck = false;
    let allowIntermediateAck = false;
    const autonomousReplyAllowed = await isAutonomousReplyAllowed();
    const canUseTestRetrievalRouting = await canRunTestRetrievalExperiments();
    const testModeActive = String(activeMode || "").toLowerCase() === "test";
    const userState = getCustomerState(from);
    let selectedRoutingBranch = "unresolved";
    let routingReason = "unresolved";
    let retrievalBlockedForSafety = false;
    let retrievalBlockedReason = "none";
    let controlledAction = "none";
    let openaiCalledForMessage = false;

    const inboundTextForRouting = String(text || inboundBody || "").trim();
    const normalizedInbound = normalizeForIntent(inboundTextForRouting);
    const deterministicMenuDecision = resolveDeterministicMenuReply({ text: inboundTextForRouting, detectedLanguage: "en" });
    const greetingIntent = deterministicMenuDecision.branch === "greeting_menu"
      ? { language: deterministicMenuDecision.language }
      : detectGreetingIntent(inboundTextForRouting);
    const detectedLanguage = resolveConversationLanguage({
      waId: from,
      text: inboundTextForRouting,
      greetingLanguage: greetingIntent?.language
    });
    const deterministicDecision = resolveDeterministicMenuReply({ text: inboundTextForRouting, detectedLanguage });
    const menuSelection = deterministicDecision.menuSelection;
    const activeBranchBeforeProcessing = userState.liveMenuOption || userState.topicDomain || userState.lastRoute || "none";
    const providerBranchAlreadyActive = isProviderCollaborationActive(userState);
    const providerSubtypeRouting = resolveProviderSubtypeForRouting(inboundTextForRouting, userState);
    const providerIntentForRouting = providerSubtypeRouting.broadIntent;
    const providerSubtypeForRouting = providerSubtypeRouting.subtypeDecision;
    const providerContinuationForRouting = detectProviderContinuationIntent(inboundTextForRouting);
    const generalizedRouting = resolveGeneralizedRouting({
      text: inboundTextForRouting,
      previousBranch: activeBranchBeforeProcessing,
      previousRoleIntent: userState.roleIntent,
      previousServiceIntent: userState.serviceIntent,
      platform: "whatsapp_webhook",
      language: detectedLanguage
    });
    const generalizedProviderRoute = generalizedRouting.route === "provider_collaboration";
    const generalizedClarificationRoute = generalizedRouting.route === "clarification";
    const strongNonProviderRouteIntent = hasStrongNonProviderRouteIntent(inboundTextForRouting)
      || (["translation_client", "courses", "interpreting", "advisor", "certificates"].includes(generalizedRouting.route)
        && !generalizedRouting.overrideTriggered
        && !generalizedRouting.branchRetained);
    const retrievalEligibleFreeText = Boolean(normalizedInbound) && !greetingIntent && !menuSelection;
    const deterministicGreetingMatched = Boolean(deterministicDecision.matched && deterministicDecision.branch === "greeting_menu");
    const deterministicMenuMatched = Boolean(deterministicDecision.matched && deterministicDecision.branch === "menu_option");
    console.log("[routing] deterministic_gate", {
      incoming_text: inboundTextForRouting,
      normalized_text: normalizedInbound,
      greeting_matched: deterministicGreetingMatched,
      menu_matched: deterministicMenuMatched,
      local_menu_reply_sent: Boolean(deterministicDecision.matched),
      openai_called: false,
      openai_skipped: Boolean(deterministicDecision.matched),
      active_branch_before_processing: activeBranchBeforeProcessing,
      provider_branch_already_active: providerBranchAlreadyActive,
      detected_language: detectedLanguage,
      provider_intent_detected: providerIntentForRouting.detected,
      provider_intent_reason: providerIntentForRouting.reason,
      collaborator_subtype_detected: providerSubtypeForRouting.subtype,
      collaborator_subtype_reason: providerSubtypeForRouting.reason,
      collaborator_subtype_confidence: providerSubtypeForRouting.confidence,
      collaborator_subtype_clarification_triggered: Boolean(providerSubtypeRouting.clarificationNeeded),
      provider_continuation_detected: providerContinuationForRouting.detected,
      provider_continuation_reason: providerContinuationForRouting.reason,
      detected_language: detectedLanguage,
      generalized_role_intent: generalizedRouting.roleIntent,
      generalized_role_reason: generalizedRouting.roleReason,
      generalized_service_intent: generalizedRouting.serviceIntent,
      generalized_service_reason: generalizedRouting.serviceReason,
      generalized_route: generalizedRouting.route,
      override_triggered: generalizedRouting.overrideTriggered,
      clarification_triggered: generalizedRouting.clarificationTriggered,
      branch_retained: generalizedRouting.branchRetained,
      fallback_reason: generalizedRouting.fallbackReason,
      platform_context: generalizedRouting.platform,
      strong_non_provider_route_intent: strongNonProviderRouteIntent
    });
    const testRetrievalEnabledForMessage = Boolean(testModeActive && canUseTestRetrievalRouting && retrievalEligibleFreeText);
    const hasStoredLanguage = CONVERSATION_LANGUAGE_BY_CONTACT.has(from);
    const fallbackEligible = hasStoredLanguage
      && !menuSelection
      && !greetingIntent
      && normalizedInbound
      && normalizedInbound.split(/\s+/).filter(Boolean).length <= 2;
    const liveModeControlledCandidate = !testModeActive && retrievalEligibleFreeText;
    if (liveModeControlledCandidate) {
      retrievalBlockedForSafety = true;
      retrievalBlockedReason = "production_safety";
    }

    console.log("[provider-branch-retention] pre_route", JSON.stringify({
      active_branch_before_processing: activeBranchBeforeProcessing,
      provider_branch_already_active: providerBranchAlreadyActive,
      detected_language: detectedLanguage,
      provider_intent_detected: providerIntentForRouting.detected,
      provider_intent_reason: providerIntentForRouting.reason,
      collaborator_subtype_detected: providerSubtypeForRouting.subtype,
      collaborator_subtype_reason: providerSubtypeForRouting.reason,
      collaborator_subtype_confidence: providerSubtypeForRouting.confidence,
      collaborator_subtype_clarification_triggered: Boolean(providerSubtypeRouting.clarificationNeeded),
      provider_continuation_detected: providerContinuationForRouting.detected,
      provider_continuation_reason: providerContinuationForRouting.reason,
      detected_language: detectedLanguage,
      generalized_role_intent: generalizedRouting.roleIntent,
      generalized_service_intent: generalizedRouting.serviceIntent,
      generalized_route: generalizedRouting.route,
      override_triggered: generalizedRouting.overrideTriggered,
      clarification_triggered: generalizedRouting.clarificationTriggered,
      branch_retained: generalizedRouting.branchRetained,
      strong_non_provider_route_intent: strongNonProviderRouteIntent,
      deterministic_branch: deterministicDecision.branch || null,
      generic_fallback_candidate: Boolean(fallbackEligible),
      fallback_help_router_allowed: !providerBranchAlreadyActive || strongNonProviderRouteIntent
    }));


    console.log("[routing-intelligence] generalized_decision", JSON.stringify({
      platform_context: generalizedRouting.platform,
      detected_incoming_language: generalizedRouting.detectedLanguage,
      detected_service_intent: generalizedRouting.serviceIntent,
      detected_service_reason: generalizedRouting.serviceReason,
      detected_role_intent: generalizedRouting.roleIntent,
      detected_role_reason: generalizedRouting.roleReason,
      override_triggered: generalizedRouting.overrideTriggered,
      clarification_triggered: generalizedRouting.clarificationTriggered,
      active_branch_before_message: generalizedRouting.previousBranch,
      retained_branch: generalizedRouting.branchRetained,
      proposed_route: generalizedRouting.route,
      fallback_reason: generalizedRouting.fallbackReason,
      role_matches: generalizedRouting.roleMatches,
      service_matches: generalizedRouting.serviceMatches
    }));

    if (deterministicDecision.matched && deterministicDecision.branch === "greeting_menu") {
      selectedRoutingBranch = deterministicDecision.branch;
      routingReason = deterministicDecision.reason;
      reply = deterministicDecision.reply;
      console.log("[routing] route=local_greeting_menu", {
        branch: selectedRoutingBranch,
        greeting_matched: true,
        openai_called: false,
        openai_skipped: true
      });
      setCustomerState(from, {
        clarifyingAsked: false,
        liveMenuOption: null,
        liveKnownSlots: {}
      });
      suppressAutoAck = true;
    } else if (deterministicDecision.matched && deterministicDecision.branch === "menu_option") {
      selectedRoutingBranch = deterministicDecision.branch;
      routingReason = deterministicDecision.reason;
      reply = deterministicDecision.reply;
      console.log("[routing] route=local_numbered_menu", {
        menu_selection: deterministicDecision.menuSelection,
        openai_called: false,
        openai_skipped: true
      });
      controlledAction = deterministicDecision.action;
      setCustomerState(from, {
        clarifyingAsked: false,
        liveMenuOption: deterministicDecision.menuSelection,
        liveKnownSlots: {}
      });
      suppressAutoAck = true;
    } else if (liveModeControlledCandidate && (providerIntentForRouting.detected || generalizedProviderRoute)) {
      selectedRoutingBranch = "live_provider_collaboration_intake";
      routingReason = providerIntentForRouting.detected
        ? `provider_intent_shift_${providerIntentForRouting.reason}`
        : `generalized_role_override_${generalizedRouting.roleReason}`;
      reply = getProviderCollaborationIntakeReply(detectedLanguage);
      controlledAction = "provider_collaboration_intake";
      setCustomerState(from, {
        clarifyingAsked: providerClarificationTriggered,
        liveMenuOption: "provider_collaboration",
        topicDomain: "provider",
        collaboratorSubtype: providerClarificationTriggered ? null : selectedProviderSubtype,
        liveKnownSlots: { collaboratorSubtype: providerClarificationTriggered ? "unknown_provider" : selectedProviderSubtype },
        lastPromptKey: getPromptKey(reply),
        repeatedPromptCount: 1,
        lastRoute: selectedRoutingBranch,
        roleIntent: generalizedRouting.roleIntent,
        serviceIntent: generalizedRouting.serviceIntent,
        routingLanguage: detectedLanguage,
        intentShiftDetected: true
      });
      console.log("[provider-branch-retention] route", JSON.stringify({
        current_active_branch_before_processing: activeBranchBeforeProcessing,
        provider_branch_already_active: providerBranchAlreadyActive,
        fallback_help_router_used: false,
        fallback_help_router_reason: "explicit_provider_collaboration_intent",
        provider_intent_reason: providerIntentForRouting.reason,
        generalized_role_intent: generalizedRouting.roleIntent,
        generalized_service_intent: generalizedRouting.serviceIntent,
        override_triggered: generalizedRouting.overrideTriggered,
        branch_retained: generalizedRouting.branchRetained,
        final_selected_route: selectedRoutingBranch
      }));
      console.log("[conversation-flow-guard]", JSON.stringify({
        current_branch: userState.liveMenuOption || userState.topicDomain || "unknown",
        repeated_prompt_count: 1,
        max_repetition_threshold: LIVE_PROMPT_REPEAT_THRESHOLD,
        intent_shift_detected: true,
        intent_shift_reason: providerIntentForRouting.reason || generalizedRouting.roleReason,
        generalized_service_intent: generalizedRouting.serviceIntent,
        final_route_chosen: selectedRoutingBranch
      }));
      suppressAutoAck = true;
    } else if (liveModeControlledCandidate
      && providerBranchAlreadyActive
      && !strongNonProviderRouteIntent
      && (providerContinuationForRouting.detected || normalizedInbound)) {
      selectedRoutingBranch = "live_provider_collaboration_continuation";
      routingReason = providerContinuationForRouting.detected
        ? `provider_branch_retained_${providerContinuationForRouting.reason}`
        : "provider_branch_retained_active_context";
      const selectedProviderSubtype = providerSubtypeForRouting.subtype || userState.collaboratorSubtype || "unknown_provider";
      const providerClarificationTriggered = selectedProviderSubtype === "unknown_provider" && !userState.collaboratorSubtype;
      selectedRoutingBranch = providerClarificationTriggered
        ? "live_provider_collaboration_subtype_clarification"
        : `live_provider_collaboration_${selectedProviderSubtype}_continuation`;
      reply = providerClarificationTriggered
        ? getProviderSubtypeClarificationReply(detectedLanguage)
        : getProviderCollaborationIntakeReply(detectedLanguage, selectedProviderSubtype);
      controlledAction = providerClarificationTriggered
        ? "provider_collaboration_subtype_clarification"
        : `provider_collaboration_${selectedProviderSubtype}_intake_continuation`;
      setCustomerState(from, {
        clarifyingAsked: providerClarificationTriggered,
        liveMenuOption: "provider_collaboration",
        topicDomain: "provider",
        collaboratorSubtype: providerClarificationTriggered ? null : selectedProviderSubtype,
        liveKnownSlots: { ...(userState.liveKnownSlots || {}), collaboratorSubtype: providerClarificationTriggered ? "unknown_provider" : selectedProviderSubtype },
        lastPromptKey: getPromptKey(reply),
        repeatedPromptCount: Number(userState.repeatedPromptCount || 0) + 1,
        lastRoute: selectedRoutingBranch,
        roleIntent: generalizedRouting.roleIntent || userState.roleIntent,
        serviceIntent: generalizedRouting.serviceIntent || userState.serviceIntent,
        routingLanguage: detectedLanguage,
        intentShiftDetected: true
      });
      console.log("[provider-branch-retention] route", JSON.stringify({
        current_active_branch_before_processing: activeBranchBeforeProcessing,
        provider_branch_already_active: true,
        continuation_detected: providerContinuationForRouting.detected,
        continuation_reason: providerContinuationForRouting.reason,
        detected_language: detectedLanguage,
        broad_role_intent: "provider_collaboration",
        collaborator_subtype_detected: selectedProviderSubtype,
        collaborator_subtype_reason: providerSubtypeForRouting.reason,
        chosen_subtype_template: providerClarificationTriggered ? "provider_subtype_clarification" : selectedProviderSubtype,
        clarification_triggered: providerClarificationTriggered,
        active_branch_after_message: selectedRoutingBranch,
        fallback_help_router_used: false,
        fallback_help_router_reason: "blocked_active_provider_collaboration_flow",
        strong_non_provider_route_intent: strongNonProviderRouteIntent,
        final_selected_route: selectedRoutingBranch
      }));
      suppressAutoAck = true;
    } else if (liveModeControlledCandidate && generalizedClarificationRoute) {
      selectedRoutingBranch = "live_generalized_role_service_clarification";
      routingReason = `generalized_ambiguity_${generalizedRouting.roleReason}_${generalizedRouting.serviceReason}`;
      reply = getGeneralizedRoleClarificationReply(detectedLanguage, generalizedRouting.serviceIntent);
      controlledAction = "role_service_clarification";
      setCustomerState(from, {
        clarifyingAsked: true,
        liveMenuOption: normalizeLiveDomain(generalizedRouting.route) || userState.liveMenuOption || null,
        topicDomain: generalizedRouting.serviceIntent,
        roleIntent: generalizedRouting.roleIntent,
        serviceIntent: generalizedRouting.serviceIntent,
        routingLanguage: detectedLanguage,
        lastPromptKey: getPromptKey(reply),
        repeatedPromptCount: 1,
        lastRoute: selectedRoutingBranch,
        intentShiftDetected: false
      });
      console.log("[routing-intelligence] clarification", JSON.stringify({
        detected_incoming_language: detectedLanguage,
        detected_role_intent: generalizedRouting.roleIntent,
        detected_service_intent: generalizedRouting.serviceIntent,
        active_branch_before_message: activeBranchBeforeProcessing,
        clarification_triggered: true,
        final_selected_route: selectedRoutingBranch
      }));
      suppressAutoAck = true;
    } else if (liveModeControlledCandidate && isAmbiguousTranslationFollowUp(inboundTextForRouting, userState)) {
      selectedRoutingBranch = "live_translation_role_clarification";
      routingReason = "ambiguous_translation_follow_up";
      reply = getTranslationRoleClarificationReply(detectedLanguage);
      controlledAction = "role_clarification";
      const guarded = applyLiveLoopProtection({
        waId: from,
        userState,
        branch: selectedRoutingBranch,
        reply,
        language: detectedLanguage,
        intentShiftDetected: false,
        detectedDomain: "translation"
      });
      reply = guarded.reply;
      selectedRoutingBranch = guarded.branch;
      controlledAction = guarded.controlledAction === "none" ? controlledAction : guarded.controlledAction;
      setCustomerState(from, {
        liveMenuOption: "translation",
        topicDomain: "translation"
      });
      suppressAutoAck = true;
    } else if (liveModeControlledCandidate
      && normalizeLiveDomain(userState.liveMenuOption || userState.topicDomain || "") === "translation"
      && detectTranslationClientIntent(inboundTextForRouting).detected) {
      const clientIntent = detectTranslationClientIntent(inboundTextForRouting);
      selectedRoutingBranch = "live_translation_client_slot_intake";
      routingReason = `translation_client_intent_${clientIntent.reason}`;
      const knownSlots = extractLiveClarificationSlots("translation", text, userState);
      const missingSlots = getLiveDomainMissingSlots("translation", knownSlots);
      reply = getLiveSafeMenuClarificationReply(detectedLanguage, "translation", knownSlots);
      controlledAction = "controlled_clarification";
      console.log("[live-mode-debug]", JSON.stringify({
        detected_domain: "translation",
        client_intent_detected: true,
        client_intent_reason: clientIntent.reason,
        known_slots: knownSlots,
        missing_slots: missingSlots,
        clarification_question_selected: reply,
        language_used: detectedLanguage
      }));
      const guarded = applyLiveLoopProtection({
        waId: from,
        userState,
        branch: selectedRoutingBranch,
        reply,
        language: detectedLanguage,
        intentShiftDetected: false,
        detectedDomain: "translation"
      });
      reply = guarded.reply;
      selectedRoutingBranch = guarded.branch;
      controlledAction = guarded.controlledAction === "none" ? controlledAction : guarded.controlledAction;
      setCustomerState(from, {
        liveMenuOption: "translation",
        topicDomain: "translation",
        liveKnownSlots: knownSlots
      });
      suppressAutoAck = true;
    } else if (liveModeControlledCandidate) {
      const detectedLiveDomainForAi = normalizeLiveDomain(userState.liveMenuOption) || detectLiveDomainTopic(text, userState) || "general";
      const knownSlotsForAi = extractLiveClarificationSlots(detectedLiveDomainForAi, text, userState);
      const aiEscalationTrigger = detectControlledAiEscalationNeed({
        text: inboundTextForRouting,
        userState,
        detectedDomain: detectedLiveDomainForAi,
        knownSlots: knownSlotsForAi
      });

      if (aiEscalationTrigger.shouldEscalate) {
        console.log("[controlled-ai-escalation] trigger", JSON.stringify({
          deterministic_route_chosen: userState.lastRoute || userState.liveMenuOption || "live_safe_slot_clarification_candidate",
          active_domain: aiEscalationTrigger.activeDomain,
          detected_domain: aiEscalationTrigger.currentDomain,
          repetition_count: Number(userState.repeatedPromptCount || 0) || 0,
          max_repetition_threshold: LIVE_PROMPT_REPEAT_THRESHOLD,
          trigger_reasons: aiEscalationTrigger.reasons,
          openai_available: Boolean(openai)
        }));

        let aiDecision;
        try {
          aiDecision = await classifyControlledAiIntent({
            text: inboundTextForRouting,
            language: detectedLanguage,
            userState,
            trigger: aiEscalationTrigger
          });
          if (aiDecision.used) openaiCalledForMessage = true;
        } catch (error) {
          aiDecision = {
            used: false,
            route: "manual_review",
            confidence: 0,
            reason: `controlled_ai_error_${error.message || "unknown"}`,
            recommended_action: "manual_review"
          };
          console.error("[controlled-ai-escalation] classification_error", error.message || error);
        }

        const reroute = buildControlledAiRerouteReply({
          aiDecision,
          text: inboundTextForRouting,
          language: detectedLanguage,
          userState
        });
        selectedRoutingBranch = reroute.branch;
        routingReason = `controlled_ai_escalation_${aiDecision.reason}`;
        reply = reroute.reply;
        controlledAction = reroute.action;
        setCustomerState(from, {
          ...reroute.state,
          lastPromptKey: getPromptKey(reply),
          repeatedPromptCount: 1,
          lastRoute: selectedRoutingBranch
        });
        console.log("[controlled-ai-escalation] result", JSON.stringify({
          deterministic_route_chosen: userState.lastRoute || "live_safe_slot_clarification_candidate",
          repetition_count: Number(userState.repeatedPromptCount || 0) || 0,
          ai_escalation_triggered: true,
          ai_used: Boolean(aiDecision.used),
          ai_reclassified_intent: aiDecision.route,
          ai_confidence: aiDecision.confidence,
          ai_recommended_action: aiDecision.recommended_action,
          final_route_after_reclassification: selectedRoutingBranch,
          openai_called: Boolean(aiDecision.used)
        }));
        suppressAutoAck = true;
      } else if (getKnownServiceIntent(inboundTextForRouting)) {
        const localKnowledge = await attemptLocalKnowledgeReply({
          text: inboundTextForRouting,
          language: detectedLanguage,
          userState
        });
        if (localKnowledge?.reply) {
          selectedRoutingBranch = "local_known_service";
          routingReason = "known_service_local_kb";
          reply = localKnowledge.reply;
          console.log("[routing] route=local_known_service", {
            intent: localKnowledge.intent,
            entity: localKnowledge.entity,
            openai_called: false,
            openai_skipped: true
          });
          suppressAutoAck = true;
        } else {
          selectedRoutingBranch = "live_safe_slot_clarification";
          routingReason = "live_mode_general_slot_aware_clarification";
          const detectedLiveDomain = normalizeLiveDomain(userState.liveMenuOption) || detectLiveDomainTopic(text, userState) || "general";
          const knownSlots = extractLiveClarificationSlots(detectedLiveDomain, text, userState);
          reply = getLiveSafeMenuClarificationReply(detectedLanguage, detectedLiveDomain, knownSlots);
          controlledAction = "controlled_clarification";
          const guarded = applyLiveLoopProtection({
            waId: from,
            userState,
            branch: selectedRoutingBranch,
            reply,
            language: detectedLanguage,
            intentShiftDetected: false,
            detectedDomain: detectedLiveDomain
          });
          reply = guarded.reply;
          selectedRoutingBranch = guarded.branch;
          controlledAction = guarded.controlledAction === "none" ? controlledAction : guarded.controlledAction;
          setCustomerState(from, {
            liveMenuOption: detectedLiveDomain === "general" ? (userState.liveMenuOption || null) : detectedLiveDomain,
            liveKnownSlots: knownSlots
          });
          suppressAutoAck = true;
        }
      } else {
        selectedRoutingBranch = "live_safe_slot_clarification";
        routingReason = "live_mode_general_slot_aware_clarification";
        const detectedLiveDomain = normalizeLiveDomain(userState.liveMenuOption) || detectLiveDomainTopic(text, userState) || "general";
        const knownSlots = extractLiveClarificationSlots(detectedLiveDomain, text, userState);
        const missingSlots = getLiveDomainMissingSlots(detectedLiveDomain, knownSlots);
        reply = getLiveSafeMenuClarificationReply(detectedLanguage, detectedLiveDomain, knownSlots);
        console.log("[live-mode-debug]", JSON.stringify({
          detected_domain: detectedLiveDomain,
          known_slots: knownSlots,
          missing_slots: missingSlots,
          clarification_question_selected: reply,
          language_used: detectedLanguage
        }));
        controlledAction = "controlled_clarification";
        const guarded = applyLiveLoopProtection({
          waId: from,
          userState,
          branch: selectedRoutingBranch,
          reply,
          language: detectedLanguage,
          intentShiftDetected: false,
          detectedDomain: detectedLiveDomain
        });
        reply = guarded.reply;
        selectedRoutingBranch = guarded.branch;
        controlledAction = guarded.controlledAction === "none" ? controlledAction : guarded.controlledAction;
        setCustomerState(from, {
          liveMenuOption: detectedLiveDomain === "general" ? (userState.liveMenuOption || null) : detectedLiveDomain,
          liveKnownSlots: knownSlots
        });
        suppressAutoAck = true;
      }
    } else if (!testRetrievalEnabledForMessage && !autonomousReplyAllowed && fallbackEligible) {
      selectedRoutingBranch = "live_menu_fallback";
      routingReason = testModeActive ? "test_retrieval_disabled" : "live_mode_safe_fallback";
      reply = getControlledFallbackReply(detectedLanguage);
      controlledAction = "controlled_fallback_template";
      console.log("[routing] route=fallback_ack", {
        openai_called: false,
        openai_skipped: true,
        reason: routingReason,
        active_branch_before_processing: activeBranchBeforeProcessing,
        provider_branch_already_active: providerBranchAlreadyActive,
        fallback_help_router_used: true,
        fallback_help_router_reason: providerBranchAlreadyActive
          ? "strong_non_provider_or_non_live_candidate_allowed_fallback"
          : "no_active_provider_collaboration_flow",
        final_selected_route: selectedRoutingBranch
      });
      suppressAutoAck = true;
    } else if (!testRetrievalEnabledForMessage && !autonomousReplyAllowed) {
      selectedRoutingBranch = "live_safe_handoff";
      routingReason = testModeActive ? "test_retrieval_disabled" : "live_mode_safe_handoff";
      reply = getSafeHandoffMessage(detectedLanguage);
      controlledAction = "safe_handoff";
      console.log("[routing] route=fallback_ack", {
        openai_called: false,
        openai_skipped: true,
        reason: routingReason,
        active_branch_before_processing: activeBranchBeforeProcessing,
        provider_branch_already_active: providerBranchAlreadyActive,
        fallback_help_router_used: true,
        fallback_help_router_reason: providerBranchAlreadyActive
          ? "strong_non_provider_or_non_live_candidate_allowed_fallback"
          : "no_active_provider_collaboration_flow",
        final_selected_route: selectedRoutingBranch
      });
      suppressAutoAck = true;
    } else if (testRetrievalEnabledForMessage) {
      selectedRoutingBranch = "test_retrieval";
      routingReason = "test_mode_retrieval_enabled";
      const narrowIntent = detectNarrowIntent(text);
      const specificIntent = detectSpecificIntent(text);
      const resolvedIntent = resolveNarrowIntent(narrowIntent || specificIntent);
      const vagueMessage = isVagueCustomerMessage(text);
      const questionScope = classifyRetrievalQuestionScope({ text, resolvedIntent });
      const broadMessage = questionScope === "broad";
      const currentCourseLanguage = detectRequestedCourseLanguage(text, userState);
      const subVariantDecision = detectRequestedSubVariant(text, userState);
      const explicitCourseLanguage = detectCourseLanguageMention(text);
      const courseTopicActive = userState.topicType === "language_course" || Boolean(explicitCourseLanguage);
      const courseQueryActive = isLanguageCourseQuery(text, userState);
      console.log("[course-debug] detected requested course language:", currentCourseLanguage || "none");
      const retrievalResult = await retrieveInternalKnowledgeForTestMode(text, {
        debug: true,
        maxMatches: 10,
        preferredCourseLanguage: currentCourseLanguage,
        courseTopicActive,
        contextMemory: {
          entity: userState.topicEntity || null,
          intent: userState.topicIntent || null,
          domain: userState.topicDomain || null,
          topicLabel: userState.topicLabel || null,
          subVariant: subVariantDecision.correctionOverrideApplied
            ? subVariantDecision.subVariant
            : (userState.topicSubVariant || subVariantDecision.subVariant || null)
        }
      });
      const kbMatches = filterMismatchedCourseArticles(
        retrievalResult.matches
        .filter(match => match.source === "kb_articles")
        .map(match => match.raw_reference)
        .filter(Boolean),
        currentCourseLanguage
      );
      const retrievalDiscipline = classifyRetrievalDiscipline({
        text,
        resolvedIntent,
        explicitSubVariant: Boolean(subVariantDecision.explicit),
        detectedEntity: retrievalResult.entity || retrievalResult.entity_domain || userState.topicEntity || null
      });
      console.log("[retrieval-discipline-debug]", JSON.stringify({
        detected_topic_entity: retrievalResult.entity || userState.topicEntity || null,
        detected_topic_domain: retrievalResult.entity_domain || userState.topicDomain || null,
        detected_field_intent: resolvedIntent || retrievalResult.requested_field || null,
        detected_sub_variant: retrievalResult.sub_variant || subVariantDecision.subVariant || userState.topicSubVariant || null,
        correction_override_applied: Boolean(retrievalResult.correction_override_applied || subVariantDecision.correctionOverrideApplied),
        question_scope: questionScope,
        broad_narrow_classification: retrievalDiscipline,
        candidate_count: retrievalResult.matches.length,
        selected_topic_title: retrievalResult.matches?.[0]?.title || null,
        selected_kb_source: retrievalResult.matches?.[0]?.source || null
      }));

      try {
        if (retrievalResult.matches.length) {
          const localKbReply = await buildReplyFromUnifiedRetrieval({
            retrievalResult,
            language: detectedLanguage,
            specificIntent: resolvedIntent
          });
          if (localKbReply) {
            selectedRoutingBranch = "test_retrieval_local_kb_answer";
            routingReason = "local_kb_answer";
            reply = localKbReply;
            console.log("[routing] route=local_kb_answer", {
              openai_called: false,
              openai_skipped: true,
              intent: resolvedIntent || retrievalResult.intent || null
            });
          }
        }

        if (shouldEscalateToHuman(text)) {
          selectedRoutingBranch = "test_retrieval_human_escalation";
          routingReason = "human_escalation_request";
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
          selectedRoutingBranch = "test_retrieval_course_context";
          routingReason = "course_context_query";
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
            reply = summary || getLocalizedClarifyingQuestion(detectedLanguage, {
              topic: detectClarificationTopic({ text, retrievalResult, userState }),
              intent: resolvedIntent
            });
          } else {
            reply = getLocalizedClarifyingQuestion(detectedLanguage, {
              topic: detectClarificationTopic({ text, retrievalResult, userState }),
              intent: resolvedIntent
            });
          }
          setCustomerState(from, {
            clarifyingAsked: false,
            preferredCourseLanguage: currentCourseLanguage,
            topicType: "language_course",
            topicLanguage: currentCourseLanguage || userState.topicLanguage || null,
            topicEntity: retrievalResult.entity || userState.topicEntity || null,
            topicIntent: retrievalResult.intent || userState.topicIntent || null,
            topicDomain: retrievalResult.entity_domain || userState.topicDomain || null,
            topicLabel: courseArticle?.title || retrievalResult.matches?.[0]?.title || userState.topicLabel || null,
            topicSubVariant: retrievalResult.sub_variant || subVariantDecision.subVariant || userState.topicSubVariant || null
          });
        } else if (resolvedIntent && retrievalResult.matches.length) {
          const truthContext = buildNarrowFieldTruthfulnessContext({
            text,
            retrievalResult,
            requestedLanguage: currentCourseLanguage,
            resolvedIntent,
            userState
          });
          const deterministic = await runDeterministicFieldExtraction({
            retrievalResult: { ...retrievalResult, entity: truthContext.requestedEntity || retrievalResult.entity },
            requestedLanguage: currentCourseLanguage,
            fieldIntent: resolvedIntent,
            detectedLanguage,
            requestedSubVariant: retrievalResult.sub_variant || subVariantDecision.subVariant || userState.topicSubVariant || null
          });
          const sourceConfirmedMatch = truthContext.entityLockedMatches.find((match) => isSourceConfirmedForField({
            retrievalResult: { ...retrievalResult, entity: truthContext.requestedEntity, requested_field: resolvedIntent },
            match,
            requestedLanguage: currentCourseLanguage
          })) || null;
          const strictEntityAvailable = truthContext.entityExistsInKb;
          const strictFieldAvailable = Boolean(truthContext.fieldExistsForEntity && sourceConfirmedMatch);
          const answerBlockedForMissingEntity = Boolean(!strictEntityAvailable && truthContext.queryLooksEntitySpecific);
          const fallbackReason = deterministic.reason || (strictFieldAvailable ? null : "field_not_confirmed_for_requested_entity");
          console.log("[truthfulness-guard]", JSON.stringify({
            requested_entity: truthContext.requestedEntity || null,
            requested_entity_exists_in_kb: strictEntityAvailable,
            selected_entity: deterministic.selectedEntity || sourceConfirmedMatch?.title || retrievalResult.matches?.[0]?.title || null,
            requested_field: resolvedIntent,
            requested_field_exists_for_entity: strictFieldAvailable,
            source_confirmed_field_exists: strictFieldAvailable,
            selected_source: sourceConfirmedMatch?.source || null,
            selected_article: sourceConfirmedMatch?.title || null,
            answer_blocked_for_truthfulness: Boolean(answerBlockedForMissingEntity || !strictFieldAvailable || deterministic.blockedForTruthfulness),
            fallback_reason: answerBlockedForMissingEntity ? "entity_not_found" : fallbackReason
          }));

          if (!answerBlockedForMissingEntity && strictFieldAvailable && deterministic.text) {
            selectedRoutingBranch = "test_retrieval_narrow_deterministic";
            routingReason = "deterministic_field_extraction";
            reply = deterministic.text;
          } else if (!answerBlockedForMissingEntity && strictFieldAvailable && retrievalResult.matches.length) {
            selectedRoutingBranch = "test_retrieval_narrow_intent";
            routingReason = "narrow_intent_match";
            const extractedSection = await extractNarrowAnswerFromMatches({
              matches: [sourceConfirmedMatch],
              intent: resolvedIntent
            });
            if (extractedSection) {
              reply = await localizeNarrowAnswer({
                text: extractedSection,
                language: detectedLanguage,
                preserveCompleteness: resolvedIntent === "fees",
                applyStyle: false
              });
            }
          }

          if (!reply) {
            selectedRoutingBranch = "test_retrieval_truthful_field_fallback";
            routingReason = (answerBlockedForMissingEntity ? "entity_not_found" : fallbackReason) || "field_not_confirmed_for_requested_entity";
            console.log("[truthfulness-field-blocked]", JSON.stringify({
              requested_entity: truthContext.requestedEntity || null,
              requested_entity_exists_in_kb: strictEntityAvailable,
              requested_field: resolvedIntent,
              blocked_reason: routingReason,
              requested_field_exists_for_entity: strictFieldAvailable,
              selected_entity: deterministic.selectedEntity || sourceConfirmedMatch?.title || null,
              selected_source: sourceConfirmedMatch?.source || null,
              selected_article: sourceConfirmedMatch?.title || null
            }));
            reply = getLocalizedTruthfulnessFallback({
              language: detectedLanguage,
              requestedEntity: truthContext.requestedEntity || retrievalResult.entity || (currentCourseLanguage ? `${currentCourseLanguage}_course` : null),
              requestedField: resolvedIntent,
              reason: strictEntityAvailable ? "field_unavailable" : "entity_not_found"
            });
          }
          setCustomerState(from, {
            clarifyingAsked: false,
            preferredCourseLanguage: currentCourseLanguage,
            topicType: retrievalResult.entity_domain === "course" ? "language_course" : (userState.topicType || null),
            topicLanguage: currentCourseLanguage || userState.topicLanguage || null,
            topicEntity: retrievalResult.entity || userState.topicEntity || null,
            topicIntent: retrievalResult.intent || userState.topicIntent || null,
            topicDomain: retrievalResult.entity_domain || userState.topicDomain || null,
            topicLabel: retrievalResult.matches?.[0]?.title || userState.topicLabel || null,
            topicSubVariant: retrievalResult.sub_variant || subVariantDecision.subVariant || userState.topicSubVariant || null
          });
        } else if (resolvedIntent && !retrievalResult.matches.length) {
          selectedRoutingBranch = "test_retrieval_truthful_no_matches";
          routingReason = "no_source_confirmed_field_match";
          console.log("[truthfulness-guard]", JSON.stringify({
            requested_entity: retrievalResult.entity || currentCourseLanguage || userState.topicEntity || null,
            selected_entity: null,
            requested_field: resolvedIntent,
            source_confirmed_field_exists: false,
            answer_blocked_for_truthfulness: true,
            fallback_reason: "no_matches_for_requested_entity"
          }));
          reply = getLocalizedTruthfulnessFallback({
            language: detectedLanguage,
            requestedEntity: retrievalResult.entity || (currentCourseLanguage ? `${currentCourseLanguage}_course` : null),
            requestedField: resolvedIntent,
            reason: retrievalResult.entity ? "field_unavailable" : "entity_not_found"
          });
          setCustomerState(from, {
            clarifyingAsked: true,
            preferredCourseLanguage: currentCourseLanguage,
            topicType: retrievalResult.entity_domain === "course" ? "language_course" : (userState.topicType || null),
            topicLanguage: currentCourseLanguage || userState.topicLanguage || null,
            topicEntity: retrievalResult.entity || userState.topicEntity || null,
            topicIntent: retrievalResult.intent || userState.topicIntent || null,
            topicDomain: retrievalResult.entity_domain || userState.topicDomain || null,
            topicLabel: userState.topicLabel || null,
            topicSubVariant: retrievalResult.sub_variant || subVariantDecision.subVariant || userState.topicSubVariant || null
          });
        } else if (retrievalDiscipline === "broad_topic" && retrievalResult.matches.length) {
          selectedRoutingBranch = "test_retrieval_broad_summary";
          routingReason = "broad_topic_structured_summary";
          reply = buildBroadOverviewFromMatches({
            retrievalResult,
            language: detectedLanguage,
            maxItems: 3
          });
          setCustomerState(from, {
            clarifyingAsked: false,
            preferredCourseLanguage: currentCourseLanguage,
            topicType: currentCourseLanguage ? "language_course" : userState.topicType,
            topicLanguage: currentCourseLanguage || userState.topicLanguage,
            topicEntity: retrievalResult.entity || userState.topicEntity || null,
            topicIntent: retrievalResult.intent || userState.topicIntent || null,
            topicDomain: retrievalResult.entity_domain || userState.topicDomain || null,
            topicLabel: retrievalResult.matches?.[0]?.title || userState.topicLabel || null,
            topicSubVariant: retrievalResult.sub_variant || subVariantDecision.subVariant || userState.topicSubVariant || null
          });
        } else if ((retrievalDiscipline === "ambiguous" || broadMessage) && !retrievalResult.matches.length) {
          selectedRoutingBranch = "test_retrieval_clarify";
          routingReason = retrievalDiscipline === "ambiguous" ? "ambiguous_query_narrowing_required" : "broad_query_no_matches";
          reply = getLocalizedClarifyingQuestion(detectedLanguage, {
            topic: detectClarificationTopic({ text, retrievalResult, userState }),
            intent: resolvedIntent
          });
          setCustomerState(from, {
            clarifyingAsked: true,
            preferredCourseLanguage: currentCourseLanguage,
            topicType: currentCourseLanguage ? "language_course" : userState.topicType,
            topicLanguage: currentCourseLanguage || userState.topicLanguage,
            topicIntent: retrievalResult.intent || userState.topicIntent || null,
            topicDomain: retrievalResult.entity_domain || userState.topicDomain || null,
            topicLabel: retrievalResult.matches?.[0]?.title || userState.topicLabel || null,
            topicSubVariant: retrievalResult.sub_variant || subVariantDecision.subVariant || userState.topicSubVariant || null
          });
        } else if (retrievalDiscipline === "ambiguous") {
          selectedRoutingBranch = "test_retrieval_clarify";
          routingReason = "ambiguous_query_narrowing_required";
          reply = getLocalizedClarifyingQuestion(detectedLanguage, {
            topic: detectClarificationTopic({ text, retrievalResult, userState }),
            intent: resolvedIntent
          });
          setCustomerState(from, {
            clarifyingAsked: true,
            preferredCourseLanguage: currentCourseLanguage,
            topicType: currentCourseLanguage ? "language_course" : userState.topicType,
            topicLanguage: currentCourseLanguage || userState.topicLanguage,
            topicIntent: retrievalResult.intent || userState.topicIntent || null,
            topicDomain: retrievalResult.entity_domain || userState.topicDomain || null,
            topicLabel: retrievalResult.matches?.[0]?.title || userState.topicLabel || null,
            topicSubVariant: retrievalResult.sub_variant || subVariantDecision.subVariant || userState.topicSubVariant || null
          });
        } else if (retrievalResult.matches.length && !vagueMessage) {
          selectedRoutingBranch = "test_retrieval_answer";
          routingReason = "retrieval_matches_found";
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
            openaiCalledForMessage = true;
            console.log("[routing] route=openai_assistant", { openai_called: true, openai_skipped: false, reason: "retrieval_answer_ai_generation" });
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
            topicType: (currentCourseLanguage || retrievalResult.entity_domain === "course" || courseQueryActive) ? "language_course" : (userState.topicType || null),
            topicLanguage: currentCourseLanguage || userState.topicLanguage || null,
            topicEntity: retrievalResult.entity || userState.topicEntity || null,
            topicIntent: retrievalResult.intent || userState.topicIntent || null,
            topicDomain: retrievalResult.entity_domain || userState.topicDomain || null,
            topicLabel: safeMatches?.[0]?.title || userState.topicLabel || null,
            topicSubVariant: retrievalResult.sub_variant || subVariantDecision.subVariant || userState.topicSubVariant || null
          });
          console.log("[course-debug] course memory context set:", JSON.stringify({
            topicType: (currentCourseLanguage || courseQueryActive) ? "language_course" : null,
            topicLanguage: currentCourseLanguage || userState.topicLanguage || null
          }));
        } else {
          selectedRoutingBranch = "test_retrieval_ai_fallback";
          routingReason = "retrieval_ai_fallback";
          openaiCalledForMessage = true;
          console.log("[routing] route=openai_assistant", { openai_called: true, openai_skipped: false, reason: routingReason });
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
              topicType: (currentCourseLanguage || retrievalResult.entity_domain === "course" || courseQueryActive) ? "language_course" : (userState.topicType || null),
              topicLanguage: currentCourseLanguage || userState.topicLanguage || null,
              topicEntity: retrievalResult.entity || userState.topicEntity || null,
              topicIntent: retrievalResult.intent || userState.topicIntent || null,
              topicDomain: retrievalResult.entity_domain || userState.topicDomain || null,
              topicLabel: retrievalResult.matches?.[0]?.title || userState.topicLabel || null,
              topicSubVariant: retrievalResult.sub_variant || subVariantDecision.subVariant || userState.topicSubVariant || null
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
        logAiLayerFailure(err, "whatsapp_test_retrieval");
        selectedRoutingBranch = "test_retrieval_error_fallback";
        routingReason = "retrieval_exception_fallback";
        reply = kbMatches.length ? enforceReplyStyle(kbMatches[0]?.answer || "", detectedLanguage) : getLocalizedAck(detectedLanguage);
      }
    } else {
      selectedRoutingBranch = "live_safe_handoff";
      routingReason = testModeActive ? "test_retrieval_disabled" : "live_mode_safe_handoff";
      reply = getSafeHandoffMessage(detectedLanguage);
      controlledAction = "safe_handoff";
      suppressAutoAck = true;
    }
    const activeBranchAfterProcessing = getCustomerState(from).liveMenuOption || getCustomerState(from).topicDomain || getCustomerState(from).lastRoute || selectedRoutingBranch || "none";
    console.log("[routing-debug] inbound branch selected", {
      mode: activeMode.toUpperCase(),
      normalized_text_preview: String(normalizedInbound || "").slice(0, 160),
      branch: selectedRoutingBranch,
      normalized_text: normalizedInbound,
      test_retrieval_enabled: testRetrievalEnabledForMessage,
      reason: routingReason,
      detected_incoming_language: detectedLanguage,
      detected_service_intent: generalizedRouting.serviceIntent,
      detected_role_intent: generalizedRouting.roleIntent,
      override_triggered: generalizedRouting.overrideTriggered,
      clarification_triggered: generalizedRouting.clarificationTriggered,
      active_branch_before_message: activeBranchBeforeProcessing,
      active_branch_after_message: activeBranchAfterProcessing,
      fallback_reason: generalizedRouting.fallbackReason,
      platform_context: generalizedRouting.platform
    });
    console.log("[collaborator-subtype-routing]", JSON.stringify({
      detected_language: detectedLanguage,
      detected_broad_role_intent: providerIntentForRouting.detected ? "provider_collaboration" : "none",
      broad_role_intent_reason: providerIntentForRouting.reason,
      detected_collaborator_provider_subtype: providerSubtypeForRouting.subtype,
      collaborator_provider_subtype_reason: providerSubtypeForRouting.reason,
      chosen_subtype_template: selectedRoutingBranch.includes("provider_collaboration")
        ? (selectedRoutingBranch.includes("subtype_clarification") ? "provider_subtype_clarification" : (getCustomerState(from).collaboratorSubtype || providerSubtypeForRouting.subtype || "unknown_provider"))
        : "none",
      clarification_triggered: selectedRoutingBranch.includes("provider_collaboration_subtype_clarification"),
      active_branch_before_message: activeBranchBeforeProcessing,
      active_branch_after_message: activeBranchAfterProcessing,
      final_selected_route: selectedRoutingBranch
    }));
    logInboundRoutingDecision({
      mode: activeMode,
      branch: selectedRoutingBranch,
      text: inboundBody,
      normalizedText: normalizedInbound,
      testRetrievalEnabled: testRetrievalEnabledForMessage,
      reason: routingReason,
      retrievalBlocked: retrievalBlockedForSafety,
      retrievalBlockedReason,
      controlledAction,
      detectedLanguage,
      roleIntent: generalizedRouting.roleIntent,
      serviceIntent: generalizedRouting.serviceIntent,
      overrideTriggered: generalizedRouting.overrideTriggered,
      clarificationTriggered: generalizedRouting.clarificationTriggered,
      activeBranchBefore: activeBranchBeforeProcessing,
      activeBranchAfter: activeBranchAfterProcessing,
      platformContext: generalizedRouting.platform
    });
    if (reply) {
  const deterministicReplyFlow = selectedRoutingBranch === "greeting_menu" || selectedRoutingBranch === "menu_option";
  console.log("[routing] final_route_summary", { route: selectedRoutingBranch, openai_called: openaiCalledForMessage, openai_skipped: !openaiCalledForMessage, reason: routingReason });
  console.log("[deterministic-menu-debug] fixed_reply_send_attempt", {
    deterministic_flow: deterministicReplyFlow,
    branch: selectedRoutingBranch,
    to: from
  });
  try {
  if (reply.length > 180 && !suppressAutoAck && allowIntermediateAck) {
    const ack = getLocalizedAck(detectedLanguage);

    await sendWhatsAppText(from, ack, 1500);

    await saveMessage({
      wa_id: from,
      contact_name: contactName,
      direction: "out",
      body: ack,
      message_type: "text",
      ...buildBotOutboundOwnershipState(inboundOwnershipState)
    });

    await sendWhatsAppText(from, reply, 0);

    await saveMessage({
      wa_id: from,
      contact_name: contactName,
      direction: "out",
      body: reply,
      message_type: "text",
      ...buildBotOutboundOwnershipState(inboundOwnershipState)
    });
  } else {
    await sendWhatsAppText(from, reply, 0);

    await saveMessage({
      wa_id: from,
      contact_name: contactName,
      direction: "out",
      body: reply,
      message_type: "text",
      ...buildBotOutboundOwnershipState(inboundOwnershipState)
    });
  }
  console.log("[deterministic-menu-debug] fixed_reply_send_success", {
    deterministic_flow: deterministicReplyFlow,
    branch: selectedRoutingBranch,
    to: from
  });
  } catch (sendErr) {
    console.error("[deterministic-menu-debug] fixed_reply_send_failed", {
      deterministic_flow: deterministicReplyFlow,
      branch: selectedRoutingBranch,
      to: from,
      error: sendErr?.response?.data || sendErr?.message || sendErr
    });
    throw sendErr;
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



function getAuthenticatedIdentifier(req) {
  if (req.session?.authenticated && req.session?.username) return normalizeUserIdentifier(req.session.username);
  const authHeader = String(req.headers.authorization || "");
  if (authHeader.startsWith("Bearer ")) {
    const raw = authHeader.slice(7).trim();
    try {
      const decoded = Buffer.from(raw, "base64url").toString("utf8");
      const identifier = decoded.split(":")[0];
      return normalizeUserIdentifier(identifier);
    } catch (error) {
      return "";
    }
  }
  return "";
}

function requireAccountAuth(req, res, next) {
  const identifier = getAuthenticatedIdentifier(req);
  if (!identifier) return res.status(401).json({ error: "Unauthorized" });
  req.accountIdentifier = identifier;
  return next();
}

app.get("/settings", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "settings.html"));
});

app.get("/api/account/settings", requireAccountAuth, async (req, res) => {
  try {
    const { record } = await getUserSettings(req.accountIdentifier);
    const { password_hash, ...safe } = record;
    return res.json({ ok: true, user: safe });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.post("/api/account/settings", requireAccountAuth, async (req, res) => {
  try {
    const { store, normalized, record } = await getUserSettings(req.accountIdentifier);
    const next = sanitizeProfileInput(req.body || {}, record);
    const nextKey = normalizeUserIdentifier(next.username || normalized);
    store.users = store.users || {};
    const updatedRecord = { ...record, ...next, updated_at: new Date().toISOString() };
    if (nextKey !== normalized) delete store.users[normalized];
    store.users[nextKey] = updatedRecord;
    await writeAccountSettingsStore(store);
    if (req.session) req.session.username = nextKey;
    req.accountIdentifier = nextKey;
    const { password_hash, ...safe } = store.users[nextKey];
    const responseBody = { ok: true, message: "Settings updated", user: safe };
    if (requestUsesBearerAuth(req)) responseBody.token = createMobileAuthToken(nextKey);
    return res.json(responseBody);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});


app.post("/api/account/avatar", requireAccountAuth, avatarUpload.single("avatar"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Avatar file is required" });
    const avatarUrl = `/uploads/profile-avatars/${req.file.filename}`;
    const { store, normalized, record } = await getUserSettings(req.accountIdentifier);
    store.users = store.users || {};
    store.users[normalized] = { ...record, avatar_url: avatarUrl, updated_at: new Date().toISOString() };
    await writeAccountSettingsStore(store);
    return res.json({ ok: true, avatar_url: avatarUrl });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post("/api/branding/logo", requireAccountAuth, brandingLogoUpload.single("logo"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Logo file is required" });
    const logoFileUrl = `/uploads/branding/${req.file.filename}`;
    const logoDataUrl = await brandingLogoFileToDataUrl(req.file);
    const store = await readAccountSettingsStore();
    store.branding = sanitizeBrandingInput(
      { ...(store.branding || {}), logo_url: logoDataUrl, logo_file_url: logoFileUrl },
      store.branding || {}
    );
    await writeAccountSettingsStore(store);
    return res.json({ ok: true, logo_url: logoDataUrl, logo_file_url: logoFileUrl, branding: store.branding });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post("/api/branding/settings", requireAccountAuth, async (req, res) => {
  try {
    const store = await readAccountSettingsStore();
    store.branding = sanitizeBrandingInput(req.body || {}, store.branding || {});
    await writeAccountSettingsStore(store);
    return res.json({ ok: true, branding: store.branding });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.post("/api/account/change-password", requireAccountAuth, async (req, res) => {
  try {
    const currentPassword = String(req.body?.current_password || "");
    const nextPassword = String(req.body?.new_password || "");
    const confirmPassword = String(req.body?.confirm_password || "");
    if (!currentPassword || !nextPassword || !confirmPassword) return res.status(400).json({ error: "Current, new, and confirm password are required" });
    if (nextPassword.length < 8) return res.status(400).json({ error: "New password must be at least 8 characters" });
    if (confirmPassword !== nextPassword) return res.status(400).json({ error: "Password confirmation does not match" });
    const authResult = await verifyInboxCredentials(req.accountIdentifier, currentPassword);
    if (!authResult.ok) return res.status(401).json({ error: "Current password is incorrect" });
    const { store, normalized, record } = await getUserSettings(req.accountIdentifier);
    store.users = store.users || {};
    store.users[normalized] = { ...record, password_hash: hashPassword(nextPassword), updated_at: new Date().toISOString() };
    await writeAccountSettingsStore(store);
    return res.json({ ok: true, message: "Password updated" });
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
});

app.use("/api", requireAuth);

app.post("/api/routing/preview", async (req, res) => {
  try {
    const text = String(req.body?.text || "").trim();
    const platform = String(req.body?.platform || "web_or_mobile_internal").trim() || "web_or_mobile_internal";
    const previousBranch = String(req.body?.previous_branch || req.body?.previousBranch || "none");
    const decision = resolveGeneralizedRouting({
      text,
      previousBranch,
      previousRoleIntent: req.body?.previous_role_intent || req.body?.previousRoleIntent || null,
      previousServiceIntent: req.body?.previous_service_intent || req.body?.previousServiceIntent || null,
      platform,
      language: req.body?.language || null
    });
    console.log("[routing-intelligence] api_preview", JSON.stringify({
      platform_context: decision.platform,
      detected_incoming_language: decision.detectedLanguage,
      detected_service_intent: decision.serviceIntent,
      detected_role_intent: decision.roleIntent,
      override_triggered: decision.overrideTriggered,
      clarification_triggered: decision.clarificationTriggered,
      active_branch_before_message: decision.previousBranch,
      proposed_route: decision.route,
      fallback_reason: decision.fallbackReason
    }));
    return res.json({ ok: true, decision });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
});

app.get("/api/system/mode", async (req, res) => {
  const mode = await getCurrentSystemMode();
  return res.json({
    ok: true,
    mode,
    label: mode === "test" ? "TEST MODE" : "LIVE MODE",
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
    await persistSystemModeToDatabase(nextMode);
    runtimeSystemState.lastRefreshedAt = new Date().toISOString();

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

app.get("/api/communications/overview", async (req, res) => {
  const state = await readCommunicationsLayerState();
  return res.json({
    ok: true,
    platform_identity: "LSA GLOBAL Internal OS",
    communication_layer: {
      channels: ["whatsapp", "mail"],
      prepared_channels: ["forms", "all"],
      mail_threads: state.mail?.threads?.length || 0
    },
    signature_manager: state.signature_manager,
    reply_templates_count: Array.isArray(state.reply_templates) ? state.reply_templates.length : 0
  });
});

app.get("/api/communications/mail/threads", async (req, res) => {
  try {
    const state = await readCommunicationsLayerState();
    const view = String(req.query.view || "active").toLowerCase();
    const archived = view === "archived";
    const sourceThreads = Array.isArray(state.mail?.threads) ? state.mail.threads : [];
    const threads = sourceThreads
      .filter(t => Boolean(t.is_archived) === archived)
      .map(t => {
        const entries = Array.isArray(t.entries) ? t.entries : [];
        const latestEntry = entries
          .slice()
          .sort((a, b) => new Date(b.timestamp || b.created_at || 0) - new Date(a.timestamp || a.created_at || 0))[0];
        const lastActivityAt = latestEntry?.timestamp || latestEntry?.created_at || t.timestamp || null;
        const lastMessage = latestEntry?.preview || latestEntry?.body || t.preview || "";
        return {
          thread_id: t.thread_id,
          contact_name: t.subject,
          sender: t.sender,
          subject: t.subject,
          preview: t.preview,
          last_message: lastMessage,
          timestamp: lastActivityAt,
          last_time: lastActivityAt,
          last_activity_at: lastActivityAt,
          last_direction: latestEntry?.direction || t.direction || "in",
          is_read: t.is_read,
          label: t.is_read ? "Read" : "Unread"
        };
      })
      .sort((a, b) => new Date(b.last_activity_at || 0) - new Date(a.last_activity_at || 0));
    console.log("[inbox-api] mail thread load succeeded", {
      view: archived ? "archived" : "active",
      source_threads: sourceThreads.length,
      returned_threads: threads.length
    });
    return res.json(threads);
  } catch (error) {
    console.error("[inbox-api] mail thread load failed", { error_message: error?.message || String(error) });
    return res.status(500).json({
      error: {
        code: "MAIL_THREAD_LOAD_FAILED",
        message: "Mail thread loading failed. Existing mail communication data may still be present; this is not an empty mailbox confirmation.",
        details: error?.message || String(error)
      }
    });
  }
});

app.get("/api/communications/mail/threads/:thread_id", async (req, res) => {
  const state = await readCommunicationsLayerState();
  const thread = (state.mail?.threads || []).find(t => t.thread_id === req.params.thread_id);
  if (!thread) return res.status(404).json({ error: "Mail thread not found" });
  return res.json(thread.entries || []);
});


app.post("/api/communications/mail/reply", outboundUpload.single("attachment"), async (req, res) => {
  try {
    const state = await readCommunicationsLayerState();
    const threadId = String(req.body?.thread_id || "").trim();
    const body = String(req.body?.body || "").trim();
    if (!threadId) return res.status(400).json({ error: "thread_id is required" });
    const thread = (state.mail?.threads || []).find(t => t.thread_id === threadId);
    if (!thread) return res.status(404).json({ error: "Mail thread not found" });
    if (!body && !req.file) return res.status(400).json({ error: "Reply content or attachment required" });

    const newEntry = {
      entry_id: `mail-entry-${Date.now()}`,
      direction: "out",
      sender: "operations@lsa.global",
      recipient: thread.sender,
      recipients: [thread.sender],
      subject: thread.subject,
      body,
      preview: body || `Attachment: ${req.file?.originalname || "file"}`,
      timestamp: new Date().toISOString(),
      is_read: true,
      channel: "mail"
    };
    if (req.file) {
      newEntry.attachment = {
        file_name: req.file.originalname,
        mime_type: req.file.mimetype,
        size: req.file.size,
        path: `/uploads/outbound/${req.file.filename}`
      };
    }

    thread.entries = Array.isArray(thread.entries) ? thread.entries : [];
    const mailOwnershipState = applyMailHumanTakeover(thread, body || newEntry.preview);
    Object.assign(newEntry, mailOwnershipState || {});
    thread.entries.push(newEntry);
    thread.preview = newEntry.preview;
    thread.timestamp = newEntry.timestamp;
    thread.is_read = true;
    await writeCommunicationsLayerState(state);
    return res.json({ ok: true, entry: newEntry });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/api/communications/signatures", async (req, res) => {
  const state = await readCommunicationsLayerState();
  return res.json({ ok: true, signature_manager: state.signature_manager });
});

app.get("/api/communications/templates", async (req, res) => {
  const state = await readCommunicationsLayerState();
  return res.json({ ok: true, templates: state.reply_templates || [] });
});

const CONVERSATION_THREAD_REQUIRED_COLUMNS = [
  "wa_id",
  "body",
  "created_at",
  "direction"
];

const CONVERSATION_THREAD_OPTIONAL_COLUMNS = [
  "contact_name",
  "label",
  "is_archived",
  "conversation_owner",
  "human_takeover",
  "conversation_type",
  "followup_eligible"
];

const CONVERSATION_THREAD_SELECT_COLUMNS = [
  ...CONVERSATION_THREAD_REQUIRED_COLUMNS,
  ...CONVERSATION_THREAD_OPTIONAL_COLUMNS
];

const CONVERSATION_THREAD_SCHEMA_FIELD_PURPOSE = {
  contact_name: "contact display name",
  label: "staff label display",
  is_archived: "active/archive filtering",
  conversation_owner: "ownership display and human takeover state",
  human_takeover: "human takeover state",
  conversation_type: "follow-up classification",
  followup_eligible: "follow-up eligibility"
};

function buildConversationThreadSummary(rows) {
  const map = new Map();

  for (const row of rows || []) {
    if (!row?.wa_id || map.has(row.wa_id)) continue;
    map.set(row.wa_id, {
      wa_id: row.wa_id,
      contact_name: row.contact_name,
      last_message: row.body,
      last_direction: row.direction,
      last_time: row.created_at,
      label: row.label || "",
      is_archived: row.is_archived === true,
      conversation_owner: row.conversation_owner || null,
      human_takeover: row.human_takeover ?? null,
      conversation_type: row.conversation_type || null,
      followup_eligible: row.followup_eligible ?? null
    });
  }

  return Array.from(map.values());
}

async function queryConversationRowsForThreadView({ archived = false } = {}) {
  const blockedColumns = new Set();
  const degradedReasons = [];
  let archiveFilterAvailable = true;
  const attempts = [];
  const view = archived ? "archived" : "active";

  console.log("[inbox-api] conversation thread load started", {
    view,
    required_columns: CONVERSATION_THREAD_REQUIRED_COLUMNS,
    optional_columns: CONVERSATION_THREAD_OPTIONAL_COLUMNS
  });

  for (let attempt = 1; attempt <= CONVERSATION_THREAD_SELECT_COLUMNS.length + 3; attempt += 1) {
    const selectColumns = CONVERSATION_THREAD_SELECT_COLUMNS.filter((column) => !blockedColumns.has(column));
    let query = supabase
      .from("conversations")
      .select(selectColumns.join(", "))
      .order("created_at", { ascending: false });

    if (archiveFilterAvailable) {
      query = archived
        ? query.eq("is_archived", true)
        : query.or("is_archived.is.false,is_archived.is.null");
    }

    const { data, error } = await query;
    const missingColumn = extractMissingColumnName(error);
    attempts.push({
      attempt,
      archived,
      archive_filter_available: archiveFilterAvailable,
      selected_columns: selectColumns,
      row_count: Array.isArray(data) ? data.length : null,
      error_code: error?.code || null,
      error_message: error?.message || null,
      missing_column: missingColumn || null,
      missing_column_role: missingColumn
        ? (CONVERSATION_THREAD_REQUIRED_COLUMNS.includes(missingColumn) ? "required" : "optional")
        : null
    });

    if (!error) {
      const rows = Array.isArray(data) ? data : [];
      console.log("[inbox-api] conversation thread query succeeded", {
        view,
        rows: rows.length,
        degraded: blockedColumns.size > 0 || archiveFilterAvailable === false,
        blocked_columns: Array.from(blockedColumns),
        degraded_reasons: degradedReasons,
        archive_filter_available: archiveFilterAvailable
      });
      return {
        rows,
        attempts,
        blockedColumns: Array.from(blockedColumns),
        archiveFilterAvailable,
        degraded: blockedColumns.size > 0 || archiveFilterAvailable === false,
        degradedReasons
      };
    }

    const message = String(error?.message || "").toLowerCase();
    const archiveFilterFailed = missingColumn === "is_archived" || message.includes("is_archived");

    if (archiveFilterFailed && archiveFilterAvailable) {
      archiveFilterAvailable = false;
      blockedColumns.add("is_archived");
      degradedReasons.push("is_archived column unavailable; active inbox is using legacy unfiltered load and archived inbox cannot be separated safely");
      console.warn("[inbox-api] schema fallback activated for archive status column", {
        view,
        missing_column: "is_archived",
        field_purpose: CONVERSATION_THREAD_SCHEMA_FIELD_PURPOSE.is_archived,
        fallback: archived ? "return_empty_archived_view" : "legacy_active_unfiltered_load",
        error_code: error?.code || null,
        error_message: error?.message || String(error)
      });
      if (archived) {
        return {
          rows: [],
          attempts,
          blockedColumns: Array.from(blockedColumns),
          archiveFilterAvailable,
          degraded: true,
          degradedReasons
        };
      }
      continue;
    }

    if (missingColumn && selectColumns.includes(missingColumn)) {
      if (CONVERSATION_THREAD_REQUIRED_COLUMNS.includes(missingColumn)) {
        console.error("[inbox-api] required conversation thread column missing; cannot build safe inbox", {
          view,
          missing_column: missingColumn,
          error_code: error?.code || null,
          error_message: error?.message || String(error),
          attempts
        });
        return {
          rows: null,
          error: {
            code: "INBOX_REQUIRED_SCHEMA_MISSING",
            message: `The Communications Hub cannot load safely because required conversations.${missingColumn} is missing. Existing data may still be present; this is a schema/configuration issue, not an empty inbox.`
          },
          attempts,
          blockedColumns: Array.from(blockedColumns),
          archiveFilterAvailable,
          degraded: false,
          degradedReasons
        };
      }

      blockedColumns.add(missingColumn);
      degradedReasons.push(`${missingColumn} column unavailable; ${CONVERSATION_THREAD_SCHEMA_FIELD_PURPOSE[missingColumn] || "optional display metadata"} disabled for this load`);
      console.warn("[inbox-api] optional conversation thread column unavailable; retrying degraded load", {
        view,
        missing_column: missingColumn,
        field_purpose: CONVERSATION_THREAD_SCHEMA_FIELD_PURPOSE[missingColumn] || "optional display metadata",
        blocked_columns: Array.from(blockedColumns),
        error_code: error?.code || null,
        error_message: error?.message || String(error)
      });
      continue;
    }

    console.error("[inbox-api] conversation thread query failed without schema fallback", {
      view,
      error_code: error?.code || null,
      error_message: error?.message || String(error),
      attempts
    });
    return { rows: null, error, attempts, blockedColumns: Array.from(blockedColumns), archiveFilterAvailable, degraded: false, degradedReasons };
  }

  return {
    rows: null,
    attempts,
    blockedColumns: Array.from(blockedColumns),
    archiveFilterAvailable,
    degraded: blockedColumns.size > 0 || archiveFilterAvailable === false,
    degradedReasons,
    error: {
      code: "INBOX_SCHEMA_FALLBACK_EXHAUSTED",
      message: "Conversation thread query failed after repeated schema fallback attempts. Existing data may still be present; review schema and server logs."
    }
  };
}

function applyConversationThreadResponseHeaders(res, result = {}) {
  const blockedColumns = Array.isArray(result.blockedColumns) ? result.blockedColumns : [];
  const degradedReasons = Array.isArray(result.degradedReasons) ? result.degradedReasons : [];
  if (result.degraded || blockedColumns.length) {
    res.set("X-LSA-Inbox-Degraded", "true");
  }
  if (blockedColumns.length) {
    res.set("X-LSA-Inbox-Missing-Columns", blockedColumns.join(","));
  }
  if (degradedReasons.length) {
    res.set("X-LSA-Inbox-Warning", degradedReasons.join(" | ").slice(0, 900));
  }
}

async function getConversationVisibilityDiagnostics() {
  const diagnostics = {
    checked_at: new Date().toISOString(),
    total_rows: null,
    active_rows: null,
    archived_rows: null,
    latest_rows: [],
    archive_filter_available: true,
    warnings: []
  };

  const totalRes = await supabase.from("conversations").select("wa_id", { count: "exact", head: true });
  diagnostics.total_rows = totalRes.count ?? null;
  if (totalRes.error) diagnostics.warnings.push(`total count failed: ${totalRes.error.message || totalRes.error}`);

  const activeRes = await supabase
    .from("conversations")
    .select("wa_id", { count: "exact", head: true })
    .or("is_archived.is.false,is_archived.is.null");
  if (!activeRes.error) {
    diagnostics.active_rows = activeRes.count ?? null;
  } else if (extractMissingColumnName(activeRes.error) === "is_archived") {
    diagnostics.archive_filter_available = false;
    diagnostics.active_rows = diagnostics.total_rows;
    diagnostics.warnings.push("active count used legacy fallback because is_archived is missing");
  } else {
    diagnostics.warnings.push(`active count failed: ${activeRes.error.message || activeRes.error}`);
  }

  const archivedRes = await supabase
    .from("conversations")
    .select("wa_id", { count: "exact", head: true })
    .eq("is_archived", true);
  if (!archivedRes.error) {
    diagnostics.archived_rows = archivedRes.count ?? null;
  } else if (extractMissingColumnName(archivedRes.error) === "is_archived") {
    diagnostics.archive_filter_available = false;
    diagnostics.archived_rows = null;
    diagnostics.warnings.push("archived count skipped because is_archived is missing");
  } else {
    diagnostics.warnings.push(`archived count failed: ${archivedRes.error.message || archivedRes.error}`);
  }

  let latestRes = await supabase
    .from("conversations")
    .select("wa_id, created_at, direction, is_archived")
    .order("created_at", { ascending: false })
    .limit(10);
  if (latestRes.error && extractMissingColumnName(latestRes.error) === "is_archived") {
    diagnostics.archive_filter_available = false;
    diagnostics.warnings.push("latest rows used legacy fallback because is_archived is missing");
    latestRes = await supabase
      .from("conversations")
      .select("wa_id, created_at, direction")
      .order("created_at", { ascending: false })
      .limit(10);
  }
  diagnostics.latest_rows = Array.isArray(latestRes.data) ? latestRes.data : [];
  if (latestRes.error) diagnostics.warnings.push(`latest rows failed: ${latestRes.error.message || latestRes.error}`);

  return diagnostics;
}

app.get("/api/conversations", async (req, res) => {
  try {
    const result = await queryConversationRowsForThreadView({ archived: false });
    applyConversationThreadResponseHeaders(res, result);
    if (result.error) {
      console.error("[inbox-api] active conversation thread load failed", {
        error: result.error,
        blocked_columns: result.blockedColumns || [],
        attempts: result.attempts
      });
      return res.status(500).json({
        error: {
          code: result.error.code || "INBOX_THREAD_LOAD_FAILED",
          message: result.error.message || "Communications Hub thread loading failed. Existing conversation data may still be present; this is not an empty inbox confirmation.",
          operator_message: "Schema/configuration issue while loading active WhatsApp threads. Please review server logs and the conversations table schema."
        },
        diagnostics: {
          attempts: result.attempts,
          blocked_columns: result.blockedColumns || [],
          degraded_reasons: result.degradedReasons || []
        }
      });
    }

    const threads = buildConversationThreadSummary(result.rows);
    if (!threads.length) {
      const diagnostics = await getConversationVisibilityDiagnostics();
      console.warn("[inbox-api] active conversation thread view returned zero threads", {
        ...diagnostics,
        degraded: result.degraded || false,
        blocked_columns: result.blockedColumns || [],
        degraded_reasons: result.degradedReasons || []
      });
      res.set("X-LSA-Inbox-Active-Rows", String(diagnostics.active_rows ?? "unknown"));
      res.set("X-LSA-Inbox-Total-Rows", String(diagnostics.total_rows ?? "unknown"));
    }

    return res.json(threads);
  } catch (err) {
    console.error("[inbox-api] active conversation thread route crashed", { error_message: err?.message || String(err) });
    return res.status(500).json({
      error: {
        code: "INBOX_THREAD_ROUTE_ERROR",
        message: "Communications Hub thread loading hit an unexpected server error. Existing conversation data may still be present; this is not an empty inbox confirmation.",
        details: err?.message || String(err)
      }
    });
  }
});

app.get("/api/conversations/archived", async (req, res) => {
  try {
    const result = await queryConversationRowsForThreadView({ archived: true });
    applyConversationThreadResponseHeaders(res, result);
    if (result.error) {
      console.error("[inbox-api] archived conversation thread load failed", {
        error: result.error,
        blocked_columns: result.blockedColumns || [],
        attempts: result.attempts
      });
      return res.status(500).json({
        error: {
          code: result.error.code || "INBOX_ARCHIVED_THREAD_LOAD_FAILED",
          message: result.error.message || "Archived Communications Hub thread loading failed. Existing conversation data may still be present; this is not an empty archive confirmation.",
          operator_message: "Schema/configuration issue while loading archived WhatsApp threads. Please review server logs and the conversations table schema."
        },
        diagnostics: {
          attempts: result.attempts,
          blocked_columns: result.blockedColumns || [],
          degraded_reasons: result.degradedReasons || []
        }
      });
    }

    return res.json(buildConversationThreadSummary(result.rows));
  } catch (err) {
    console.error("[inbox-api] archived conversation thread route crashed", { error_message: err?.message || String(err) });
    return res.status(500).json({
      error: {
        code: "INBOX_ARCHIVED_THREAD_ROUTE_ERROR",
        message: "Archived Communications Hub thread loading hit an unexpected server error. Existing conversation data may still be present; this is not an empty archive confirmation.",
        details: err?.message || String(err)
      }
    });
  }
});

app.get("/api/conversations/diagnostics/visibility", async (req, res) => {
  try {
    const diagnostics = await getConversationVisibilityDiagnostics();
    return res.json({ ok: true, diagnostics });
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

app.post("/api/conversations/:wa_id/ownership/reset", async (req, res) => {
  try {
    const wa_id = req.params.wa_id;
    if (!wa_id) {
      return res.status(400).json({ error: "wa_id is required" });
    }

    const existingOwnershipState = await getConversationOwnershipState(wa_id);
    const conversationType = classifyConversationType({
      text: String(req.body?.conversation_type || ""),
      previousType: existingOwnershipState.conversationType
    });
    const followup = determineFollowupEligibility(conversationType, { humanTakeover: false });
    const resetState = {
      conversation_owner: "bot",
      human_takeover: false,
      last_human_reply_at: existingOwnershipState.lastHumanReplyAt,
      last_customer_message_at: existingOwnershipState.lastCustomerMessageAt,
      conversation_type: conversationType,
      followup_eligible: followup.eligible,
      automation_policy: `manual_reset_${followup.policy}`,
      bot_suppressed_reason: null,
      ownership_event: "manual_reset"
    };

    await updateConversationOwnershipRows(wa_id, resetState);
    logOwnershipDecision({
      waId: wa_id,
      channel: "whatsapp",
      state: resetState,
      event: "manual_reset"
    });

    return res.json({ ok: true, ownership: resetState });
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
    const existingOwnershipState = await getConversationOwnershipState(wa_id);
    const humanOwnershipState = buildHumanOutboundOwnershipState({
      conversationType: existingOwnershipState.conversationType,
      lastCustomerMessageAt: existingOwnershipState.lastCustomerMessageAt
    });
    logOwnershipDecision({
      waId: wa_id,
      channel: "whatsapp",
      state: humanOwnershipState,
      event: "human_takeover_activated"
    });
    console.log("[ownership] human takeover activated", {
      channel: "whatsapp",
      wa_id,
      trigger: "manual_text_send",
      last_human_reply_at: humanOwnershipState.last_human_reply_at
    });
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
      sent_reply_language: customerLanguage,
      ...humanOwnershipState
    });
    await updateConversationOwnershipRows(wa_id, humanOwnershipState);

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
    const existingOwnershipState = await getConversationOwnershipState(wa_id);
    const humanOwnershipState = buildHumanOutboundOwnershipState({
      conversationType: existingOwnershipState.conversationType,
      lastCustomerMessageAt: existingOwnershipState.lastCustomerMessageAt
    });
    logOwnershipDecision({
      waId: wa_id,
      channel: "whatsapp",
      state: humanOwnershipState,
      event: "human_takeover_activated"
    });
    console.log("[ownership] human takeover activated", {
      channel: "whatsapp",
      wa_id,
      trigger: "manual_attachment_send",
      last_human_reply_at: humanOwnershipState.last_human_reply_at
    });
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
      sent_reply_language: sentCaption ? customerLanguage : null,
      ...humanOwnershipState
    });
    await updateConversationOwnershipRows(wa_id, humanOwnershipState);

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



app.get("/ai-tools", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "ai-tools.html"));
});

async function queryAiToolsOverviewRows({ table, select, fallbackSelect, order, limit }) {
  let query = supabase.from(table).select(select);
  if (order) query = query.order(order.column, { ascending: order.ascending });
  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  if (!error) {
    return { data: data || [], warning: null };
  }

  const missingColumn = extractMissingColumnName(error);
  if (missingColumn && fallbackSelect && fallbackSelect !== select) {
    console.warn("[ai-tools] overview optional column unavailable; retrying with core fields", {
      table,
      missing_column: missingColumn
    });

    let fallbackQuery = supabase.from(table).select(fallbackSelect);
    if (order) fallbackQuery = fallbackQuery.order(order.column, { ascending: order.ascending });
    if (limit) fallbackQuery = fallbackQuery.limit(limit);

    const fallbackRes = await fallbackQuery;
    if (!fallbackRes.error) {
      return {
        data: fallbackRes.data || [],
        warning: { table, missing_column: missingColumn, fallback: "core_fields" }
      };
    }

    throw new Error(`AI tools overview ${table} fallback query failed: ${fallbackRes.error.message || fallbackRes.error}`);
  }

  throw new Error(`AI tools overview ${table} query failed: ${error.message || error}`);
}

app.get("/api/ai-tools/overview", requireAuth, async (req, res) => {
  try {
    const [conversationsRes, providersRes, captureRes, kbRes, mode] = await Promise.all([
      queryAiToolsOverviewRows({
        table: "conversations",
        select: "id,created_at,direction,test_mode_retrieval_used,requested_entity_exists_in_kb,staff_reply_text,sent_reply_text",
        fallbackSelect: "id,created_at,direction",
        order: { column: "created_at", ascending: false },
        limit: 2000
      }),
      queryAiToolsOverviewRows({
        table: "providers",
        select: "id,created_at,is_duplicate",
        fallbackSelect: "id,created_at"
      }),
      queryAiToolsOverviewRows({
        table: "kb_capture_assistant",
        select: "id,created_at,is_published_to_kb,duplicate_check_count",
        fallbackSelect: "id,created_at"
      }),
      queryAiToolsOverviewRows({
        table: "kb_articles",
        select: "id,created_at"
      }),
      getCurrentSystemMode()
    ]);

    const overviewWarnings = [conversationsRes, providersRes, captureRes, kbRes]
      .map(result => result.warning)
      .filter(Boolean);
    const conversations = conversationsRes.data || [];
    const providers = providersRes.data || [];
    const captures = captureRes.data || [];
    const kbArticles = kbRes.data || [];

    const now = new Date();
    const weekAgo = new Date(now); weekAgo.setUTCDate(now.getUTCDate() - 7);
    let outgoingDrafts = 0; let translated = 0; let retrievalTests = 0; let retrievalHits = 0;
    for (const row of conversations) {
      if (row.direction === "out") outgoingDrafts += 1;
      if (row.staff_reply_text && row.sent_reply_text && row.staff_reply_text !== row.sent_reply_text) translated += 1;
      if (row.test_mode_retrieval_used) retrievalTests += 1;
      if (row.requested_entity_exists_in_kb) retrievalHits += 1;
    }

    const providerDuplicates = providers.filter(p => p.is_duplicate).length;
    const publishedKb = captures.filter(c => c.is_published_to_kb).length;
    const duplicateChecks = captures.reduce((n, c) => n + Number(c.duplicate_check_count || 0), 0);
    const weeklyConversations = conversations.filter(c => new Date(c.created_at) >= weekAgo).length;

    return res.json({
      ok: true,
      generated_at: new Date().toISOString(),
      mode,
      catalog: AI_TOOLS_CATALOG,
      metrics: {
        weekly_conversations: weeklyConversations,
        outgoing_drafts: outgoingDrafts,
        translated_messages: translated,
        kb_articles: kbArticles.length,
        kb_published_from_capture: publishedKb,
        kb_duplicate_checks: duplicateChecks,
        providers_total: providers.length,
        providers_duplicates: providerDuplicates,
        retrieval_tests: retrievalTests,
        retrieval_hits: retrievalHits
      },
      warnings: overviewWarnings
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

app.get("/reports", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "reports.html"));
});

app.get("/automation", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "automation.html"));
});

app.get("/api/reports/overview", requireAuth, async (req, res) => {
  try {
    const [conversationsRes, kbRes, captureRes, quickRes, providersRes, modeRes] = await Promise.all([
      supabase.from("conversations").select("wa_id,created_at,direction,is_archived,attachment_url,detected_language,label,service_interest,normalized_intent,test_mode_retrieval_used,requested_entity_exists_in_kb").order("created_at", { ascending: false }).limit(2000),
      supabase.from("kb_articles").select("id,created_at"),
      supabase.from("kb_capture_assistant").select("id,created_at,duplicate_check_count,is_published_to_kb"),
      supabase.from("kb_quick_capture").select("id,created_at"),
      supabase.from("providers").select("id,created_at,provider_type,provider_category,document_count,is_duplicate"),
      getCurrentSystemMode()
    ]);

    const conversations = conversationsRes.data || [];
    const convMap = new Map();
    let incoming = 0; let outgoing = 0; let attachments = 0;
    const languages = new Map(); const interests = new Map();
    let retrievalAttempts = 0; let retrievalSuccess = 0; let retrievalFallback = 0;
    const topics = new Map();
    const now = new Date();
    const dayAgo = new Date(now); dayAgo.setUTCDate(now.getUTCDate() - 1);
    const weekAgo = new Date(now); weekAgo.setUTCDate(now.getUTCDate() - 7);
    const monthAgo = new Date(now); monthAgo.setUTCDate(now.getUTCDate() - 30);
    let newToday = 0; let newWeek = 0; let msg7d = 0; let conv7d=0; let conv30d=0;

    for (const row of conversations) {
      const created = new Date(row.created_at);
      if (!convMap.has(row.wa_id)) {
        convMap.set(row.wa_id, row);
        if (created >= dayAgo) newToday += 1;
        if (created >= weekAgo) newWeek += 1;
        if (created >= weekAgo) conv7d += 1;
        if (created >= monthAgo) conv30d += 1;
      }
      if (created >= weekAgo) msg7d += 1;
      if (row.direction === "out") outgoing += 1; else incoming += 1;
      if (row.attachment_url) attachments += 1;
      const lang = (row.detected_language || "unknown").toLowerCase();
      languages.set(lang, (languages.get(lang) || 0) + 1);
      const interest = row.service_interest || row.label || row.normalized_intent || "uncategorized";
      interests.set(interest, (interests.get(interest) || 0) + 1);
      if (row.test_mode_retrieval_used) retrievalAttempts += 1;
      if (row.requested_entity_exists_in_kb === true) retrievalSuccess += 1;
      if (row.test_mode_retrieval_used && row.requested_entity_exists_in_kb === false) retrievalFallback += 1;
      if (row.normalized_intent) topics.set(row.normalized_intent, (topics.get(row.normalized_intent)||0)+1);
    }

    const totalConversations = convMap.size;
    const archivedConversations = Array.from(convMap.values()).filter(r => r.is_archived === true).length;
    const activeConversations = totalConversations - archivedConversations;

    const providers = providersRes.data || [];
    const providerCats = new Map();
    let providerNew30 = 0; let providerDuplicates = 0; let providerDocs = 0;
    for (const p of providers) {
      if (new Date(p.created_at) >= monthAgo) providerNew30 += 1;
      if (p.is_duplicate) providerDuplicates += 1;
      providerDocs += Number(p.document_count || 0);
      const cat = p.provider_type || p.provider_category || 'other';
      providerCats.set(cat, (providerCats.get(cat)||0)+1);
    }

    const capture = captureRes.data || [];
    const duplicateChecks = capture.reduce((n, r) => n + Number(r.duplicate_check_count || 0), 0);
    const officialKbItems = capture.filter(r => r.is_published_to_kb).length;

    const toArray = (m, limit=6) => Array.from(m.entries()).sort((a,b)=>b[1]-a[1]).slice(0,limit).map(([label,value])=>({label,value}));

    return res.json({
      generated_at: new Date().toISOString(),
      inbox: { total_conversations: totalConversations, active_conversations: activeConversations, archived_conversations: archivedConversations, new_today: newToday, new_this_week: newWeek },
      messages: { incoming, outgoing, attachments, last_7_days: msg7d },
      languages: toArray(languages),
      service_interest: toArray(interests),
      kb: { total_articles: (kbRes.data || []).length, captured_items: capture.length + ((quickRes.data || []).length), official_items: officialKbItems, duplicate_checks: duplicateChecks },
      retrieval: { test_attempts: retrievalAttempts, successful: retrievalSuccess, fallbacks: retrievalFallback, top_topics: toArray(topics,4).map(x=>x.label) },
      providers: { total_official: providers.length, new_30_days: providerNew30, duplicates: providerDuplicates, documents: providerDocs, categories: toArray(providerCats) },
      matching: { searches: retrievalAttempts, top_language_pair: "TBD", top_service_type: toArray(interests,1)[0]?.label || "N/A" },
      system: { current_mode: modeRes === 'test' ? 'TEST' : 'LIVE', mode_updated_at: runtimeSystemState.updatedAt || null, can_change_mode: canChangeMode(req) },
      trends: { conversations_7d: conv7d, conversations_30d: conv30d, kb_growth_30d: (kbRes.data || []).filter(r => new Date(r.created_at) >= monthAgo).length, provider_growth_30d: providerNew30, matching_30d: retrievalAttempts }
    });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});
app.get("/kb", requireAuth, (req, res) => {
  res.sendFile(path.join(__dirname, "public", "kb.html"));
});

// ===== KB API: CATEGORIES =====
app.get("/api/automation/workflows", requireAuth, async (req, res) => {
  return res.json({ workflows: automationHub.listWorkflows() });
});

app.post("/api/automation/workflows/:id/state", requireAuth, async (req, res) => {
  const workflow = automationHub.setWorkflowState(req.params.id, req.body?.active);
  if (!workflow) return res.status(404).json({ error: "Workflow not found" });
  return res.json({ ok: true, workflow });
});

app.get("/api/automation/history", requireAuth, async (req, res) => {
  return res.json({ history: automationHub.listHistory(Number(req.query.limit || 100)) });
});

app.get("/api/automation/notifications", requireAuth, async (req, res) => {
  return res.json({ notifications: automationHub.listNotifications(Number(req.query.limit || 30)) });
});

app.post("/api/automation/run/:id", requireAuth, async (req, res) => {
  const workflowId = req.params.id;
  await automationHub.trigger("manual_trigger", { manualAction: workflowId === "wf-manual-provider-rematch" ? "rerun_provider_matching" : workflowId }, { initiatedBy: req.session?.username || "staff" });
  return res.json({ ok: true });
});

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

    await automationHub.trigger("new_captured_knowledge", {
      language: "en",
      serviceType: suggested_category || null,
      mode: "TEST"
    }, {
      source: "kb-capture"
    });

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
    if (!(await requireAiExperimentMode(res))) return;
    const { query = "", options = {} } = req.body || {};
    if (!query || !query.trim()) {
      return res.status(400).json({ error: "query is required" });
    }

    const result = await retrieveInternalKnowledgeForTestMode(query, { ...options, debug: true });
    return res.json({ ok: true, retrieval: result });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/ai-reply", async (req, res) => {
  try {
    if (!(await requireAiExperimentMode(res))) return;
    const { message, channel = "internal", wa_id = null } = req.body;

    if (!message || !message.trim()) {
      return res.status(400).json({ error: "message is required" });
    }

    const retrievalResult = await retrieveInternalKnowledgeForTestMode(message, { maxMatches: 10, debug: true });
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
7b. Ask clarifying questions only when a key detail is missing; otherwise answer directly.
8. If a relevant KB article is in another language, still use it and answer in the user's language.
9. Keep replies concise and narrow to the user's exact question.
10. If internal matches clearly answer the question, provide the answer directly and do not claim information is missing.
11. Clarifying question style: short, professional, and narrowing (one question only).
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

app.get("/api/providers/:providerId/documents", requireAuth, async (req, res) => {
  try {
    const providerId = req.params.providerId;
    const columnSet = await getProviderDocumentsColumnSet();
    const { data, error } = await queryProviderDocumentsWithSchemaFallback({
      providerId,
      columnSet
    });

    if (error) {
      return res.status(500).json({
        error: "Unable to load provider documents due to a temporary schema mismatch.",
        details: error
      });
    }

    const rows = (data || []).map(item => normalizeProviderDocumentRow(item, providerId));

    return res.json({ ok: true, data: rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

app.post("/api/providers/:providerId/documents", requireAuth, providerDocumentUpload.single("document"), async (req, res) => {
  try {
    const providerId = String(req.params.providerId || "").trim();
    const file = req.file;
    const rawDocumentType = String(req.body?.document_type || "").trim();
    const notes = String(req.body?.notes || "").trim();

    if (!providerId) {
      return res.status(400).json({ error: "providerId is required" });
    }
    if (!file) {
      return res.status(400).json({ error: "document file is required" });
    }

    const { data: providerRecord, error: providerError } = await supabase
      .from("providers")
      .select("id")
      .eq("id", providerId)
      .maybeSingle();

    if (providerError) {
      return res.status(500).json({ error: providerError });
    }

    if (!providerRecord) {
      return res.status(404).json({ error: "Provider not found." });
    }

    const documentType = PROVIDER_DOCUMENT_TYPES.has(rawDocumentType) ? rawDocumentType : "Other";
    const safeProviderFolder = sanitizeProviderFolder(providerId);
    const fileUrl = `/uploads/provider-documents/${safeProviderFolder}/${file.filename}`;
    const columnSet = await getProviderDocumentsColumnSet();

    const insertPayload = {
      provider_id: providerId,
      file_name: file.filename
    };
    if (!columnSet || columnSet.has("original_name")) {
      insertPayload.original_name = file.originalname || file.filename;
    }
    if (columnSet?.has("file_path")) {
      insertPayload.file_path = file.filename;
    }
    if (!columnSet || columnSet.has("file_url")) {
      insertPayload.file_url = fileUrl;
    }
    if (!columnSet || columnSet.has("mime_type")) {
      insertPayload.mime_type = file.mimetype || null;
    }
    if (!columnSet || columnSet.has("file_size")) {
      insertPayload.file_size = file.size || null;
    }
    if (!columnSet || columnSet.has("document_type")) {
      insertPayload.document_type = documentType;
    }
    if (!columnSet || columnSet.has("notes")) {
      insertPayload.notes = notes || null;
    }
    if (columnSet?.has("uploaded_at")) {
      insertPayload.uploaded_at = new Date().toISOString();
    }
    if (columnSet?.has("uploaded_by")) {
      insertPayload.uploaded_by = req.session?.username || null;
    }

    const { data: insertResult, error: insertError } = await supabase
      .from("provider_documents")
      .insert([insertPayload])
      .select("id")
      .single();

    if (insertError) {
      const missingColumn = extractMissingColumnName(insertError);
      if (missingColumn) {
        return res.status(500).json({
          error: `Provider document upload failed due to schema mismatch: missing column '${missingColumn}'.`,
          details: insertError
        });
      }
      return res.status(500).json({ error: insertError });
    }

    const insertedId = insertResult?.id;
    if (!insertedId) {
      return res.status(500).json({
        error: "Provider document upload succeeded but the inserted record id was not returned."
      });
    }

    const { data: fetchedRows, error: fetchError } = await queryProviderDocumentsWithSchemaFallback({
      providerId,
      columnSet,
      filterId: insertedId
    });

    if (fetchError) {
      return res.status(201).json({
        ok: true,
        warning: "Document uploaded, but metadata query failed due to schema mismatch.",
        data: {
          id: insertedId,
          provider_id: providerId,
          file_name: file.filename,
          original_name: file.originalname || file.filename,
          file_path: file.filename,
          file_url: fileUrl,
          mime_type: file.mimetype || null,
          file_size: file.size || null,
          document_type: documentType,
          notes: notes || null,
          uploaded_at: null,
          uploaded_by: req.session?.username || null,
          created_at: null
        }
      });
    }

    const insertedRow = Array.isArray(fetchedRows) ? fetchedRows[0] : null;
    if (!insertedRow) {
      return res.status(201).json({
        ok: true,
        warning: "Document uploaded, but inserted metadata row was not found immediately.",
        data: {
          id: insertedId,
          provider_id: providerId,
          file_name: file.filename,
          original_name: file.originalname || file.filename,
          file_path: file.filename,
          file_url: fileUrl,
          mime_type: file.mimetype || null,
          file_size: file.size || null,
          document_type: documentType,
          notes: notes || null,
          uploaded_at: null,
          uploaded_by: req.session?.username || null,
          created_at: null
        }
      });
    }

    await automationHub.trigger("document_uploaded", {
      module: "providers",
      providerId,
      attachmentExists: true
    }, {
      source: "provider-document-upload"
    });

    return res.json({ ok: true, data: normalizeProviderDocumentRow(insertedRow, providerId) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
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

function parseFlexibleList(value) {
  return String(value || "")
    .split(/[\n,;|]+/g)
    .map(item => normalizeToken(item))
    .filter(Boolean);
}

function parseLanguagePairs(value) {
  const rawItems = String(value || "")
    .split(/[\n,;|]+/g)
    .map(item => item.trim())
    .filter(Boolean);

  const parsed = [];

  for (const item of rawItems) {
    const normalizedItem = normalizeToken(item);
    if (!normalizedItem) continue;

    let source = "";
    let target = "";

    if (normalizedItem.includes(">")) {
      [source, target] = normalizedItem.split(">").map(part => normalizeToken(part));
    } else if (normalizedItem.includes(" to ")) {
      [source, target] = normalizedItem.split(" to ").map(part => normalizeToken(part));
    } else if (normalizedItem.includes(" - ")) {
      [source, target] = normalizedItem.split(" - ").map(part => normalizeToken(part));
    } else if (normalizedItem.includes("→")) {
      [source, target] = normalizedItem.split("→").map(part => normalizeToken(part));
    }

    if (source && target) {
      parsed.push(`${source}>${target}`);
    }
  }

  return [...new Set(parsed)];
}

function parseExperienceYears(value) {
  const numeric = Number(String(value || "").replace(/[^\d.]/g, ""));
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, numeric);
}

function parseBoolean(value) {
  if (typeof value === "boolean") return value;
  const normalized = normalizeToken(value);
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function valueMentionsOnline(value) {
  const text = normalizeToken(value);
  if (!text) return false;
  return /(online|remote|virtual|zoom|teams|google meet)/.test(text);
}

function includesAnyToken(tokens, candidate) {
  if (!tokens.length) return false;
  const normalizedCandidate = normalizeToken(candidate);
  if (!normalizedCandidate) return false;
  return tokens.some(token => normalizedCandidate.includes(token) || token.includes(normalizedCandidate));
}

function getModeWeights(requestType) {
  const mode = normalizeToken(requestType || "general");
  if (mode === "translation") {
    return {
      languagePair: 42,
      service: 32,
      specialization: 26,
      availability: 18,
      providerType: 12,
      locationCountry: 8,
      locationCity: 8,
      experience: 10,
      languageOverlap: 10
    };
  }
  if (mode === "interpreting") {
    return {
      languagePair: 24,
      service: 36,
      specialization: 26,
      availability: 20,
      providerType: 14,
      locationCountry: 12,
      locationCity: 14,
      experience: 10,
      languageOverlap: 12
    };
  }
  if (mode === "language_teaching") {
    return {
      languagePair: 30,
      service: 36,
      specialization: 20,
      availability: 18,
      providerType: 18,
      locationCountry: 10,
      locationCity: 12,
      experience: 12,
      languageOverlap: 12
    };
  }
  return {
    languagePair: 30,
    service: 28,
    specialization: 24,
    availability: 16,
    providerType: 14,
    locationCountry: 10,
    locationCity: 10,
    experience: 10,
    languageOverlap: 10
  };
}

function getProviderMatchScore(criteria, provider) {
  const reasons = [];
  const matchSignals = [];
  let score = 0;
  const weights = getModeWeights(criteria.request_type);

  const queryPairs = parseLanguagePairs(criteria.language_pair);
  const providerPairs = parseLanguagePairs(provider.language_pairs);
  const providerWorkingLanguages = parseFlexibleList(provider.working_languages);

  if (queryPairs.length) {
    const providerPairSet = new Set(providerPairs);
    const pairMatches = queryPairs.filter(pair => providerPairSet.has(pair));

    if (pairMatches.length) {
      score += weights.languagePair;
      reasons.push(`Exact language pair match: ${pairMatches.join(", ")}`);
      matchSignals.push("language_pair_exact");
    } else {
      const queryPairPieces = queryPairs[0].split(">");
      if (
        queryPairPieces.length === 2
        && providerWorkingLanguages.includes(queryPairPieces[0])
        && providerWorkingLanguages.includes(queryPairPieces[1])
      ) {
        score += Math.round(weights.languagePair * 0.55);
        reasons.push("Working languages overlap with requested pair");
        matchSignals.push("language_pair_supported");
      }
    }
  }

  const requestedServices = parseFlexibleList(criteria.service_type);
  if (requestedServices.length) {
    const providerServices = parseFlexibleList(provider.services);
    const providerType = normalizeToken(provider.provider_type);
    const serviceMatches = requestedServices.filter(service =>
      providerServices.includes(service)
      || providerType.includes(service)
      || service.includes(providerType)
    );
    if (serviceMatches.length) {
      score += weights.service;
      reasons.push(`Exact service match: ${serviceMatches.join(", ")}`);
      matchSignals.push("service_exact");
    } else if (
      criteria.request_type === "translation"
      && includesAnyToken(["translation", "translator"], provider.services)
    ) {
      score += Math.round(weights.service * 0.45);
      reasons.push("Service relevance: translation capability detected");
      matchSignals.push("service_related");
    } else if (
      criteria.request_type === "interpreting"
      && includesAnyToken(["interpreting", "interpreter"], provider.services)
    ) {
      score += Math.round(weights.service * 0.45);
      reasons.push("Service relevance: interpreting capability detected");
      matchSignals.push("service_related");
    } else if (
      criteria.request_type === "language_teaching"
      && includesAnyToken(["teaching", "training", "teacher", "course"], provider.services)
    ) {
      score += Math.round(weights.service * 0.45);
      reasons.push("Service relevance: teaching/training capability detected");
      matchSignals.push("service_related");
    }
  }

  const requestedSpecializations = parseFlexibleList(criteria.specialization);
  if (requestedSpecializations.length) {
    const providerSpecializations = parseFlexibleList(provider.specializations);
    const specializationMatches = requestedSpecializations.filter(spec => providerSpecializations.includes(spec));
    if (specializationMatches.length) {
      score += weights.specialization;
      reasons.push(`Specialization/domain matched: ${specializationMatches.join(", ")}`);
      matchSignals.push("specialization_exact");
    }
  }

  const availabilityNeed = normalizeToken(criteria.availability_need);
  const providerAvailability = normalizeToken(provider.availability_status);
  if (providerAvailability === "available") {
    score += weights.availability;
    reasons.push("Available now");
    matchSignals.push("availability");
  } else if (availabilityNeed && providerAvailability && availabilityNeed === providerAvailability) {
    score += Math.round(weights.availability * 0.55);
    reasons.push(`Availability aligns with request: ${providerAvailability}`);
    matchSignals.push("availability");
  }

  const requestedCountry = normalizeToken(criteria.country);
  const requestedCity = normalizeToken(criteria.city);
  const providerCountry = normalizeToken(provider.country);
  const providerCity = normalizeToken(provider.city);

  if (requestedCountry && providerCountry && requestedCountry === providerCountry) {
    score += weights.locationCountry;
    reasons.push(`Country match: ${provider.country}`);
    matchSignals.push("country");
  }
  if (requestedCity && providerCity && requestedCity === providerCity) {
    score += weights.locationCity;
    reasons.push(`City match: ${provider.city}`);
    matchSignals.push("city");
  }

  if (criteria.online_only && (valueMentionsOnline(provider.services) || valueMentionsOnline(provider.notes))) {
    score += Math.round(weights.locationCity * 0.5);
    reasons.push("Online/remote suitability detected");
    matchSignals.push("online");
  }

  const experienceYears = parseExperienceYears(provider.years_experience);
  if (experienceYears > 0) {
    const experiencePoints = Math.min(weights.experience, Math.floor(experienceYears / 2));
    score += experiencePoints;
    reasons.push(`Experience: ${experienceYears} year(s)`);
    matchSignals.push("experience");
  }

  if (queryPairs.length) {
    const [sourceLang, targetLang] = queryPairs[0].split(">");
    const overlapCount = [sourceLang, targetLang].filter(lang => providerWorkingLanguages.includes(lang)).length;
    if (overlapCount === 1) {
      score += Math.round(weights.languageOverlap * 0.5);
      reasons.push("Partial working-language overlap");
      matchSignals.push("language_overlap");
    }
  }

  const providerStatus = normalizeToken(provider.status);
  if (providerStatus === "active") {
    score += 6;
  } else if (providerStatus === "archived") {
    score -= 20;
  } else if (providerStatus && providerStatus !== "active") {
    score -= 6;
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    reasons,
    matchSignals
  };
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

  const boundedScore = Math.min(100, score);

  return {
    score: boundedScore,
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
          confidence_level: getConfidenceLabel(result.score),
          similarity_reason: result.reasons[0] || "Multiple weak supporting signals"
        };
      })
      .filter(item => item.confidence_score >= 35 || item.matched_fields.includes("email") || item.matched_fields.includes("phone") || item.matched_fields.includes("whatsapp"))
      .sort((a, b) => b.confidence_score - a.confidence_score)
      .slice(0, 8);

    if (ranked.length) {
      await automationHub.trigger("duplicate_detected", {
        duplicateScore: Number(ranked[0].confidence_score || 0) / 100
      }, {
        source: "providers-duplicate-check"
      });
    }

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

// ===== PROVIDER API: MATCHING ENGINE (PHASE 1) =====
app.post("/api/providers/match", async (req, res) => {
  try {
    const criteria = {
      request_type: req.body?.request_type || "general",
      language_pair: req.body?.language_pair || "",
      service_type: req.body?.service_type || "",
      specialization: req.body?.specialization || "",
      provider_type: req.body?.provider_type || "",
      country: req.body?.country || "",
      city: req.body?.city || "",
      online_only: parseBoolean(req.body?.online_only),
      availability_only: parseBoolean(req.body?.availability_only),
      min_years_experience: Number(req.body?.min_years_experience || 0) || 0,
      availability_need: req.body?.availability_need || "",
      notes: req.body?.notes || ""
    };

    const { data, error } = await supabase
      .from("providers")
      .select("id, provider_type, full_name, organization_name, contact_person, email, phone, whatsapp, working_languages, language_pairs, services, specializations, country, city, availability_status, years_experience, status, notes")
      .order("created_at", { ascending: false })
      .limit(500);

    if (error) {
      return res.status(500).json({ error });
    }

    const requestedProviderTypes = parseFlexibleList(criteria.provider_type);
    const ranked = (data || [])
      .filter(provider => {
        const providerAvailability = normalizeToken(provider.availability_status);
        if (criteria.availability_only && providerAvailability !== "available") return false;

        const experienceYears = parseExperienceYears(provider.years_experience);
        if (criteria.min_years_experience > 0 && experienceYears < criteria.min_years_experience) return false;

        if (requestedProviderTypes.length) {
          const providerType = normalizeToken(provider.provider_type);
          if (!requestedProviderTypes.some(type => providerType.includes(type) || type.includes(providerType))) {
            return false;
          }
        }

        if (criteria.online_only && !(valueMentionsOnline(provider.services) || valueMentionsOnline(provider.notes))) {
          return false;
        }

        return true;
      })
      .map(provider => {
        const scored = getProviderMatchScore(criteria, provider);
        return {
          provider_id: provider.id,
          provider_name: provider.full_name || "Unnamed Provider",
          organization_name: provider.organization_name || "",
          contact_summary: {
            contact_person: provider.contact_person || "",
            email: provider.email || "",
            phone: provider.phone || "",
            whatsapp: provider.whatsapp || ""
          },
          provider_type: provider.provider_type || "",
          service_summary: provider.services || "",
          working_languages: provider.working_languages || "",
          language_pairs: provider.language_pairs || "",
          specialization_summary: provider.specializations || "",
          country: provider.country || "",
          city: provider.city || "",
          availability_status: provider.availability_status || "",
          years_experience: provider.years_experience || "",
          score: scored.score,
          confidence_level: getConfidenceLabel(scored.score),
          why_matched: scored.reasons,
          match_signals: scored.matchSignals
        };
      })
      .filter(item => item.score >= 20)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12);

    return res.json({
      ok: true,
      summary: ranked.length
        ? `Found ${ranked.length} provider match(es) for staff review.`
        : "No strong provider matches found. Try broadening the criteria.",
      criteria,
      matches: ranked,
      comparison: ranked.slice(0, 3).map(item => ({
        provider_id: item.provider_id,
        provider_name: item.provider_name,
        score: item.score,
        service_summary: item.service_summary,
        language_pairs: item.language_pairs,
        availability_status: item.availability_status,
        location: [item.city, item.country].filter(Boolean).join(", ")
      }))
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

    await automationHub.trigger("new_captured_knowledge", {
      language: "en",
      serviceType: suggested_category || null,
      mode: "TEST"
    }, {
      source: "kb-capture"
    });

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

    const sanitizeDuplicateSearchToken = (value) => String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[’'`]/g, " ")
      .replace(/[^\p{L}\p{N}\s-]/gu, " ")
      .replace(/[%(),]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const searchText = [title || "", raw_question || "", raw_answer || ""]
      .join(" ")
      .split(/\s+/)
      .map(sanitizeDuplicateSearchToken)
      .filter(Boolean)
      .slice(0, 8);

    const buildKbSelect = () => supabase
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
      `);

    let data = [];
    let error = null;
    if (searchText.length > 0) {
      const collected = [];
      const seenIds = new Set();
      for (const term of searchText) {
        const safe = String(term || "").replace(/[%,]/g, "").trim();
        if (!safe) continue;
        const wildcard = safe.replace(/\s+/g, "%");
        const clause = [
          `title.ilike.%${wildcard}%`,
          `question.ilike.%${wildcard}%`,
          `answer.ilike.%${wildcard}%`,
          `keywords.ilike.%${wildcard}%`
        ].join(",");
        const tokenResult = await buildKbSelect().limit(8).or(clause);
        if (tokenResult.error) {
          error = tokenResult.error;
          break;
        }
        for (const row of (tokenResult.data || [])) {
          if (!row?.id || seenIds.has(row.id)) continue;
          seenIds.add(row.id);
          collected.push(row);
          if (collected.length >= 10) break;
        }
        if (collected.length >= 10) break;
      }
      data = collected;
    } else {
      const fallback = await buildKbSelect().limit(10);
      data = fallback.data || [];
      error = fallback.error || null;
    }

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
async function bootstrapSystemMode() {
  const persisted = await readPersistedSystemModeFromDatabase();
  if (!persisted) {
    return;
  }
  runtimeSystemState.mode = persisted.mode;
  runtimeSystemState.updatedAt = persisted.updatedAt;
  runtimeSystemState.lastRefreshedAt = new Date().toISOString();
  console.log(`[mode] Bootstrapped mode from DB: ${persisted.mode.toUpperCase()}`);
}

bootstrapSystemMode().finally(() => {
  app.listen(process.env.PORT || 10000, () => {
    console.log("Server running");
  });
});
