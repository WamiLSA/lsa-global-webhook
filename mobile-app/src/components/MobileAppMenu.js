import React from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { colors, spacing } from '../theme';
import { mobileAreas } from '../navigation/mobileAreas';
import { useAuth } from '../context/AuthContext';

export function MobileAppMenu({ navigation, currentKey, compact = false, mode }) {
  const { logout } = useAuth();

  const openArea = (area) => {
    if (area.route === 'FeatureArea') {
      navigation.navigate('FeatureArea', { areaKey: area.key });
      return;
    }
    navigation.navigate(area.route);
  };

  const primaryArea = mobileAreas.find((area) => area.key === 'inbox');
  const secondaryAreas = mobileAreas.filter((area) => area.key !== 'inbox');

  if (compact) {
    return (
      <View style={styles.compactWrap}>
        <Text style={styles.compactTitle}>Inbox first</Text>
        {mode ? <Text style={styles.modeText}>{String(mode).toUpperCase()} MODE</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.menuHeader}>
        <View>
          <Text style={styles.menuTitle}>Menu</Text>
          <Text style={styles.menuSubtitle}>Inbox stays as the main mobile workspace.</Text>
        </View>
        {mode ? <Text style={styles.modeText}>{String(mode).toUpperCase()} MODE</Text> : null}
      </View>

      {primaryArea ? (
        <Pressable
          style={[styles.primaryItem, currentKey === primaryArea.key && styles.itemActive]}
          onPress={() => openArea(primaryArea)}
        >
          <Text style={styles.primaryLabel}>{primaryArea.shortLabel}</Text>
          <Text style={styles.primaryDescription} numberOfLines={2}>{primaryArea.description}</Text>
        </Pressable>
      ) : null}

      <Text style={styles.sectionLabel}>Secondary modules</Text>
      <ScrollView style={styles.secondaryList} contentContainerStyle={styles.secondaryListContent}>
        {secondaryAreas.map((area) => {
          const active = area.key === currentKey;
          return (
            <Pressable key={area.key} style={[styles.item, active && styles.itemActive]} onPress={() => openArea(area)}>
              <View style={styles.itemTextWrap}>
                <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>{area.shortLabel}</Text>
                <Text style={styles.itemDescription} numberOfLines={2}>{area.description}</Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <Pressable style={styles.logout} onPress={logout}>
        <Text style={styles.logoutText}>Logout</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: spacing.md },
  compactWrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 6, marginBottom: spacing.sm },
  compactTitle: { color: colors.textMuted, fontWeight: '800', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4 },
  menuHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.md },
  menuTitle: { color: colors.text, fontWeight: '900', fontSize: 24 },
  menuSubtitle: { color: colors.textMuted, marginTop: 4, maxWidth: 230 },
  modeText: { color: colors.textMuted, fontWeight: '800', fontSize: 11, borderColor: colors.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 4, overflow: 'hidden' },
  primaryItem: { backgroundColor: '#172554', borderColor: colors.primary, borderWidth: 1, borderRadius: 18, padding: spacing.md, marginBottom: spacing.md },
  primaryLabel: { color: '#dbeafe', fontWeight: '900', fontSize: 18, marginBottom: 6 },
  primaryDescription: { color: '#bfdbfe', lineHeight: 19 },
  sectionLabel: { color: colors.textMuted, fontWeight: '900', fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: spacing.sm },
  secondaryList: { flex: 1 },
  secondaryListContent: { gap: spacing.sm, paddingBottom: spacing.md },
  item: { minHeight: 72, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: spacing.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  itemActive: { borderColor: colors.primary, backgroundColor: '#172554' },
  itemTextWrap: { flex: 1 },
  itemLabel: { color: colors.text, fontWeight: '900', marginBottom: 4 },
  itemLabelActive: { color: '#dbeafe' },
  itemDescription: { color: colors.textMuted, fontSize: 12, lineHeight: 16 },
  chevron: { color: colors.textMuted, fontSize: 24, fontWeight: '300' },
  logout: { marginTop: spacing.sm, backgroundColor: colors.danger, borderRadius: 12, padding: spacing.sm, alignItems: 'center' },
  logoutText: { color: '#fff', fontWeight: '900' }
});
