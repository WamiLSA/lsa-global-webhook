import React, { useEffect, useState } from 'react';
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, Linking, ActivityIndicator, KeyboardAvoidingView, Platform, Image, Alert } from 'react-native';
import { api } from '../api/client';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { ModeBadge } from '../components/ModeBadge';
import { Screen } from '../components/Screen';
import { colors, spacing } from '../theme';
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

function extensionFromMimeType(mimeType = '') {
  const normalized = String(mimeType).toLowerCase();
  if (normalized.includes('png')) return 'png';
  if (normalized.includes('webp')) return 'webp';
  if (normalized.includes('pdf')) return 'pdf';
  if (normalized.includes('jpeg') || normalized.includes('jpg')) return 'jpg';
  return 'jpg';
}

function createAttachmentFromAsset(asset, source) {
  if (!asset?.uri) return null;
  const mimeType = asset.mimeType || asset.type || 'image/jpeg';
  const name = asset.name || asset.fileName || `${source}-${Date.now()}.${extensionFromMimeType(mimeType)}`;
  return { uri: asset.uri, name, type: mimeType, source };
}

export function ConversationScreen({ route }) {
  const { runWithProgress } = useGlobalProgress();
  const { conversationId, mode, contact } = route.params || {};
  const [messages, setMessages] = useState([]);
  const [reply, setReply] = useState('');
  const [pendingAttachment, setPendingAttachment] = useState(null);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadThread = async () => {
    const response = await api.get(`/api/mobile/inbox/${conversationId}`, { retries: 2 });
    setMessages(Array.isArray(response.messages) ? response.messages : []);
  };

  useEffect(() => { (async () => { try { await loadThread(); } finally { setLoading(false); } })(); }, [conversationId]);

  const sendAttachment = async () => {
    const formData = new FormData();
    formData.append('wa_id', conversationId);
    formData.append('caption', reply.trim());
    formData.append('attachment', {
      uri: pendingAttachment.uri,
      name: pendingAttachment.name,
      type: pendingAttachment.type
    });
    await api.postForm('/api/send-attachment', formData);
  };

  const sendReply = async () => {
    try {
      setSending(true);
      setError('');
      await runWithProgress(pendingAttachment ? 'Send attachment' : 'Send reply', async (progress) => {
        progress.update(30, pendingAttachment ? 'Sending attachment...' : 'Sending message...');
        if (pendingAttachment) {
          await sendAttachment();
        } else {
          await api.post(`/api/mobile/inbox/${conversationId}/reply`, { text: reply });
        }
        progress.update(78, 'Reloading conversation...');
      });
      setReply('');
      setPendingAttachment(null);
      await loadThread();
    } catch {
      setError('Message failed to send. Please retry.');
    } finally { setSending(false); }
  };

  const attachDocument = async () => {
    try {
      await runWithProgress('Select attachment', async (progress) => {
        progress.update(30, 'Opening document picker...');
        const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
        if (!result.canceled && result.assets?.[0]) {
          setPendingAttachment(createAttachmentFromAsset(result.assets[0], 'document'));
        }
        progress.update(82, 'Attachment ready...');
      });
    } catch {
      setError('Attachment selection failed. Please retry.');
    }
  };

  const attachCameraPhoto = async () => {
    try {
      setError('');
      await runWithProgress('Capture photo', async (progress) => {
        progress.update(18, 'Checking camera access...');
        const canUseCamera = await ImagePicker.getCameraPermissionsAsync();
        const permission = canUseCamera.granted ? canUseCamera : await ImagePicker.requestCameraPermissionsAsync();
        let result = null;

        if (permission.granted) {
          progress.update(35, 'Opening camera...');
          result = await ImagePicker.launchCameraAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: false,
            quality: 0.82
          });
        } else {
          progress.update(35, 'Camera unavailable. Opening image library...');
          const libraryPermission = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!libraryPermission.granted) {
            Alert.alert('Camera unavailable', 'Camera access was not granted. Please enable camera access or select an existing image later.');
            return;
          }
          result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: false,
            quality: 0.82
          });
        }

        if (!result?.canceled && result?.assets?.[0]) {
          setPendingAttachment(createAttachmentFromAsset(result.assets[0], 'camera-photo'));
          progress.update(84, 'Photo attached to composer...');
        }
      });
    } catch {
      setError('Camera action failed. If this device has no camera, attach an existing image instead.');
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView style={styles.keyboardShell} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={82}>
        <View style={styles.threadHeader}>
          <View style={styles.contactAvatar}><Text style={styles.contactAvatarText}>{String(contact || '?').trim().slice(0, 1).toUpperCase()}</Text></View>
          <View style={styles.threadTitleWrap}>
            <Text style={styles.header} numberOfLines={1}>{contact || 'Conversation'}</Text>
            <Text style={styles.subHeader}>Mobile inbox thread</Text>
          </View>
          <ModeBadge mode={mode} />
        </View>

        {loading ? <ActivityIndicator color={colors.primary} style={{ marginTop: 20 }} /> : (
          <FlatList
            data={messages}
            keyExtractor={(item) => String(item.id)}
            style={styles.messagesList}
            contentContainerStyle={styles.messagesContent}
            showsVerticalScrollIndicator={false}
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
          {pendingAttachment ? (
            <View style={styles.pendingAttachment}>
              {String(pendingAttachment.type).startsWith('image/') ? <Image source={{ uri: pendingAttachment.uri }} style={styles.pendingImage} /> : null}
              <View style={styles.pendingTextWrap}>
                <Text style={styles.pendingTitle} numberOfLines={1}>{pendingAttachment.name}</Text>
                <Text style={styles.pendingSubtitle}>{pendingAttachment.source === 'camera-photo' ? 'Live photo ready to send' : 'Attachment ready to send'}</Text>
              </View>
              <Pressable style={styles.removeAttachment} onPress={() => setPendingAttachment(null)}><Text style={styles.removeAttachmentText}>×</Text></Pressable>
            </View>
          ) : null}
          <View style={styles.inputRow}>
            <Pressable style={styles.iconAction} onPress={attachCameraPhoto} accessibilityRole="button" accessibilityLabel="Open camera and attach photo"><Text style={styles.iconText}>📷</Text></Pressable>
            <TextInput style={styles.input} value={reply} onChangeText={setReply} placeholder={pendingAttachment ? 'Add caption' : 'Type quick reply'} placeholderTextColor={colors.textMuted} multiline />
            <Pressable style={styles.iconAction} onPress={attachDocument} accessibilityRole="button" accessibilityLabel="Attach document"><Text style={styles.iconText}>＋</Text></Pressable>
            <Pressable style={[styles.send, (sending || (!reply.trim() && !pendingAttachment)) && styles.sendDisabled]} disabled={sending || (!reply.trim() && !pendingAttachment)} onPress={sendReply}><Text style={styles.sendText}>{sending ? '…' : 'Send'}</Text></Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  keyboardShell: { flex: 1 },
  threadHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  contactAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#1d4ed8', alignItems: 'center', justifyContent: 'center' },
  contactAvatarText: { color: '#fff', fontWeight: '900', fontSize: 16 },
  threadTitleWrap: { flex: 1 },
  header: { color: colors.text, fontWeight: '900', fontSize: 18 },
  subHeader: { color: colors.textMuted, marginTop: 2, fontSize: 12, fontWeight: '700' },
  messagesList: { flex: 1 },
  messagesContent: { paddingTop: spacing.xs, paddingBottom: spacing.sm },
  msg: { borderRadius: 18, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: colors.border, maxWidth: '88%' },
  incoming: { backgroundColor: '#1e293b', alignSelf: 'flex-start', borderTopLeftRadius: 6 },
  outgoing: { backgroundColor: '#1d4ed8', alignSelf: 'flex-end', borderTopRightRadius: 6 },
  sender: { color: '#bfdbfe', fontSize: 10, fontWeight: '900', marginBottom: 5, textTransform: 'uppercase' },
  original: { color: '#fff', lineHeight: 20 },
  missing: { color: '#fecaca', fontStyle: 'italic' },
  translation: { color: '#cbd5e1', marginTop: 4, fontSize: 12, lineHeight: 17 },
  attachment: { color: '#facc15', marginTop: 6, fontWeight: '800' },
  ts: { color: '#94a3b8', fontSize: 10, marginTop: 6 },
  composer: { borderTopColor: colors.border, borderTopWidth: 1, paddingTop: spacing.sm, backgroundColor: colors.bg },
  pendingAttachment: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderColor: colors.border, borderWidth: 1, borderRadius: 14, padding: spacing.sm, marginBottom: spacing.sm },
  pendingImage: { width: 44, height: 44, borderRadius: 10, backgroundColor: colors.surfaceAlt },
  pendingTextWrap: { flex: 1 },
  pendingTitle: { color: colors.text, fontWeight: '900' },
  pendingSubtitle: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  removeAttachment: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#334155', alignItems: 'center', justifyContent: 'center' },
  removeAttachmentText: { color: '#fff', fontWeight: '900', fontSize: 18, lineHeight: 20 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, backgroundColor: colors.surfaceAlt, borderColor: colors.border, borderWidth: 1, color: colors.text, borderRadius: 18, paddingHorizontal: 12, paddingVertical: 10, minHeight: 42, maxHeight: 120 },
  iconAction: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#334155', alignItems: 'center', justifyContent: 'center' },
  iconText: { color: '#fff', fontWeight: '900', fontSize: 18 },
  send: { minWidth: 58, height: 42, borderRadius: 21, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  sendDisabled: { opacity: 0.45 },
  sendText: { color: '#fff', fontWeight: '900' },
  error: { color: '#fca5a5', marginBottom: 6 }
});
