import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, ScrollView, AppState, Image } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { Screen } from '../components/Screen';
import { colors } from '../theme';
import { useGlobalProgress } from '../progress/GlobalProgressContext';

const fields = ['first_name', 'last_name', 'display_name', 'username', 'email'];

export function SettingsScreen() {
  const { runWithProgress } = useGlobalProgress();
  const { logout } = useAuth();
  const [form, setForm] = useState({});
  const [avatarAsset, setAvatarAsset] = useState(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [status, setStatus] = useState('');
  const [saving, setSaving] = useState(false);
  const [branding, setBranding] = useState({});
  const [brandingLogoAsset, setBrandingLogoAsset] = useState(null);

  const loadSettings = useCallback(async () => {
    const data = await api.get('/api/account/settings');
    setForm(data.user || {});
    const brandingData = await api.get('/api/branding/settings');
    setBranding(brandingData.branding || {});
  }, []);

  useEffect(() => { loadSettings().catch(() => setStatus('Failed to load settings.')); }, [loadSettings]);
  useFocusEffect(useCallback(() => { loadSettings().catch(() => {}); }, [loadSettings]));

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') loadSettings().catch(() => {}); });
    return () => sub.remove();
  }, [loadSettings]);

  const pickAvatar = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['image/*'], copyToCacheDirectory: true });
    if (!result.canceled && result.assets?.length) setAvatarAsset(result.assets[0]);
  };

  const onSave = async () => {
    setSaving(true);
    setStatus('');
    try {
      await runWithProgress('Save settings', async (progress) => {
        progress.update(16, 'Preparing payload...');
      let avatarUrl = '';
      if (avatarAsset) {
        progress.update(28, 'Uploading avatar...');
        const fd = new FormData();
        fd.append('avatar', { uri: avatarAsset.uri, name: avatarAsset.name || 'avatar.jpg', type: avatarAsset.mimeType || 'image/jpeg' });
        const upload = await api.postForm('/api/account/avatar', fd);
        avatarUrl = upload.avatar_url;
      }
      const payload = { ...form, ...(avatarUrl ? { avatar_url: avatarUrl } : {}) };
      progress.update(52, 'Saving account settings...');
      await api.post('/api/account/settings', payload);
      if (brandingLogoAsset) {
        progress.update(68, 'Uploading branding logo...');
        const bfd = new FormData();
        bfd.append('logo', { uri: brandingLogoAsset.uri, name: brandingLogoAsset.name || 'branding-logo.jpg', type: brandingLogoAsset.mimeType || 'image/jpeg' });
        await api.postForm('/api/branding/logo', bfd);
      }
      progress.update(82, 'Saving branding profile...');
      await api.post('/api/branding/settings', branding);
      if (currentPassword || newPassword || confirmPassword) {
        await api.post('/api/account/change-password', { current_password: currentPassword, new_password: newPassword, confirm_password: confirmPassword });
      }
      setAvatarAsset(null);
      setBrandingLogoAsset(null);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      progress.update(95, 'Refreshing settings...');
      await loadSettings();
      setStatus('Settings updated and synchronized.');
      });
    } catch (error) {
      setStatus(String(error.message || 'Save failed'));
    } finally {
      setSaving(false);
    }
  };
  const pickBrandingLogo = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: ['image/*'], copyToCacheDirectory: true });
    if (!result.canceled && result.assets?.length) setBrandingLogoAsset(result.assets[0]);
  };

  const PasswordField = ({ label, value, onChange, visible, onToggle }) => (
    <View style={styles.card}><Text style={styles.k}>{label}</Text><View style={styles.passwordRow}><TextInput value={value} onChangeText={onChange} style={[styles.input, { flex: 1 }]} secureTextEntry={!visible} /><Pressable onPress={onToggle} style={styles.eye}><Text style={styles.eyeText}>👁</Text></Pressable></View></View>
  );

  return (
    <Screen>
      <ScrollView>
        <Text style={styles.title}>Account Settings</Text>
        <View style={styles.card}><Text style={styles.k}>AVATAR</Text><View style={styles.avatarRow}><Image source={{ uri: avatarAsset?.uri || form.avatar_url || 'https://via.placeholder.com/64' }} style={styles.avatar} /><Pressable style={styles.smallButton} onPress={pickAvatar}><Text style={styles.buttonText}>Choose Photo</Text></Pressable></View></View>
        <View style={styles.card}><Text style={styles.k}>BRANDING</Text><View style={styles.avatarRow}><Image source={{ uri: brandingLogoAsset?.uri || (branding.logo_url ? `${api.config.baseUrl}${branding.logo_url}` : 'https://via.placeholder.com/64') }} style={styles.avatar} /><Pressable style={styles.smallButton} onPress={pickBrandingLogo}><Text style={styles.buttonText}>Choose Logo</Text></Pressable></View></View>
        <View style={styles.card}><Text style={styles.k}>BRAND NAME</Text><TextInput value={branding.brand_name || ''} onChangeText={(value) => setBranding((prev) => ({ ...prev, brand_name: value }))} style={styles.input} /></View>
        {fields.map((key) => (
          <View style={styles.card} key={key}>
            <Text style={styles.k}>{key.replace('_', ' ').toUpperCase()}</Text>
            <TextInput value={form[key] || ''} onChangeText={(value) => setForm((prev) => ({ ...prev, [key]: value }))} style={styles.input} autoCapitalize="none" />
          </View>
        ))}
        <PasswordField label="CURRENT PASSWORD" value={currentPassword} onChange={setCurrentPassword} visible={showCurrent} onToggle={() => setShowCurrent((v) => !v)} />
        <PasswordField label="NEW PASSWORD" value={newPassword} onChange={setNewPassword} visible={showNew} onToggle={() => setShowNew((v) => !v)} />
        <PasswordField label="CONFIRM NEW PASSWORD" value={confirmPassword} onChange={setConfirmPassword} visible={showConfirm} onToggle={() => setShowConfirm((v) => !v)} />
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
  passwordRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  eye: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 10 },
  eyeText: { color: colors.text },
  avatarRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  avatar: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#0f172a' },
  smallButton: { backgroundColor: colors.primary, borderRadius: 8, padding: 10 },
  status: { color: '#86efac', marginVertical: 8 },
  button: { marginTop: 8, backgroundColor: colors.primary, borderRadius: 10, padding: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' }
});
