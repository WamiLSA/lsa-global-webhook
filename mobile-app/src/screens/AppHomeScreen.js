import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Image } from 'react-native';
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
      setError('Inbox status could not be loaded. Module navigation is still available.');
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
      <View style={styles.statusStrip}>
        <View style={styles.brandCluster}>
          {branding.logo_url ? <Image source={{ uri: api.resolveAssetUrl(branding.logo_url) }} style={styles.brandLogo} /> : null}
          <View style={styles.brandTextWrap}>
            <Text style={styles.brandText}>{branding.brand_name || 'LSA GLOBAL'}</Text>
            {loading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : (
              <Text style={styles.statusLine}>{conversationCount ?? 0} active inbox thread{conversationCount === 1 ? '' : 's'}</Text>
            )}
          </View>
        </View>
        <ModeBadge mode={mode} />
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <MobileAppMenu navigation={navigation} mode={mode} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  statusStrip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, padding: spacing.md, paddingBottom: spacing.sm, backgroundColor: colors.bg },
  brandCluster: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  brandLogo: { width: 32, height: 32, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  brandTextWrap: { flex: 1 },
  brandText: { color: colors.text, fontWeight: '900', fontSize: 15 },
  statusLine: { color: colors.textMuted, marginTop: 2, fontWeight: '700', fontSize: 12 },
  error: { color: '#fca5a5', marginHorizontal: spacing.md, marginBottom: spacing.sm },
  loader: { marginTop: 2, alignSelf: 'flex-start' }
});
