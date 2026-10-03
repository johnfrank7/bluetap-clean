const clean = (value) => String(value || '').trim();

const ROLE_CONVERSATION_TYPES = Object.freeze({
  requester: new Set(['requester_branch', 'requester_distributor']),
  distributor: new Set(['distributor_branch', 'requester_distributor']),
  manager: new Set(['distributor_branch', 'requester_branch', 'branch_coordination']),
});

function initialsForName(value, fallback = 'BT') {
  const words = clean(value).split(/\s+/).filter(Boolean);
  if (!words.length) return clean(fallback).slice(0, 2).toUpperCase() || 'BT';
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase().slice(0, 2);
}

function conversationAllowedForRole(conversation, role) {
  return Boolean(conversation?.id && ROLE_CONVERSATION_TYPES[role]?.has(clean(conversation.type)));
}

function branchIdForConversation(conversation = {}) {
  return clean(conversation.branchId || conversation.branchIds?.[0] || conversation.participantBranchIds?.[0]);
}

function avatarForConversation(conversation = {}, role = '') {
  const station = (role === 'requester' && conversation.type === 'requester_branch')
    || (role === 'distributor' && conversation.type === 'distributor_branch')
    || conversation.type === 'branch_coordination';
  return station
    ? { avatarKind: 'station', avatarLabel: 'ST' }
    : { avatarKind: 'person', avatarLabel: initialsForName(conversation.displayName) };
}

function counterpartRoleLabel(conversation = {}, role = '') {
  if (role === 'requester' && conversation.type === 'requester_distributor') return 'Distributor';
  if (role === 'manager' && conversation.type === 'distributor_branch') return 'Distributor';
  const declaredRole = clean(conversation.counterpartRole).toLowerCase();
  if (declaredRole === 'manager' && conversation.type !== 'requester_branch') return 'Manager';
  if (declaredRole === 'distributor') return 'Distributor';
  return '';
}

function buildRequesterConversationGroups(conversations = [], branches = []) {
  const branchRows = [];
  const branchRowIndex = new Map();
  const distributorRows = [];

  conversations.forEach((conversation) => {
    if (conversation.type === 'requester_distributor') {
      distributorRows.push(conversation);
      return;
    }
    if (conversation.type !== 'requester_branch') return;
    const branchId = branchIdForConversation(conversation);
    const dedupeKey = branchId || `conversation:${conversation.id}`;
    if (branchRowIndex.has(dedupeKey)) return;
    branchRowIndex.set(dedupeKey, branchRows.length);
    branchRows.push(conversation);
  });

  branches.forEach((branch) => {
    const branchId = clean(branch?.id || branch?.branchId);
    if (!branchId) return;
    const existingIndex = branchRowIndex.get(branchId);
    if (existingIndex !== undefined) {
      const existing = branchRows[existingIndex];
      branchRows[existingIndex] = {
        ...existing,
        displayName: clean(branch.name) || existing.displayName,
        branchId,
      };
      return;
    }
    branchRowIndex.set(branchId, branchRows.length);
    branchRows.push({
      key: `pinned-station-${branchId}`,
      type: 'requester_branch',
      branchId,
      branchIds: [branchId],
      displayName: clean(branch.name) || 'BlueTap Station',
      contextLabel: 'General inquiry',
      emptyPreview: 'Message this station',
      unreadCount: 0,
      resolveIntent: { type: 'requester_branch', intent: 'inquiry', branchId },
    });
  });

  return { branchRows, distributorRows };
}

module.exports = {
  avatarForConversation,
  branchIdForConversation,
  buildRequesterConversationGroups,
  counterpartRoleLabel,
  conversationAllowedForRole,
  initialsForName,
};
