import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, ScrollView } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { Screen } from '../components/Screen';
import { colors } from '../theme';

const fields = ['avatar_url', 'first_name', 'last_name', 'display_name', 'username', 'email'];

export function SettingsScreen() {
  const { logout } = useAuth();
  const [form, setForm] = useState({});
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.get('/api/account/settings');
        setForm(data.user || {});
      } catch (error) {
        setStatus('Failed to load settings.');
      }
    })();
  }, []);

  const onSave = async () => {
    setSaving(true);
    setStatus('');
    try {
      await api.post('/api/account/settings', form);
      if (currentPassword || newPassword) {
        await api.post('/api/account/change-password', { current_password: currentPassword, new_password: newPassword });
      }
      setCurrentPassword('');
      setNewPassword('');
      setStatus('Settings updated successfully.');
    } catch (error) {
      setStatus(String(error.message || 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen>
      <ScrollView>
        <Text style={styles.title}>Account Settings</Text>
        {fields.map((key) => (
          <View style={styles.card} key={key}>
            <Text style={styles.k}>{key.replace('_', ' ').toUpperCase()}</Text>
            <TextInput value={form[key] || ''} onChangeText={(value) => setForm((prev) => ({ ...prev, [key]: value }))} style={styles.input} autoCapitalize="none" />
          </View>
        ))}
        <View style={styles.card}><Text style={styles.k}>CURRENT PASSWORD</Text><TextInput value={currentPassword} onChangeText={setCurrentPassword} style={styles.input} secureTextEntry /></View>
        <View style={styles.card}><Text style={styles.k}>NEW PASSWORD</Text><TextInput value={newPassword} onChangeText={setNewPassword} style={styles.input} secureTextEntry /></View>
        {!!status && <Text style={styles.status}>{status}</Text>}
        <Pressable style={styles.button} onPress={onSave} disabled={saving}><Text style={styles.buttonText}>{saving ? 'Saving...' : 'Save Settings'}</Text></Pressable>
        <Pressable style={[styles.button, { backgroundColor: colors.danger }]} onPress={logout}><Text style={styles.buttonText}>Secure Logout</Text></Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 12 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 10 },
  k: { color: colors.textMuted, fontSize: 12, marginBottom: 6 },
  input: { backgroundColor: '#0f172a', borderColor: colors.border, borderWidth: 1, color: colors.text, borderRadius: 8, padding: 10 },
  status: { color: '#86efac', marginVertical: 8 },
  button: { marginTop: 8, backgroundColor: colors.primary, borderRadius: 10, padding: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' }
});
