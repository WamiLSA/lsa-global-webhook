import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
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

  return (
    <View style={[styles.wrap, compact && styles.compactWrap]}>
      <View style={styles.menuHeader}>
        <Text style={styles.menuTitle}>☰ Internal OS Menu</Text>
        {mode ? <Text style={styles.modeText}>{String(mode).toUpperCase()} MODE</Text> : null}
      </View>
      <View style={styles.grid}>
        {mobileAreas.map((area) => {
          const active = area.key === currentKey;
          return (
            <Pressable key={area.key} style={[styles.item, active && styles.itemActive]} onPress={() => openArea(area)}>
              <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>{area.shortLabel}</Text>
              {!compact ? <Text style={styles.itemDescription} numberOfLines={2}>{area.description}</Text> : null}
            </Pressable>
          );
        })}
      </View>
      {!compact ? (
        <Pressable style={styles.logout} onPress={logout}>
          <Text style={styles.logoutText}>Logout</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: spacing.md, marginBottom: spacing.md },
  compactWrap: { padding: spacing.sm, borderRadius: 12 },
  menuHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm },
  menuTitle: { color: colors.text, fontWeight: '800', fontSize: 16 },
  modeText: { color: colors.textMuted, fontWeight: '700', fontSize: 11 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  item: { width: '48%', minHeight: 58, backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: spacing.sm },
  itemActive: { borderColor: colors.primary, backgroundColor: '#172554' },
  itemLabel: { color: colors.text, fontWeight: '800', marginBottom: 4 },
  itemLabelActive: { color: '#dbeafe' },
  itemDescription: { color: colors.textMuted, fontSize: 11, lineHeight: 15 },
  logout: { marginTop: spacing.md, backgroundColor: colors.danger, borderRadius: 10, padding: spacing.sm, alignItems: 'center' },
  logoutText: { color: '#fff', fontWeight: '800' }
});
