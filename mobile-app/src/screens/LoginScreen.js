import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet, Animated, Easing } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';

export function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [branding, setBranding] = useState({});
  const [brandingLoaded, setBrandingLoaded] = useState(false);
  const [anim] = useState(new Animated.Value(0));

  useEffect(() => {
    api.get('/api/branding/settings')
      .then((data) => {
        setBranding(data.branding || {});
        console.log('[mobile-branding] login_branding_loaded', { hasLogo: Boolean(data.branding?.logo_url), brandName: data.branding?.brand_name || null, api: api.diagnostics() });
      })
      .catch((err) => {
        console.log('[mobile-branding] login_branding_failed', { message: err.message, api: api.diagnostics() });
      })
      .finally(() => setBrandingLoaded(true));
    Animated.timing(anim, { toValue: 1, duration: 700, easing: Easing.out(Easing.ease), useNativeDriver: true }).start();
  }, [anim]);

  const brandColors = useMemo(() => ({
    primary: branding.primary_color || '#0B3A8C',
    darkPrimary: branding.dark_primary_color || '#072C70',
    accent: branding.accent_color || '#C81E1E',
    textOnPrimary: branding.text_on_primary || '#FFFFFF'
  }), [branding]);

  const onSubmit = async () => {
    try {
      setError('');
      setLoading(true);
      await login({ username, password });
    } catch (err) {
      console.log('[mobile-auth] login_failed_visible', { message: err.message, code: err.code || err.status || null, payload: err.payload || null, api: api.diagnostics() });
      setError(err.code === 401 ? 'Invalid username/email or password.' : `Login failed: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  const logoUri = branding.logo_url ? api.resolveAssetUrl(branding.logo_url) : '';

  return (
    <View style={[styles.container, { backgroundColor: brandColors.primary }]}>
      <View style={[styles.gradientPanel, { backgroundColor: brandColors.darkPrimary }]}>
        {logoUri ? (
          <Animated.Image
            source={{ uri: logoUri }}
            resizeMode="contain"
            style={[styles.logo, { opacity: anim, transform: [{ scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) }] }]}
          />
        ) : null}
        <Text style={[styles.title, { color: brandColors.textOnPrimary }]}>{branding.brand_name || 'LSA GLOBAL'}</Text>
        <Text style={[styles.subtitle, { color: brandColors.textOnPrimary }]}>Internal secure access</Text>
        {!brandingLoaded ? <Text style={[styles.diagnostic, { color: brandColors.textOnPrimary }]}>Loading shared branding…</Text> : null}
      </View>
      <View style={styles.box}>
        <TextInput placeholder="Username or email" autoCapitalize="none" autoCorrect={false} style={styles.input} value={username} onChangeText={setUsername} />
        <TextInput placeholder="Password" secureTextEntry style={styles.input} value={password} onChangeText={setPassword} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable style={[styles.button, { backgroundColor: brandColors.accent }]} onPress={onSubmit} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? 'Signing in...' : 'Sign in'}</Text>
        </Pressable>
        <Text style={styles.endpoint}>API: {api.config.baseUrl || 'not configured'}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, justifyContent: 'center', gap: 14 },
  gradientPanel: { borderRadius: 18, padding: 18, alignItems: 'center' },
  logo: { width: 112, height: 112, alignSelf: 'center', marginBottom: 8 },
  title: { fontSize: 25, fontWeight: '800', marginBottom: 4, textAlign: 'center' },
  subtitle: { fontSize: 13, opacity: 0.9, textAlign: 'center' },
  diagnostic: { fontSize: 12, marginTop: 8, opacity: 0.8 },
  box: { backgroundColor: 'rgba(255,255,255,0.97)', borderRadius: 14, padding: 16, gap: 12 },
  input: { backgroundColor: '#fff', borderColor: '#d1d5db', borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  button: { borderRadius: 10, padding: 12, marginTop: 2 },
  buttonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  error: { color: '#b91c1c', fontWeight: '600' },
  endpoint: { color: '#64748b', fontSize: 11, textAlign: 'center' }
});
