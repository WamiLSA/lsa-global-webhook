import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { api } from '../api/client';

const AuthContext = createContext(null);
const TOKEN_KEY = 'lsa_internal_token';
const USER_KEY = 'lsa_internal_user';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    (async () => {
      const savedToken = await SecureStore.getItemAsync(TOKEN_KEY);
      const savedUser = await SecureStore.getItemAsync(USER_KEY);
      if (savedToken) {
        setToken(savedToken);
        api.setToken(savedToken);
      }
      if (savedUser) {
        try {
          setUser(JSON.parse(savedUser));
        } catch (error) {
          console.log('[mobile-auth] saved_user_parse_failed', { message: error.message });
        }
      }
      console.log('[mobile-auth] restored_session', { hasToken: Boolean(savedToken), api: api.diagnostics() });
      setInitializing(false);
    })();
  }, []);

  const login = async ({ username, password }) => {
    const loginIdentifier = String(username || '').trim();
    console.log('[mobile-auth] login_submit', { identifierPresent: Boolean(loginIdentifier), api: api.diagnostics() });
    const response = await api.post('/api/mobile/auth/login', { username: loginIdentifier, identifier: loginIdentifier, password });
    const nextToken = response?.token;

    if (!nextToken) {
      console.log('[mobile-auth] login_response_missing_token', { responseKeys: Object.keys(response || {}) });
      throw new Error('Login response did not include an auth token.');
    }

    const nextUser = response.user || null;
    await SecureStore.setItemAsync(TOKEN_KEY, nextToken);
    if (nextUser) await SecureStore.setItemAsync(USER_KEY, JSON.stringify(nextUser));
    setToken(nextToken);
    setUser(nextUser);
    api.setToken(nextToken);
    console.log('[mobile-auth] login_success', { username: nextUser?.username || null, auth: response.auth || null });
  };

  const updateSession = async ({ token: nextToken, user: nextUser }) => {
    if (nextToken) {
      await SecureStore.setItemAsync(TOKEN_KEY, nextToken);
      setToken(nextToken);
      api.setToken(nextToken);
    }
    if (nextUser) {
      await SecureStore.setItemAsync(USER_KEY, JSON.stringify(nextUser));
      setUser(nextUser);
    }
  };

  const logout = async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    await SecureStore.deleteItemAsync(USER_KEY);
    setToken(null);
    setUser(null);
    api.setToken(null);
    console.log('[mobile-auth] logout_complete');
  };

  const value = useMemo(() => ({ token, user, initializing, login, logout, updateSession }), [token, user, initializing]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
