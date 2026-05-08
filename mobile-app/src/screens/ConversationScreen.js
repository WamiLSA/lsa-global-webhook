import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, Linking, ActivityIndicator } from 'react-native';
import { api } from '../api/client';
import * as DocumentPicker from 'expo-document-picker';
import { ModeBadge } from '../components/ModeBadge';
import { MobileAppMenu } from '../components/MobileAppMenu';
import { Screen } from '../components/Screen';
import { colors } from '../theme';
import { useGlobalProgress } from '../progress/GlobalProgressContext';

function normalizeTextValue(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (typeof value === 'object') {
    return firstTextValue(
      value.body,
      value.text,
      value.message,
      value.caption,
      value.content,
      value.value,
      value.text?.body,
      value.message?.body
    );
  }
  return '';
}

function firstTextValue(...values) {
  for (const value of values) {
    const text = normalizeTextValue(value);
    if (text) return text;
  }
  return '';
}

function getMessageDisplay(item = {}) {
  const direction = item.direction === 'out' || item.direction === 'outgoing' ? 'outgoing' : 'incoming';
  const originalText = firstTextValue(
    item.originalText,
    item.original_text,
    item.body,
    item.text,
    item.text_body,
    item.messageText,
    item.message_text,
    item.caption,
    item.preview,
    item.message,
    item.rawMessage,
    item.raw_message
  );
  const staffTranslation = firstTextValue(item.staffTranslation, item.staff_translation, item.translatedText, item.translated_text);
  const staffReply = firstTextValue(item.staffReplyText, item.staff_reply_text, item.staffReply, item.staff_reply, direction === 'outgoing' ? item.body : '');
  const customerTranslation = firstTextValue(item.customerTranslation, item.customer_translation, item.sentReplyText, item.sent_reply_text);
  const attachmentUrl = firstTextValue(item.attachmentUrl, item.attachment_url, item.mediaUrl, item.media_url);
  return { direction, originalText, staffTranslation, staffReply, customerTranslation, attachmentUrl };
}

export function ConversationScreen({ route, navigation }) {
  const { runWithProgress } = useGlobalProgress();
  const { conversationId, mode, contact } = route.params || {};
  const [messages, setMessages] = useState([]);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadThread = async () => {
    const response = await api.get(`/api/mobile/inbox/${conversationId}`, { retries: 2 });
    setMessages(Array.isArray(response.messages) ? response.messages : []);
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
      <MobileAppMenu navigation={navigation} currentKey="inbox" compact mode={mode} />
      <ModeBadge mode={mode} />
      <Text style={styles.header}>{contact || 'Conversation'}</Text>
      {loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} /> : (
        <FlatList
          data={messages}
          keyExtractor={(item) => String(item.id)}
          renderItem={({ item }) => {
            const display = getMessageDisplay(item);
            return (
              <View style={[styles.msg, display.direction === 'outgoing' ? styles.outgoing : styles.incoming]}>
                <Text style={styles.sender}>{display.direction === 'outgoing' ? 'LSA GLOBAL / Staff' : contact || 'Client'}</Text>
                {display.originalText ? <Text style={styles.original}>{display.originalText}</Text> : <Text style={styles.missing}>No text body was supplied for this message.</Text>}
                {display.staffReply && display.staffReply !== display.originalText ? <Text style={styles.translation}>Staff Reply: {display.staffReply}</Text> : null}
                {display.staffTranslation && display.staffTranslation !== display.originalText ? <Text style={styles.translation}>Staff Translation: {display.staffTranslation}</Text> : null}
                {display.customerTranslation && display.customerTranslation !== display.originalText ? <Text style={styles.translation}>Sent to Customer: {display.customerTranslation}</Text> : null}
                {display.attachmentUrl ? <Pressable onPress={() => Linking.openURL(api.resolveAssetUrl(display.attachmentUrl))}><Text style={styles.attachment}>Attachment: Open file</Text></Pressable> : null}
                <Text style={styles.ts}>{item.createdAt || item.timestamp || ''}</Text>
              </View>
            );
          }}
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
  msg: { borderRadius: 14, padding: 12, marginBottom: 10, borderWidth: 1, borderColor: colors.border, maxWidth: '92%' },
  incoming: { backgroundColor: '#1e293b', alignSelf: 'flex-start' },
  outgoing: { backgroundColor: '#1d4ed8', alignSelf: 'flex-end' },
  sender: { color: '#bfdbfe', fontSize: 11, fontWeight: '800', marginBottom: 5, textTransform: 'uppercase' },
  original: { color: '#fff', lineHeight: 20 },
  missing: { color: '#fecaca', fontStyle: 'italic' },
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
