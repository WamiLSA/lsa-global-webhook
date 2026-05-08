import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../context/AuthContext';
import { PRODUCT_AREAS } from '../navigation/productAreas';
import { colors } from '../theme';

export function MenuScreen({ navigation }) {
  const { logout, user } = useAuth();

  const openArea = (area) => {
    navigation.goBack();
    setTimeout(() => navigation.navigate(area.route), 0);
  };

  return (
    <View style={styles.overlay}>
      <View style={styles.drawer}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>Mobile navigation</Text>
            <Text style={styles.title}>LSA Internal OS</Text>
            {user?.username ? <Text style={styles.user}>Signed in as {user.username}</Text> : null}
          </View>
          <Pressable style={styles.close} onPress={() => navigation.goBack()}><Text style={styles.closeText}>×</Text></Pressable>
        </View>
        <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.list}>
          <Pressable style={styles.item} onPress={() => openArea({ route: 'Home' })}>
            <Text style={styles.itemTitle}>Home / App Shell</Text>
            <Text style={styles.itemMeta}>System-wide mobile launch screen</Text>
          </Pressable>
          {PRODUCT_AREAS.map((area) => (
            <Pressable key={area.key} style={styles.item} onPress={() => openArea(area)}>
              <Text style={styles.itemTitle}>{area.title}</Text>
              <Text style={styles.itemMeta}>{area.status}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <Pressable style={styles.logout} onPress={logout}>
          <Text style={styles.logoutText}>Secure Logout</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(2, 6, 23, 0.55)', alignItems: 'flex-start' },
  drawer: { width: '86%', maxWidth: 360, flex: 1, backgroundColor: colors.bg, borderRightColor: colors.border, borderRightWidth: 1, paddingTop: 8 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 16, borderBottomColor: colors.border, borderBottomWidth: 1 },
  eyebrow: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  title: { color: colors.text, fontSize: 20, fontWeight: '800', marginTop: 2 },
  user: { color: '#cbd5e1', marginTop: 4 },
  close: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  closeText: { color: colors.text, fontSize: 24, lineHeight: 24 },
  list: { padding: 12, paddingBottom: 24 },
  item: { backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 9 },
  itemTitle: { color: colors.text, fontWeight: '800', fontSize: 15 },
  itemMeta: { color: colors.textMuted, marginTop: 4, fontSize: 12 },
  logout: { margin: 12, backgroundColor: colors.danger, borderRadius: 12, padding: 14, alignItems: 'center' },
  logoutText: { color: '#fff', fontWeight: '800' }
});
