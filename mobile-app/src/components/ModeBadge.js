import React from 'react';
import { Text, View, StyleSheet } from 'react-native';
import { colors } from '../theme';

export function ModeBadge({ mode }) {
  const isLive = mode === 'LIVE';
  return (
    <View style={[styles.badge, isLive ? styles.live : styles.test]}>
      <Text style={styles.label}>{isLive ? 'LIVE MODE · Production Safe' : 'TEST MODE · Supervised'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, alignSelf: 'flex-start' },
  live: { backgroundColor: colors.live },
  test: { backgroundColor: colors.test },
  label: { color: '#fff', fontWeight: '700', fontSize: 12 }
});
