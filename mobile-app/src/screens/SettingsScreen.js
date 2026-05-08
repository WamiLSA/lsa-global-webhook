import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, TextInput, ScrollView, AppState, Image } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { Screen } from '../components/Screen';
import { MobileAppMenu } from '../components/MobileAppMenu';
import { colors } from '../theme';
import { useGlobalProgress } from '../progress/GlobalProgressContext';

const fields = ['first_name', 'last_name', 'display_name', 'username', 'email'];

export function SettingsScreen({ navigation }) {
  const { runWithProgress } = useGlobalProgress();
  const { logout, updateSession } = useAuth();
  const [form, setForm] = useState({});
  const [avatarAsset, setAvatarAsset] = useState(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [status, setStatus] = useState('');
  const [statusIsError, setStatusIsError] = useState(false);
  const statusTimerRef = useRef(null);
  const [saving, setSaving] = useState(false);
  const [branding, setBranding] = useState({});
  const [initialForm, setInitialForm] = useState({});
  const [initialBranding, setInitialBranding] = useState({});
  const [brandingLogoAsset, setBrandingLogoAsset] = useState(null);

  const loadSettings = useCallback(async () => {
    const data = await api.get('/api/account/settings');
    const user = data.user || {};
    setForm(user);
    setInitialForm({
      email: user.email || '',
      username: user.username || '',
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      display_name: user.display_name || ''
    });
    const brandingData = await api.get('/api/branding/settings');
    const currentBranding = brandingData.branding || {};
    setBranding(currentBranding);
    setInitialBranding({
      brand_name: currentBranding.brand_name || '',
      primary_color: currentBranding.primary_color || '',
      dark_primary_color: currentBranding.dark_primary_color || '',
      accent_color: currentBranding.accent_color || '',
      text_on_primary: currentBranding.text_on_primary || ''
    });
  }, []);

  const showStatus = useCallback((message, isError = false) => {
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current);
    setStatusIsError(isError);
    setStatus(message);
    if (message && !isError) {
      statusTimerRef.current = setTimeout(() => {
        setStatus('');
        setStatusIsError(false);
        statusTimerRef.current = null;
      }, 12000);
    }
  }, []);

  useEffect(() => () => { if (statusTimerRef.current) clearTimeout(statusTimerRef.current); }, []);

  useEffect(() => { loadSettings().catch(() => showStatus('Failed to load settings.', true)); }, [loadSettings, showStatus]);
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
    showStatus('');
    try {
      await runWithProgress('Save settings', async (progress) => {
        progress.update(16, 'Preparing payload...');
      const wantsPasswordChange = Boolean(currentPassword || newPassword || confirmPassword);
      if (wantsPasswordChange && (!currentPassword || !newPassword || !confirmPassword)) {
        throw new Error('To change password, current/new/confirm password are all required.');
      }
      if (wantsPasswordChange && newPassword !== confirmPassword) {
        throw new Error('New password and confirmation do not match.');
      }

      const payload = {};
      fields.forEach((key) => {
        const value = form[key] || '';
        if (value !== (initialForm[key] || '')) payload[key] = value;
      });
      if (Object.keys(payload).length) {
        progress.update(28, 'Saving account settings...');
        const accountResponse = await api.post('/api/account/settings', payload);
        if (accountResponse?.token) {
          await updateSession({ token: accountResponse.token, user: accountResponse.user });
        }
      }

      if (avatarAsset) {
        progress.update(44, 'Uploading avatar...');
        const fd = new FormData();
        fd.append('avatar', { uri: avatarAsset.uri, name: avatarAsset.name || 'avatar.jpg', type: avatarAsset.mimeType || 'image/jpeg' });
        await api.postForm('/api/account/avatar', fd);
      }

      if (brandingLogoAsset) {
        progress.update(62, 'Uploading branding logo...');
        const bfd = new FormData();
        bfd.append('logo', { uri: brandingLogoAsset.uri, name: brandingLogoAsset.name || 'branding-logo.jpg', type: brandingLogoAsset.mimeType || 'image/jpeg' });
        await api.postForm('/api/branding/logo', bfd);
      }

      const brandingPayload = {};
      ['brand_name', 'primary_color', 'dark_primary_color', 'accent_color', 'text_on_primary'].forEach((key) => {
        const value = branding[key] || '';
        if (value !== (initialBranding[key] || '')) brandingPayload[key] = value;
      });
      if (Object.keys(brandingPayload).length) {
        progress.update(78, 'Saving branding profile...');
        await api.post('/api/branding/settings', brandingPayload);
      }

      if (wantsPasswordChange) {
        progress.update(88, 'Updating password...');
        await api.post('/api/account/change-password', { current_password: currentPassword, new_password: newPassword, confirm_password: confirmPassword });
      }
      setAvatarAsset(null);
      setBrandingLogoAsset(null);
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      progress.update(95, 'Refreshing settings...');
      await loadSettings();
      showStatus('Settings updated and synchronized.');
      });
    } catch (error) {
      showStatus(String(error.message || 'Save failed'), true);
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
        <MobileAppMenu navigation={navigation} currentKey="settings" compact />
        <Text style={styles.title}>Account Settings</Text>
        <View style={styles.card}><Text style={styles.k}>AVATAR</Text><View style={styles.avatarRow}><Image source={{ uri: avatarAsset?.uri || form.avatar_url || 'https://via.placeholder.com/64' }} style={styles.avatar} /><Pressable style={styles.smallButton} onPress={pickAvatar}><Text style={styles.buttonText}>Choose Photo</Text></Pressable></View></View>
        <View style={styles.card}><Text style={styles.k}>BRANDING</Text><View style={styles.avatarRow}><Image source={{ uri: brandingLogoAsset?.uri || (branding.logo_url ? api.resolveAssetUrl(branding.logo_url) : 'https://via.placeholder.com/64') }} style={styles.avatar} /><Pressable style={styles.smallButton} onPress={pickBrandingLogo}><Text style={styles.buttonText}>Choose Logo</Text></Pressable></View></View>
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
        <Pressable style={styles.button} onPress={onSave} disabled={saving}><Text style={styles.buttonText}>{saving ? 'Saving...' : 'Save Settings'}</Text></Pressable>
        {!!status && <Text style={[styles.status, statusIsError && styles.statusError]}>{status}</Text>}
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
  status: { color: '#86efac', marginTop: 8, marginBottom: 2 },
  statusError: { color: '#fca5a5' },
  button: { marginTop: 8, backgroundColor: colors.primary, borderRadius: 10, padding: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' }
});
