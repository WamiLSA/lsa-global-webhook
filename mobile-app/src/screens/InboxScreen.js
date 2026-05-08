import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, TextInput, RefreshControl, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { api } from '../api/client';
import { ModeBadge } from '../components/ModeBadge';
import { MobileAppMenu } from '../components/MobileAppMenu';
import { Screen } from '../components/Screen';
import { colors } from '../theme';
import { useGlobalProgress } from '../progress/GlobalProgressContext';

export function InboxScreen({ navigation }) {
  const { runWithProgress } = useGlobalProgress();
  const [mode, setMode] = useState('TEST');
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [branding, setBranding] = useState({});

  const fetchInbox = useCallback(async () => {
    const response = await api.get('/api/mobile/inbox', { retries: 2 });
    setItems(response.conversations || []);
    setMode(response.runtimeMode || 'TEST');
  }, []);

  useEffect(() => { (async () => { try { await fetchInbox(); const b=await api.get('/api/branding/settings'); setBranding(b.branding||{});} finally { setLoading(false); } })(); }, [fetchInbox]);

  const filtered = useMemo(() => items.filter((item) => {
    const q = search.toLowerCase();
    return item.contact?.toLowerCase().includes(q) || item.lastMessage?.toLowerCase().includes(q);
  }), [items, search]);

  return (
    <Screen>
      <MobileAppMenu navigation={navigation} currentKey="inbox" compact mode={mode} />
      <View style={styles.brandRow}>{branding.logo_url ? <Image source={{ uri: api.resolveAssetUrl(branding.logo_url) }} style={styles.brandLogo} /> : null}<Text style={styles.brandText}>{branding.brand_name || 'LSA GLOBAL'}</Text></View>
      <ModeBadge mode={mode} />
      <TextInput value={search} onChangeText={setSearch} style={styles.search} placeholder="Search contact or last message" placeholderTextColor={colors.textMuted} />
      {loading ? <ActivityIndicator color={colors.primary} size="large" style={styles.loader} /> : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                try {
                  await runWithProgress('Sync inbox', async (progress) => {
                    progress.update(24, 'Requesting latest conversations...');
                    await fetchInbox();
                    progress.update(82, 'Refreshing inbox list...');
                  });
                } finally {
                  setRefreshing(false);
                }
              }}
              tintColor={colors.text}
            />
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => navigation.navigate('Conversation', { conversationId: item.id, mode, contact: item.contact })}>
              <View style={styles.rowTop}><Text style={styles.contact}>{item.contact || 'Unknown contact'}</Text>{!!item.unreadCount && <Text style={styles.unread}>{item.unreadCount}</Text>}</View>
              <Text style={styles.preview} numberOfLines={2}>{item.lastMessage || 'No messages yet'}</Text>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No matching conversations.</Text>}
        />
      )}
      <Pressable style={styles.settings} onPress={() => navigation.navigate('Home')}><Text style={styles.settingsText}>Open Full Internal OS Menu</Text></Pressable>
    </Screen>
  );
}

const styles = StyleSheet.create({
  search: { backgroundColor: colors.surfaceAlt, color: colors.text, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: colors.border, marginTop: 10, marginBottom: 10 },
  row: { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  contact: { color: colors.text, fontWeight: '700', marginBottom: 3 },
  preview: { color: '#cbd5e1' },
  unread: { color: '#f8fafc', backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, fontWeight: '700', overflow: 'hidden' },
  settings: { alignItems: 'center', padding: 12, backgroundColor: colors.primary, borderRadius: 10, marginTop: 8 },
  settingsText: { color: '#fff', fontWeight: '700' },
  loader: { marginTop: 24 },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 24 }
  ,brandRow: { flexDirection:'row', alignItems:'center', gap:10, marginBottom: 8 },
  brandLogo: { width: 28, height: 28, borderRadius: 6 },
  brandText: { color: colors.text, fontWeight: '700' }
});
