import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, Linking } from 'react-native';
import { api } from '../api/client';
import * as DocumentPicker from 'expo-document-picker';
import { ModeBadge } from '../components/ModeBadge';

export function ConversationScreen({ route }) {
  const { conversationId, mode } = route.params;
  const [messages, setMessages] = useState([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  const loadThread = async () => {
    const response = await api.get(`/api/mobile/inbox/${conversationId}`);
    setMessages(response.messages || []);
  };

  useEffect(() => {
    loadThread();
  }, [conversationId]);

  const sendReply = async () => {
    try {
      setSending(true);
      setError('');
      await api.post(`/api/mobile/inbox/${conversationId}/reply`, { text: reply });
      setReply('');
      await loadThread();
    } catch (err) {
      setError('Message failed to send. Please retry.');
    } finally {
      setSending(false);
    }
  };

  return (
    <View style={styles.container}>
      <ModeBadge mode={mode} />
      <FlatList
        data={messages}
        keyExtractor={(item) => String(item.id)}
        renderItem={({ item }) => (
          <View style={[styles.msg, item.direction === 'outgoing' ? styles.outgoing : styles.incoming]}>
            <Text style={styles.original}>{item.originalText}</Text>
            {item.staffTranslation ? <Text style={styles.translation}>Staff: {item.staffTranslation}</Text> : null}
            {item.customerTranslation ? <Text style={styles.translation}>Customer: {item.customerTranslation}</Text> : null}
            {item.attachmentUrl ? (
              <Pressable onPress={() => Linking.openURL(item.attachmentUrl)}><Text style={styles.attachment}>Open attachment</Text></Pressable>
            ) : null}
            <Text style={styles.ts}>{item.createdAt}</Text>
          </View>
        )}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.composer}>
        <TextInput style={styles.input} value={reply} onChangeText={setReply} placeholder="Type a quick reply" multiline />
        <Pressable style={styles.send} disabled={sending || !reply.trim()} onPress={sendReply}><Text style={styles.sendText}>{sending ? 'Sending...' : 'Send'}</Text></Pressable>
        <Pressable style={styles.attach} onPress={async () => { await DocumentPicker.getDocumentAsync(); }}><Text style={styles.attachText}>Attach</Text></Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#020617', padding: 12 },
  msg: { borderRadius: 10, padding: 10, marginBottom: 8 },
  incoming: { backgroundColor: '#1e293b' },
  outgoing: { backgroundColor: '#1d4ed8' },
  original: { color: '#fff' },
  translation: { color: '#cbd5e1', marginTop: 4, fontSize: 12 },
  attachment: { color: '#facc15', marginTop: 6 },
  ts: { color: '#94a3b8', fontSize: 11, marginTop: 6 },
  composer: { gap: 8 },
  input: { backgroundColor: '#fff', borderRadius: 8, padding: 10, minHeight: 42 },
  send: { backgroundColor: '#16a34a', padding: 10, borderRadius: 8, alignItems: 'center' },
  sendText: { color: '#fff', fontWeight: '700' },
  attach: { backgroundColor: '#334155', padding: 10, borderRadius: 8, alignItems: 'center' },
  attachText: { color: '#fff' },
  error: { color: '#fca5a5', marginBottom: 6 }
});
