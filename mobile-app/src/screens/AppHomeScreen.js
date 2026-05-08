import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Image, ScrollView } from 'react-native';
import { Screen } from '../components/Screen';
import { ModeBadge } from '../components/ModeBadge';
import { MobileAppMenu } from '../components/MobileAppMenu';
import { api } from '../api/client';
import { colors, spacing } from '../theme';

export function AppHomeScreen({ navigation }) {
  const [mode, setMode] = useState('TEST');
  const [branding, setBranding] = useState({});
  const [conversationCount, setConversationCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadShell = useCallback(async () => {
    setError('');
    const [inboxResult, brandingResult] = await Promise.allSettled([
      api.get('/api/mobile/inbox', { retries: 2 }),
      api.get('/api/branding/settings', { retries: 1 })
    ]);

    if (inboxResult.status === 'fulfilled') {
      const inboxResponse = inboxResult.value || {};
      setMode(inboxResponse.runtimeMode || 'TEST');
      setConversationCount(Array.isArray(inboxResponse.conversations) ? inboxResponse.conversations.length : 0);
    } else {
      setError('Inbox status could not be loaded. The menu is still available.');
    }

    if (brandingResult.status === 'fulfilled') {
      setBranding(brandingResult.value?.branding || {});
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await loadShell();
      } finally {
        setLoading(false);
      }
    })();
  }, [loadShell]);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.brandCard}>
          <View style={styles.brandRow}>
            {branding.logo_url ? <Image source={{ uri: api.resolveAssetUrl(branding.logo_url) }} style={styles.brandLogo} /> : null}
            <View style={{ flex: 1 }}>
              <Text style={styles.brandText}>{branding.brand_name || 'LSA GLOBAL Internal OS'}</Text>
              <Text style={styles.subtitle}>Mobile command shell for core operations</Text>
            </View>
          </View>
          <ModeBadge mode={mode} />
          {loading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : (
            <Text style={styles.statusLine}>{conversationCount ?? 0} active inbox thread{conversationCount === 1 ? '' : 's'} available.</Text>
          )}
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
        <MobileAppMenu navigation={navigation} mode={mode} />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  brandCard: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 18, padding: spacing.md, marginBottom: spacing.md },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  brandLogo: { width: 42, height: 42, borderRadius: 10, backgroundColor: colors.surfaceAlt },
  brandText: { color: colors.text, fontWeight: '900', fontSize: 20 },
  subtitle: { color: colors.textMuted, marginTop: 4 },
  statusLine: { color: colors.text, marginTop: spacing.sm, fontWeight: '600' },
  error: { color: '#fca5a5', marginTop: spacing.sm },
  loader: { marginTop: spacing.sm, alignSelf: 'flex-start' }
});
