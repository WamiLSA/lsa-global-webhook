import Constants from 'expo-constants';

const baseUrl = Constants.expoConfig?.extra?.apiBaseUrl;
let token = null;

async function request(path, options = {}) {
  const retries = options.retries ?? 1;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: options.method || 'GET',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...options.headers
        },
        body: options.body ? JSON.stringify(options.body) : undefined
      });

      if (response.status === 401) {
        const error = new Error('Unauthorized');
        error.code = 401;
        throw error;
      }

      if (!response.ok) {
        const message = await response.text();
        throw new Error(message || 'Request failed');
      }

      return response.json();
    } catch (error) {
      if (attempt === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
}

export const api = {
  config: { baseUrl },
  setToken(nextToken) {
    token = nextToken;
  },
  get(path, options) {
    return request(path, options);
  },
  post(path, body, options = {}) {
    return request(path, { method: 'POST', body, ...options });
  }
};
