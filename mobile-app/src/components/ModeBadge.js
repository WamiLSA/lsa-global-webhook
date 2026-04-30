import React from 'react';
import { Text, View, StyleSheet } from 'react-native';

export function ModeBadge({ mode }) {
  const isLive = mode === 'LIVE';

  return (
    <View style={[styles.badge, isLive ? styles.live : styles.test]}>
      <Text style={styles.label}>{isLive ? 'LIVE MODE' : 'TEST MODE'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, alignSelf: 'flex-start' },
  live: { backgroundColor: '#14532d' },
  test: { backgroundColor: '#7f1d1d' },
  label: { color: '#fff', fontWeight: '700', fontSize: 12 }
});
