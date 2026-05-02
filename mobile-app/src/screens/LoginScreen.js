import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Animated, Easing, Image } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

export function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [branding, setBranding] = useState({});
  const [anim] = useState(new Animated.Value(0));

  useEffect(() => {
    api.get('/api/branding/settings').then((d) => setBranding(d.branding || {})).catch(() => {});
    Animated.timing(anim, { toValue: 1, duration: 700, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
  }, [anim]);

  const onSubmit = async () => {
    try {
      setError('');
      setLoading(true);
      await login({ username, password });
    } catch (err) {
      setError('Login failed. Check your web username/password and API endpoint.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      {branding.logo_url ? <Animated.Image source={{ uri: `${api.config.baseUrl}${branding.logo_url}` }} style={[styles.logo, { opacity: anim, transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }]} /> : null}
      <Text style={styles.title}>{branding.brand_name || 'LSA GLOBAL House'}</Text>
      <TextInput placeholder="Username" autoCapitalize="none" style={styles.input} value={username} onChangeText={setUsername} />
      <TextInput placeholder="Password" secureTextEntry style={styles.input} value={password} onChangeText={setPassword} />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Pressable style={styles.button} onPress={onSubmit} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Signing in...' : 'Sign in'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: 'center', gap: 12, backgroundColor: '#0B3A8C' },
  logo: { width: 96, height: 96, alignSelf: 'center', marginBottom: 8 },
  title: { color: '#fff', fontSize: 24, fontWeight: '700', marginBottom: 10 },
  input: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  button: { backgroundColor: '#1d4ed8', borderRadius: 10, padding: 12, marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  error: { color: '#fca5a5' }
});
