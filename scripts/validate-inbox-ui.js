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

assert(mobile.includes('attachmentCard'), 'mobile attachment card styles missing');
assert(mobile.includes('formatFileSize'), 'mobile attachment size formatter missing');
assert(mobile.includes('flexShrink: 1'), 'mobile long message wrapping guard missing');

console.log('validate-inbox-ui: PASS');
