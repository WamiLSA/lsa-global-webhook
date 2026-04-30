import Constants from 'expo-constants';

const baseUrl = Constants.expoConfig?.extra?.apiBaseUrl;

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Request failed');
  }

  return response.json();
}

let token = null;

export const api = {
  setToken(nextToken) {
    token = nextToken;
  },
  get(path) {
    return request(path);
  },
  post(path, body) {
    return request(path, { method: 'POST', body });
  }
};
