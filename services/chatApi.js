import { auth } from '../firebase';
import { getApiUrl } from './apiClient';

async function chatRequest(path, { method = 'GET', body } = {}) {
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

export const sendMessage = async ({ conversationId, clientMutationId, body, orderId }) => (
  await chatRequest('/api/chat/messages', {
    method: 'POST',
    body: { conversationId, clientMutationId, body, ...(orderId ? { orderId } : {}) },
  })
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
