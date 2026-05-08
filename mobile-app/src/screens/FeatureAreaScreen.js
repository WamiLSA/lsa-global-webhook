import React from 'react';
import { View, Text, Pressable, StyleSheet, Linking, ScrollView } from 'react-native';
import { Screen } from '../components/Screen';
import { MobileAppMenu } from '../components/MobileAppMenu';
import { getAreaByKey } from '../navigation/mobileAreas';
import { api } from '../api/client';
import { colors, spacing } from '../theme';

export function FeatureAreaScreen({ route, navigation }) {
  const area = getAreaByKey(route.params?.areaKey) || getAreaByKey('inbox');
  const webUrl = api.resolveWebUrl(area.webPath);

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.content}>
        <MobileAppMenu navigation={navigation} currentKey={area.key} compact />
        <View style={styles.card}>
          <Text style={styles.eyebrow}>Internal OS Area</Text>
          <Text style={styles.title}>{area.label}</Text>
          <Text style={styles.description}>{area.description}</Text>
          <View style={styles.statusBox}>
            <Text style={styles.statusLabel}>Mobile availability</Text>
            <Text style={styles.statusText}>{area.nativeStatus}</Text>
          </View>
          <Pressable style={styles.primaryAction} onPress={() => Linking.openURL(webUrl)}>
            <Text style={styles.primaryText}>Open full {area.shortLabel} module</Text>
          </Pressable>
          <Text style={styles.note}>This keeps the mobile app shell complete while deeper native screens are added area-by-area without reducing web capability.</Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  card: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 18, padding: spacing.lg },
  eyebrow: { color: colors.textMuted, textTransform: 'uppercase', fontSize: 11, fontWeight: '800', letterSpacing: 0.8, marginBottom: 8 },
  title: { color: colors.text, fontSize: 22, fontWeight: '900', marginBottom: spacing.sm },
  description: { color: '#cbd5e1', lineHeight: 21, marginBottom: spacing.md },
  statusBox: { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: spacing.md, marginBottom: spacing.md },
  statusLabel: { color: colors.textMuted, fontSize: 12, fontWeight: '800', marginBottom: 4 },
  statusText: { color: colors.text, fontWeight: '700' },
  primaryAction: { backgroundColor: colors.primary, borderRadius: 12, padding: spacing.md, alignItems: 'center', marginBottom: spacing.sm },
  primaryText: { color: '#fff', fontWeight: '900' },
  note: { color: colors.textMuted, fontSize: 12, lineHeight: 17 }
});
