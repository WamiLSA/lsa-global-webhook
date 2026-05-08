import React, { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';
import { ModeBadge } from '../components/ModeBadge';
import { Screen } from '../components/Screen';
import { colors } from '../theme';
import { PRODUCT_AREAS } from '../navigation/productAreas';

export function HomeScreen({ navigation }) {
  const [mode, setMode] = useState('TEST');
  const [conversationCount, setConversationCount] = useState(0);
  const [branding, setBranding] = useState({});

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [inboxResponse, brandingResponse] = await Promise.all([
          api.get('/api/mobile/inbox', { retries: 2 }),
          api.get('/api/branding/settings')
        ]);
        if (!mounted) return;
        setMode(inboxResponse.runtimeMode || 'TEST');
        setConversationCount((inboxResponse.conversations || []).length);
        setBranding(brandingResponse.branding || {});
      } catch (error) {
        console.log('[mobile-home] shell_load_failed', { message: error.message });
      }
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <View style={styles.brandRow}>
            {branding.logo_url ? <Image source={{ uri: api.resolveAssetUrl(branding.logo_url) }} style={styles.logo} /> : null}
            <View style={{ flex: 1 }}>
              <Text style={styles.eyebrow}>LSA GLOBAL Internal OS</Text>
              <Text style={styles.title}>{branding.brand_name || 'Mobile Operations Console'}</Text>
            </View>
          </View>
          <ModeBadge mode={mode} />
          <Text style={styles.heroText}>Full mobile entry point for communications, knowledge operations, provider intelligence, automation, settings, AI tools, and reports.</Text>
        </View>

        <Text style={styles.sectionTitle}>Core system areas</Text>
        {PRODUCT_AREAS.map((area) => (
          <Pressable key={area.key} style={styles.card} onPress={() => navigation.navigate(area.route, { mode, conversationCount })}>
            <View style={styles.cardTop}>
              <Text style={styles.cardTitle}>{area.title}</Text>
              <Text style={styles.chevron}>›</Text>
            </View>
            <Text style={styles.cardSummary}>{area.summary}</Text>
            <Text style={styles.status}>{area.status}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 14, paddingBottom: 28 },
  hero: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 18, padding: 16, gap: 12, marginBottom: 16 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  logo: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.surfaceAlt },
  eyebrow: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  title: { color: colors.text, fontSize: 22, fontWeight: '800', marginTop: 2 },
  heroText: { color: '#cbd5e1', lineHeight: 20 },
  sectionTitle: { color: colors.text, fontSize: 16, fontWeight: '800', marginBottom: 8 },
  card: { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '800', flex: 1 },
  chevron: { color: colors.textMuted, fontSize: 26, lineHeight: 26 },
  cardSummary: { color: '#cbd5e1', marginTop: 6, lineHeight: 19 },
  status: { color: '#93c5fd', fontSize: 12, fontWeight: '700', marginTop: 8 }
});
