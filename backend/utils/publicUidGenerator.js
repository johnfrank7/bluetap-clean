const ROLE_PREFIXES = {
  requester: 'Req',
  distributor: 'Dis',
  manager: 'Mgr',
  admin: 'Adm',
};

function formatPublicUid(role, number) {
  const normRole = String(role || '').trim().toLowerCase();
  const prefix = ROLE_PREFIXES[normRole] || 'Acc';
  const num = Number(number) || 0;
  return `${prefix}${String(num).padStart(3, '0')}`;
}

function parsePublicUidNumber(role, publicUid) {
  const normRole = String(role || '').trim().toLowerCase();
  const prefix = ROLE_PREFIXES[normRole] || '';
  const str = String(publicUid || '').trim();
  if (!prefix || !str) return 0;
  if (/^[a-zA-Z0-9]{20,}$/.test(str)) return 0;
  const regex = new RegExp(`^${prefix}-?(\\d+)$`, 'i');
  const match = str.match(regex);
  if (match) {
    const parsed = parseInt(match[1], 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

async function generateNextPublicUid(tx, db, role) {
  const normRole = String(role || '').trim().toLowerCase();
  const counterRef = db.collection('accountCounters').doc(normRole);
  const counterSnap = await tx.get(counterRef);
  
  let currentLast = 0;
  if (counterSnap.exists) {
    const data = counterSnap.data() || {};
    currentLast = Number(data.lastNumber || data.count || 0);
  } else {
    // Check legacy counter document if accountCounters/{role} does not exist yet
    try {
      const legacySnap = await tx.get(db.collection('counters').doc('unique_ids'));
      if (legacySnap.exists) {
        const legacyData = legacySnap.data() || {};
        currentLast = Number(legacyData[normRole] || 0);
      }
    } catch {}
  }

  const nextNumber = (Number.isFinite(currentLast) && currentLast > 0 ? currentLast : 0) + 1;
  const now = new Date();

  tx.set(counterRef, {
    role: normRole,
    lastNumber: nextNumber,
    count: nextNumber,
    updatedAt: now,
  }, { merge: true });

  // Keep legacy counters document in sync for backward compatibility
  try {
    const legacyRef = db.collection('counters').doc('unique_ids');
    tx.set(legacyRef, { [normRole]: nextNumber }, { merge: true });
  } catch {}

  return formatPublicUid(normRole, nextNumber);
}

module.exports = {
  ROLE_PREFIXES,
  formatPublicUid,
  parsePublicUidNumber,
  generateNextPublicUid,
};

