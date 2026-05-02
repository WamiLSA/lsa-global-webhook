import React, { useState } from 'react';
import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { useAuth } from '../context/AuthContext';

export function LoginScreen() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
      <Text style={styles.title}>LSA GLOBAL House</Text>
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
  container: { flex: 1, padding: 20, justifyContent: 'center', gap: 12, backgroundColor: '#0f172a' },
  title: { color: '#fff', fontSize: 24, fontWeight: '700', marginBottom: 10 },
  input: { backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10 },
  button: { backgroundColor: '#1d4ed8', borderRadius: 10, padding: 12, marginTop: 8 },
  buttonText: { color: '#fff', fontWeight: '700', textAlign: 'center' },
  error: { color: '#fca5a5' }
});
