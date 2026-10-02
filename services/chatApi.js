import { auth } from '../firebase';
import { getApiUrl } from './apiClient';
import { ensureAuthStateReady } from './authSession';

async function chatRequest(path, { method = 'GET', body } = {}) {
  await ensureAuthStateReady();
  const token = await auth.currentUser?.getIdToken();
  if (!token) {
    const error = new Error('Sign in again to use BlueTap messages.');
    error.code = 'CHAT_NOT_AUTHENTICATED';
    throw error;
  }

  const response = await fetch(getApiUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error?.message || 'BlueTap messages are temporarily unavailable.');
    error.code = result?.error?.reason || 'CHAT_SERVICE_UNAVAILABLE';
    error.status = response.status;
    error.retryAfterSeconds = result?.error?.retryAfterSeconds || null;
    throw error;
  }
  return result || {};
}

export const resolveConversation = async (intent) => (
  await chatRequest('/api/chat/conversations', { method: 'POST', body: intent })
).conversation;

export const loadConversationSummaries = async () => (
  await chatRequest('/api/chat/conversations')
).conversations || [];

export const sendMessage = async ({ conversationId, clientMutationId, body, orderId }) => (
  await chatRequest('/api/chat/messages', {
    method: 'POST',
    body: { conversationId, clientMutationId, body, ...(orderId ? { orderId } : {}) },
  })
).message;

export const editMessage = async ({ conversationId, messageId, clientMutationId, body }) => (
  await chatRequest('/api/chat/messages', { method: 'PATCH', body: { conversationId, messageId, clientMutationId, body } })
).message;

export const deleteMessage = async ({ conversationId, messageId, clientMutationId }) => (
  await chatRequest('/api/chat/messages', { method: 'DELETE', body: { conversationId, messageId, clientMutationId } })
).message;

export const markRead = async ({ conversationId, lastReadSeq }) => (
  await chatRequest('/api/chat/read-state', {
    method: 'POST',
    body: { conversationId, lastReadSeq },
  })
).conversation;

export async function loadMessageHistory({ conversationId, beforeSeq, limit = 40 }) {
  const params = new URLSearchParams({ conversationId, limit: String(limit) });
  if (beforeSeq) params.set('beforeSeq', String(beforeSeq));
  return chatRequest(`/api/chat/messages?${params.toString()}`);
}
