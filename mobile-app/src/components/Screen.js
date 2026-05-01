import React from 'react';
import { View, StyleSheet } from 'react-native';
import { colors, spacing } from '../theme';

export function Screen({ children, padded = true }) {
  return <View style={[styles.base, padded && styles.padded]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: { flex: 1, backgroundColor: colors.bg },
  padded: { padding: spacing.md }
});
