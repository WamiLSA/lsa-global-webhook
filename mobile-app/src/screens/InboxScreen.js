import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, Pressable, TextInput, RefreshControl, StyleSheet } from 'react-native';
import { api } from '../api/client';
import { ModeBadge } from '../components/ModeBadge';

export function InboxScreen({ navigation }) {
  const [mode, setMode] = useState('TEST');
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const fetchInbox = useCallback(async () => {
    const response = await api.get('/api/mobile/inbox');
    setItems(response.conversations || []);
    setMode(response.runtimeMode || 'TEST');
  }, []);

  useEffect(() => {
    fetchInbox();
  }, [fetchInbox]);

  const filtered = items.filter((item) => {
    const q = search.toLowerCase();
    return item.contact?.toLowerCase().includes(q) || item.lastMessage?.toLowerCase().includes(q);
  });

  return (
    <View style={styles.container}>
      <ModeBadge mode={mode} />
      <TextInput value={search} onChangeText={setSearch} style={styles.search} placeholder="Search conversations" />
      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await fetchInbox(); setRefreshing(false); }} />}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => navigation.navigate('Conversation', { conversationId: item.id, mode })}>
            <Text style={styles.contact}>{item.contact || 'Unknown contact'}</Text>
            <Text style={styles.preview}>{item.lastMessage || 'No messages yet'}</Text>
            {!!item.unreadCount && <Text style={styles.unread}>{item.unreadCount} unread</Text>}
          </Pressable>
        )}
      />
      <Pressable style={styles.settings} onPress={() => navigation.navigate('Settings')}><Text>Settings</Text></Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020617', padding: 12, gap: 10 },
  search: { backgroundColor: '#fff', borderRadius: 8, padding: 10 },
  row: { backgroundColor: '#111827', borderColor: '#1f2937', borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 8 },
  contact: { color: '#f8fafc', fontWeight: '700', marginBottom: 3 },
  preview: { color: '#cbd5e1' },
  unread: { color: '#facc15', marginTop: 4, fontWeight: '600' },
  settings: { alignItems: 'center', padding: 10, backgroundColor: '#e2e8f0', borderRadius: 8 }
});
