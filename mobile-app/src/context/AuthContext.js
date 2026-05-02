import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import { api } from '../api/client';

const AuthContext = createContext(null);
const TOKEN_KEY = 'lsa_internal_token';

export function AuthProvider({ children }) {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    (async () => {
      const savedToken = await SecureStore.getItemAsync(TOKEN_KEY);
      if (savedToken) {
        setToken(savedToken);
        api.setToken(savedToken);
      }
      setInitializing(false);
    })();
  }, []);

  const login = async ({ username, password }) => {
    const response = await api.post('/api/mobile/auth/login', { username, password });
    const nextToken = response.token;

    await SecureStore.setItemAsync(TOKEN_KEY, nextToken);
    setToken(nextToken);
    setUser(response.user || null);
    api.setToken(nextToken);
  };

  const logout = async () => {
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setToken(null);
    setUser(null);
    api.setToken(null);
  };

  const value = useMemo(() => ({ token, user, initializing, login, logout }), [token, user, initializing]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
