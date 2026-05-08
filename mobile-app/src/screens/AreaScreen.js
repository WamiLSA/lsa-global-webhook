import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { api } from '../api/client';
import { Screen } from '../components/Screen';
import { colors } from '../theme';
import { PRODUCT_AREAS } from '../navigation/productAreas';

const actionLabels = {
  kb: ['Review official articles', 'Capture operational knowledge', 'Run duplicate checks', 'Publish approved knowledge'],
  providers: ['Search provider records', 'Use provider capture', 'Review duplicate warnings', 'Open document vault and matching'],
  automation: ['Review workflow states', 'Check notification rules', 'Inspect automation history', 'Run supervised workflows'],
  'ai-tools': ['Preview routing intelligence', 'Use extraction/drafting aids', 'Review supervised AI utilities', 'Keep Live Mode protected'],
  reports: ['Open operational overview', 'Check inbox and message metrics', 'Review provider and KB growth', 'Monitor multilingual activity']
};

export function AreaScreen({ route, navigation }) {
  const area = PRODUCT_AREAS.find((item) => item.key === route.params?.areaKey) || PRODUCT_AREAS[0];
  const url = `${api.config.baseUrl}${area.webPath}`;
  const actions = actionLabels[area.key] || [];

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.hero}>
          <Text style={styles.eyebrow}>Core product area</Text>
          <Text style={styles.title}>{area.title}</Text>
          <Text style={styles.summary}>{area.summary}</Text>
          <Text style={styles.status}>{area.status}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Mobile access pattern</Text>
          <Text style={styles.body}>This entry keeps the full Internal OS visible on mobile. Until each complex manager is fully rebuilt as a native screen, the button below opens the authenticated web module for complete parity.</Text>
        </View>

        {actions.length ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Available web-app capabilities</Text>
            {actions.map((action) => <Text key={action} style={styles.bullet}>• {action}</Text>)}
          </View>
        ) : null}

        <Pressable style={styles.primary} onPress={() => Linking.openURL(url)}>
          <Text style={styles.primaryText}>Open full {area.title}</Text>
        </Pressable>
        <Pressable style={styles.secondary} onPress={() => navigation.navigate('Home')}>
          <Text style={styles.secondaryText}>Back to mobile app shell</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: 14, paddingBottom: 28 },
  hero: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 18, padding: 16, marginBottom: 12 },
  eyebrow: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  title: { color: colors.text, fontSize: 23, fontWeight: '800', marginTop: 4 },
  summary: { color: '#cbd5e1', lineHeight: 20, marginTop: 8 },
  status: { color: '#93c5fd', fontWeight: '800', marginTop: 10 },
  card: { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: 14, marginBottom: 12 },
  cardTitle: { color: colors.text, fontWeight: '800', fontSize: 16, marginBottom: 8 },
  body: { color: '#cbd5e1', lineHeight: 20 },
  bullet: { color: '#cbd5e1', marginBottom: 6, lineHeight: 19 },
  primary: { backgroundColor: colors.primary, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 4 },
  primaryText: { color: '#fff', fontWeight: '800' },
  secondary: { borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 10 },
  secondaryText: { color: colors.text, fontWeight: '800' }
});
