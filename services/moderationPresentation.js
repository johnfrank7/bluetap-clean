export function parseModerationTimestamp(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === 'function') {
    const converted = value.toDate();
    return converted instanceof Date && !Number.isNaN(converted.getTime()) ? converted : null;
  }
  const seconds = Number(value?.seconds ?? value?._seconds);
  const nanoseconds = Number(value?.nanoseconds ?? value?._nanoseconds ?? 0);
  if (Number.isFinite(seconds)) {
    const converted = new Date((seconds * 1000) + Math.floor((Number.isFinite(nanoseconds) ? nanoseconds : 0) / 1e6));
    return Number.isNaN(converted.getTime()) ? null : converted;
  }
  const converted = new Date(value);
  return Number.isNaN(converted.getTime()) ? null : converted;
}

export function formatModerationTimestamp(value) {
  return parseModerationTimestamp(value)?.toLocaleString() || 'Time unavailable';
}

export function moderationActionLabel(value) {
  return ({
    dismiss: 'Dismissed', warn: 'Warning issued', escalate: 'Escalated to Admin',
    suspend_branch_chat: 'Branch messaging restricted', suspend_branch_ordering: 'Branch ordering restricted',
    suspend_platform_chat: 'Platform messaging restricted', suspend_platform_ordering: 'Platform ordering restricted',
    suspend_account: 'Account suspended', terminate_account: 'Account terminated', reactivate: 'Account reactivated',
  })[value] || 'Moderation action';
}
