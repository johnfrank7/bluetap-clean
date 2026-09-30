// Private invalidation signals contain no conversation or message content.
// They are written in the same transaction as the change they announce.
const { randomUUID } = require('node:crypto');
function publishChatActivity(tx, db, conversation, now) {
  const revision = randomUUID();
  for (const uid of conversation.participantUserUids || []) {
    tx.set(db.collection('chatUserActivity').doc(uid), { updatedAt: now, revision });
  }
  for (const branchId of conversation.participantBranchIds || []) {
    tx.set(db.collection('chatBranchActivity').doc(branchId), { updatedAt: now, revision });
  }
}
module.exports = { publishChatActivity };
