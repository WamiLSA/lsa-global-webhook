import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import Constants from 'expo-constants';
import { useAuth } from '../context/AuthContext';
import { api } from '../api/client';
import { Screen } from '../components/Screen';
import { colors } from '../theme';

export function SettingsScreen({ route }) {
  const { logout } = useAuth();
  const mode = route.params?.mode || 'TEST';
  const conversationCount = route.params?.conversationCount ?? 0;

  return (
    <Screen>
      <Text style={styles.title}>Settings & Internal Diagnostics</Text>
      <View style={styles.card}><Text style={styles.k}>Runtime Mode</Text><Text style={styles.v}>{mode}</Text></View>
      <View style={styles.card}><Text style={styles.k}>API Base URL</Text><Text style={styles.v}>{api.config.baseUrl || 'Not configured'}</Text></View>
      <View style={styles.card}><Text style={styles.k}>Loaded Conversations</Text><Text style={styles.v}>{conversationCount}</Text></View>
      <View style={styles.card}><Text style={styles.k}>Version</Text><Text style={styles.v}>{Constants.expoConfig?.version || 'dev'}</Text></View>
      <Pressable style={styles.button} onPress={logout}><Text style={styles.buttonText}>Secure Logout</Text></Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: { color: '#fff', fontSize: 22, fontWeight: '700', marginBottom: 12 },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 10 },
  k: { color: colors.textMuted, fontSize: 12, marginBottom: 2 },
  v: { color: colors.text, fontWeight: '600' },
  button: { marginTop: 20, backgroundColor: colors.danger, borderRadius: 10, padding: 12, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '700' }
});
