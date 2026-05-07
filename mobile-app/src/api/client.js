import Constants from 'expo-constants';

const rawBaseUrl = Constants.expoConfig?.extra?.apiBaseUrl || Constants.manifest?.extra?.apiBaseUrl || '';
const baseUrl = String(rawBaseUrl).replace(/\/+$/, '');
let token = null;

function getDiagnosticsContext() {
  return {
    baseUrl: baseUrl || '(missing)',
    hasToken: Boolean(token)
  };
}

function logApiDiagnostic(event, details = {}) {
  console.log(`[mobile-api] ${event}`, { ...getDiagnosticsContext(), ...details });
}

function resolveAssetUrl(value) {
  if (!value) return '';
  const assetUrl = String(value);
  if (/^(data:|https?:)/i.test(assetUrl)) return assetUrl;
  return `${baseUrl}${assetUrl.startsWith('/') ? '' : '/'}${assetUrl}`;
}

async function parseResponsePayload(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return { raw: text };
  }
}

async function request(path, options = {}) {
  if (!baseUrl) {
    throw new Error('Mobile API base URL is not configured. Set LSA_MOBILE_API_BASE_URL or EXPO_PUBLIC_API_BASE_URL before building the app.');
  }

  const method = (options.method || 'GET').toUpperCase();
  const isSafeMethod = method === 'GET' || method === 'HEAD';
  const retries = options.retries ?? (isSafeMethod ? 1 : 0);
  const url = `${baseUrl}${path}`;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const isFormData = typeof FormData !== 'undefined' && options.body instanceof FormData;
      logApiDiagnostic('request_start', { method, path, attempt: attempt + 1, retries });
      const response = await fetch(url, {
        method,
        headers: {
          ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers
        },
        body: options.body ? (isFormData ? options.body : JSON.stringify(options.body)) : undefined
      });

      const payload = await parseResponsePayload(response);
      logApiDiagnostic('request_complete', { method, path, status: response.status, ok: response.ok });

      if (response.status === 401) {
        const error = new Error(payload?.error || 'Unauthorized');
        error.code = 401;
        error.payload = payload;
        throw error;
      }

      if (!response.ok) {
        const error = new Error(payload?.error?.message || payload?.error || payload?.raw || 'Request failed');
        error.status = response.status;
        error.payload = payload;
        throw error;
      }

      return payload;
    } catch (error) {
      logApiDiagnostic('request_failed', { method, path, attempt: attempt + 1, message: error.message, code: error.code || error.status || null });
      if (attempt === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}

export const api = {
  config: { baseUrl },
  diagnostics: getDiagnosticsContext,
  resolveAssetUrl,
  setToken(nextToken) {
    token = nextToken;
    logApiDiagnostic('token_updated', { hasToken: Boolean(token) });
  },
  get(path, options) {
    return request(path, options);
  },
  post(path, body, options = {}) {
    return request(path, { method: 'POST', body, ...options });
  },
  postForm(path, formData, options = {}) {
    return request(path, { method: 'POST', body: formData, ...options });
  },
  previewRouting(text, context = {}) {
    return request('/api/routing/preview', {
      method: 'POST',
      body: { text, platform: 'mobile_app', ...context }
    });
  }
};
