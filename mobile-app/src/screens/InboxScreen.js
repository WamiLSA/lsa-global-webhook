import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, Pressable, TextInput, RefreshControl, StyleSheet, ActivityIndicator, Image } from 'react-native';
import { api } from '../api/client';
import { ModeBadge } from '../components/ModeBadge';
import { Screen } from '../components/Screen';
import { colors, spacing } from '../theme';
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

  useEffect(() => { (async () => { try { await fetchInbox(); const b = await api.get('/api/branding/settings'); setBranding(b.branding || {}); } finally { setLoading(false); } })(); }, [fetchInbox]);

  const filtered = useMemo(() => items.filter((item) => {
    const q = search.toLowerCase();
    return item.contact?.toLowerCase().includes(q) || item.lastMessage?.toLowerCase().includes(q);
  }), [items, search]);

  return (
    <Screen>
      <View style={styles.shellHeader}>
        <View style={styles.brandRow}>
          {branding.logo_url ? <Image source={{ uri: api.resolveAssetUrl(branding.logo_url) }} style={styles.brandLogo} /> : null}
          <View style={styles.titleGroup}>
            <Text style={styles.screenTitle}>Inbox</Text>
            <Text style={styles.threadCount}>{filtered.length} thread{filtered.length === 1 ? '' : 's'} available</Text>
          </View>
        </View>
        <ModeBadge mode={mode} />
      </View>

      <TextInput value={search} onChangeText={setSearch} style={styles.search} placeholder="Search conversations" placeholderTextColor={colors.textMuted} />

      {loading ? <ActivityIndicator color={colors.primary} size="large" style={styles.loader} /> : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => String(item.id)}
          style={styles.list}
          contentContainerStyle={styles.listContent}
          showsVerticalScrollIndicator={false}
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
              <View style={styles.avatar}><Text style={styles.avatarText}>{String(item.contact || '?').trim().slice(0, 1).toUpperCase()}</Text></View>
              <View style={styles.rowBody}>
                <View style={styles.rowTop}><Text style={styles.contact} numberOfLines={1}>{item.contact || 'Unknown contact'}</Text>{!!item.unreadCount && <Text style={styles.unread}>{item.unreadCount}</Text>}</View>
                <Text style={styles.preview} numberOfLines={2}>{item.lastMessage || 'No messages yet'}</Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={styles.empty}>No matching conversations.</Text>}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  shellHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm },
  brandRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  brandLogo: { width: 30, height: 30, borderRadius: 8, backgroundColor: colors.surfaceAlt },
  titleGroup: { flex: 1 },
  screenTitle: { color: colors.text, fontWeight: '900', fontSize: 22 },
  threadCount: { color: colors.textMuted, marginTop: 2, fontWeight: '700', fontSize: 12 },
  search: { backgroundColor: colors.surfaceAlt, color: colors.text, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  list: { flex: 1 },
  listContent: { paddingBottom: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 16, padding: 12, marginBottom: 8 },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#1d4ed8', alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '900', fontSize: 17 },
  rowBody: { flex: 1 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: spacing.sm },
  contact: { flex: 1, color: colors.text, fontWeight: '900', marginBottom: 3 },
  preview: { color: '#cbd5e1', lineHeight: 19 },
  unread: { color: '#f8fafc', backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, fontWeight: '900', overflow: 'hidden', minWidth: 24, textAlign: 'center' },
  loader: { marginTop: 24 },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 24 }
});
