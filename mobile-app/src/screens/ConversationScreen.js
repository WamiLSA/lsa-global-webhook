import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, Linking, ActivityIndicator } from 'react-native';
import { api } from '../api/client';
import * as DocumentPicker from 'expo-document-picker';
import { ModeBadge } from '../components/ModeBadge';
import { Screen } from '../components/Screen';
import { colors } from '../theme';
import { useGlobalProgress } from '../progress/GlobalProgressContext';

export function ConversationScreen({ route }) {
  const { runWithProgress } = useGlobalProgress();
  const { conversationId, mode, contact } = route.params;
  const [messages, setMessages] = useState([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadThread = async () => {
    const response = await api.get(`/api/mobile/inbox/${conversationId}`, { retries: 2 });
    setMessages(response.messages || []);
  };

  useEffect(() => { (async () => { try { await loadThread(); } finally { setLoading(false); } })(); }, [conversationId]);

  const sendReply = async () => {
    try {
      setSending(true);
      setError('');
      await runWithProgress('Send reply', async (progress) => {
        progress.update(30, 'Sending message...');
        await api.post(`/api/mobile/inbox/${conversationId}/reply`, { text: reply });
        progress.update(78, 'Reloading conversation...');
      });
      setReply('');
      await loadThread();
    } catch {
      setError('Message failed to send. Please retry.');
    } finally { setSending(false); }
  };

  return (
    <Screen>
      <ModeBadge mode={mode} />
      <Text style={styles.header}>{contact || 'Conversation'}</Text>
      {loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} /> : (
        <FlatList
          data={messages}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => (
            <View style={[styles.msg, item.direction === 'outgoing' ? styles.outgoing : styles.incoming]}>
              <Text style={styles.original}>{item.originalText || '—'}</Text>
              {item.staffTranslation ? <Text style={styles.translation}>Staff Translation: {item.staffTranslation}</Text> : null}
              {item.customerTranslation ? <Text style={styles.translation}>Client Translation: {item.customerTranslation}</Text> : null}
              {item.attachmentUrl ? <Pressable onPress={() => Linking.openURL(item.attachmentUrl)}><Text style={styles.attachment}>Attachment: Open file</Text></Pressable> : null}
              <Text style={styles.ts}>{item.createdAt}</Text>
            </View>
          )}
        />
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.composer}>
        <TextInput style={styles.input} value={reply} onChangeText={setReply} placeholder="Type quick reply" placeholderTextColor={colors.textMuted} multiline />
        <View style={styles.rowActions}>
          <Pressable
            style={[styles.action, styles.attach]}
            onPress={async () => {
              await runWithProgress('Select attachment', async (progress) => {
                progress.update(30, 'Opening document picker...');
                await DocumentPicker.getDocumentAsync();
                progress.update(82, 'Attachment selection completed...');
              });
            }}
          >
            <Text style={styles.btn}>Attach</Text>
          </Pressable>
          <Pressable style={[styles.action, styles.send]} disabled={sending || !reply.trim()} onPress={sendReply}><Text style={styles.btn}>{sending ? 'Sending...' : 'Send Reply'}</Text></Pressable>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { color: colors.text, fontWeight: '700', fontSize: 16, marginTop: 8, marginBottom: 8 },
  msg: { borderRadius: 12, padding: 10, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  incoming: { backgroundColor: '#1e293b' },
  outgoing: { backgroundColor: '#1d4ed8' },
  original: { color: '#fff' },
  translation: { color: '#cbd5e1', marginTop: 4, fontSize: 12 },
  attachment: { color: '#facc15', marginTop: 6 },
  ts: { color: '#94a3b8', fontSize: 11, marginTop: 6 },
  composer: { gap: 8, marginTop: 8 },
  input: { backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderWidth: 1, color: colors.text, borderRadius: 10, padding: 10, minHeight: 42 },
  rowActions: { flexDirection: 'row', gap: 8 },
  action: { flex: 1, padding: 10, borderRadius: 10, alignItems: 'center' },
  send: { backgroundColor: colors.success },
  attach: { backgroundColor: '#334155' },
  btn: { color: '#fff', fontWeight: '700' },
  error: { color: '#fca5a5', marginBottom: 6 }
});
