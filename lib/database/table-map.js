'use strict';

/**
 * Table constants observed in the database migration-readiness audit.
 * Source: docs/operations/database-migration-readiness-audit.md
 *
 * This file is a non-invasive reference map only (no runtime wiring yet).
 */

const TABLES = Object.freeze({
  APP_CONFIG: 'app_config',
  CONVERSATIONS: 'conversations',
  KB_ARTICLES: 'kb_articles',
  KB_CAPTURE_ASSISTANT: 'kb_capture_assistant',
  KB_CATEGORIES: 'kb_categories',
  KB_QUICK_CAPTURE: 'kb_quick_capture',
  PROVIDER_DOCUMENTS: 'provider_documents',
  PROVIDERS: 'providers',
});

const SYSTEM_TABLES = Object.freeze({
  INFORMATION_SCHEMA_COLUMNS: 'information_schema.columns',
});

module.exports = {
  TABLES,
  SYSTEM_TABLES,
};
