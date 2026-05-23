const fs = require('fs');
const assert = require('assert');

const web = fs.readFileSync('public/index.html', 'utf8');
const mobile = fs.readFileSync('mobile-app/src/screens/ConversationScreen.js', 'utf8');

const requiredFunctions = ['function loadThreads()', 'function loadConversation(', 'async function sendReply()'];
requiredFunctions.forEach((fn) => assert(web.includes(fn), `${fn} missing`));

assert(!/\blet\s+messageReplyContext\s*=\s*null;[\s\S]*\blet\s+messageReplyContext\s*=\s*null;/.test(web), 'duplicate messageReplyContext declaration detected');
const sendReplyBlock = web.split('async function sendReply()')[1] || '';
assert(sendReplyBlock.includes('const optimisticId ='), 'sendReply missing scoped optimisticId declaration');
const optimisticRefs = (sendReplyBlock.match(/optimisticId/g) || []).length;
assert(optimisticRefs >= 3, 'optimisticId not used in sendReply flow');

assert(web.includes('messageReplyContext.threadId === threadIdAtSend'), 'sendReply does not validate reply context thread ownership');
assert(web.includes('const contextAtSend ='), 'sendReply missing contextAtSend declaration');

assert(/overflow-wrap:\s*anywhere/.test(web), 'message overflow wrapping not enforced');
assert(web.includes('formatBubbleTimestamp(') || web.includes('formatMessageTime('), 'human-readable timestamp formatter missing');
assert(!web.includes('2026-05-23T09:53:53.962426+00:00'), 'raw ISO timestamp sample appears in UI rendering path');

assert(web.includes('function renderAttachmentCard'), 'attachment card renderer missing');
assert(web.includes('attachment-grid'), 'attachment grid css missing');
assert(web.includes('renderAttachment(msg)'), 'attachment rendering helper missing');
assert(web.includes('attachment-media') && web.includes('msg.media_url'), 'attachment media rendering/fallback support missing');

assert(web.includes('catch (error)'), 'loadThreads network error fallback missing');
assert(web.includes('Thread loading problem'), 'loadThreads safe fallback UI missing');
assert(web.includes('function resolveThreadId('), 'resolveThreadId helper missing');
assert(web.includes('div.dataset.threadId = threadId'), 'thread cards missing stable data-thread-id assignment');
assert(web.includes('event.stopPropagation();'), 'thread action buttons are not isolating click propagation');
assert(web.includes('div.onclick = async () => {'), 'thread click handler missing');
assert(web.includes('await loadConversation(threadId'), 'thread click handler does not call loadConversation');
assert(web.includes('if (!threadId) {') && web.includes('Unable to open this conversation because its identifier is missing.'), 'thread click missing safe fallback for absent threadId');
assert(web.includes('if (wa_id === undefined || wa_id === null || String(wa_id).trim() === "")'), 'loadConversation missing missing-id guard');
assert(web.includes('div.classList.toggle("selected"'), 'selected-thread visual state toggle missing');
assert(web.includes('renderConversationError({'), 'selected conversation render/error path missing');
assert(web.includes('setThreadActionButtons();'), 'composer/thread actions not tied to selected-thread flow');
assert(web.includes('channelAtRequest === "mail"') && web.includes('channelAtRequest === "whatsapp"'), 'mobile/desktop/channel thread opening paths not covered');
assert(!web.includes('loadConversation(undefined'), 'thread-opening path may call loadConversation with undefined');

assert(mobile.includes('attachmentCard'), 'mobile attachment card styles missing');
assert(mobile.includes('formatFileSize'), 'mobile attachment size formatter missing');
assert(mobile.includes('flexShrink: 1'), 'mobile long message wrapping guard missing');

console.log('validate-inbox-ui: PASS');

assert(web.includes('renderConversationLoading('), 'conversation loading state renderer missing');
assert(web.includes('renderConversationError({'), 'conversation error card renderer missing');
assert(web.includes('normalizeConversationMessages('), 'message payload normalization helper missing');
assert(web.includes('payload.thread?.messages') && web.includes('payload.conversation?.messages') && web.includes('payload.records'), 'message fallback key parsing is incomplete');
assert(web.includes('renderConversationLoading(displayName, threadId);'), 'thread click does not render loading state before fetch');
assert(web.includes('currentWaId = canonicalThreadId'), 'selected thread ID is not canonicalized before binding state');
assert(web.includes('clearReplyContext();'), 'thread switching does not clear reply context');
assert(web.includes('retryConversationLoadBtn'), 'retry button missing from conversation error state');
assert(web.includes("AbortController"), 'conversation fetch timeout controller missing');
assert(web.includes("conversationLoadTimeoutMs"), 'conversation loading timeout fallback missing');
assert(web.includes("Conversation could not be loaded"), 'conversation error card title missing');
assert(web.includes("Retry loading conversation"), 'retry loading conversation button missing');
assert(web.includes("No messages found for this conversation yet."), 'empty conversation renderer missing');
assert(web.includes("payload.messages") && web.includes("payload.items") && web.includes("payload.records") && web.includes("payload.data?.messages") && web.includes("payload.thread?.messages") && web.includes("payload.conversation?.messages"), 'message normalization keys incomplete');
assert(web.includes("if (requestSeq !== conversationRequestSeq || currentWaId !== canonicalThreadId || currentChannel !== channelAtRequest) {") && web.includes("loadStateResolved = true;"), 'stale request handling does not safely resolve loading state');
assert(web.includes("staleRequestDetected"), 'stale request tracking flag missing for conversation loading');
assert(web.includes("render exception:"), 'render exceptions are not surfaced to error renderer');
assert(web.includes('inboxDebug('), 'debug diagnostics hook missing for selection/render pipeline');
assert(!web.includes('console.log("[inbox-frontend] thread messages fetched"'), 'production console logging for conversation fetch should stay behind debug hook');
