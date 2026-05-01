import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, TextInput, RefreshControl, StyleSheet, ActivityIndicator } from 'react-native';
import { api } from '../api/client';
import { ModeBadge } from '../components/ModeBadge';
import { Screen } from '../components/Screen';
import { colors } from '../theme';

export function InboxScreen({ navigation }) {
  const [mode, setMode] = useState('TEST');
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchInbox = useCallback(async () => {
    const response = await api.get('/api/mobile/inbox', { retries: 2 });
    setItems(response.conversations || []);
    setMode(response.runtimeMode || 'TEST');
  }, []);

  useEffect(() => { (async () => { try { await fetchInbox(); } finally { setLoading(false); } })(); }, [fetchInbox]);

  const filtered = useMemo(() => items.filter((item) => {
    const q = search.toLowerCase();
    return item.contact?.toLowerCase().includes(q) || item.lastMessage?.toLowerCase().includes(q);
  }), [items, search]);

  return (
    <Screen>
      <ModeBadge mode={mode} />
      <TextInput value={search} onChangeText={setSearch} style={styles.search} placeholder="Search contact or last message" placeholderTextColor={colors.textMuted} />
      {loading ? <ActivityIndicator color={colors.primary} size="large" style={styles.loader} /> : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await fetchInbox(); setRefreshing(false); }} tintColor={colors.text} />}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => navigation.navigate('Conversation', { conversationId: item.id, mode, contact: item.contact })}>
              <View style={styles.rowTop}><Text style={styles.contact}>{item.contact || 'Unknown contact'}</Text>{!!item.unreadCount && <Text style={styles.unread}>{item.unreadCount}</Text>}</View>
              <Text style={styles.preview} numberOfLines={2}>{item.lastMessage || 'No messages yet'}</Text>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No matching conversations.</Text>}
        />
      )}
      <Pressable style={styles.settings} onPress={() => navigation.navigate('Settings', { mode, conversationCount: items.length })}><Text style={styles.settingsText}>Open Settings</Text></Pressable>
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
});
