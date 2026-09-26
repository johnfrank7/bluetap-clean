const { OtpError } = require('../utils/otpError');

const DEVICE_LIMIT_MESSAGE = 'The maximum number of accounts allowed on this device has been reached.';
const IP_LIMIT_MESSAGE = 'The maximum number of accounts allowed on this network has been reached.';

function limitError(kind) {
  return kind === 'device'
    ? new OtpError(403, 'DEVICE_ACCOUNT_LIMIT_REACHED', DEVICE_LIMIT_MESSAGE)
    : new OtpError(403, 'IP_ACCOUNT_LIMIT_REACHED', IP_LIMIT_MESSAGE);
}

function count(data, field) {
  return Math.max(0, Number(data?.[field] || 0));
}

function refsFor(db, session) {
  const keys = session?.registrationLimitKeys;
  if (!keys?.deviceHash || !keys?.ipHash) {
    throw new OtpError(403, 'registration-session-invalid', 'Registration security information is missing. Please restart signup.');
  }
  return [
    db.collection('registrationLimits').doc(`device_${keys.deviceHash}`),
    db.collection('registrationLimits').doc(`ip_${keys.ipHash}`),
  ];
}

function assertCapacity(snapshots, policy, includeReservations) {
  const configured = [policy?.maxAccountsPerDevice, policy?.maxAccountsPerIp];
  if (!configured.every((value) => Number.isInteger(value) && value > 0)) {
    throw new OtpError(403, 'registration-session-invalid', 'Registration security information is missing. Please restart signup.');
  }
  snapshots.forEach((snapshot, index) => {
    const data = snapshot.data() || {};
    const used = count(data, 'finalizedCount') + (includeReservations ? count(data, 'reservedCount') : 0);
    if (used >= configured[index]) throw limitError(index === 0 ? 'device' : 'ip');
  });
}

async function checkFinalizedRegistrationLimits({ db, deviceHash, ipHash, policy }) {
  await db.runTransaction(async (tx) => {
    const refs = [
      db.collection('registrationLimits').doc(`device_${deviceHash}`),
      db.collection('registrationLimits').doc(`ip_${ipHash}`),
    ];
    const snapshots = await Promise.all(refs.map((ref) => tx.get(ref)));
    assertCapacity(snapshots, policy, false);
  });
}

function createRegistrationLimitService({ db, now = Date.now }) {
  async function prepareApply(tx, sessionRef, session, userUid, commit) {
    if (session?.registrationLimitReservation?.uid !== userUid || session.registrationLimitReservation.status !== 'reserved') {
      throw new OtpError(409, 'registration-session-invalid', 'Registration account limits were not reserved.');
    }
    const refs = refsFor(db, session);
    const snapshots = await Promise.all(refs.map((ref) => tx.get(ref)));
    return () => {
      refs.forEach((ref, index) => {
        const data = snapshots[index].data() || {};
        tx.set(ref, {
          reservedCount: Math.max(0, count(data, 'reservedCount') - 1),
          finalizedCount: count(data, 'finalizedCount') + (commit ? 1 : 0),
          updatedAt: new Date(now()),
        }, { merge: true });
      });
      tx.update(sessionRef, {
        registrationLimitReservation: { uid: userUid, status: commit ? 'committed' : 'released', updatedAt: new Date(now()) },
      });
    };
  }

  async function reserve(registrationSessionId, userUid) {
    await db.runTransaction(async (tx) => {
      const sessionRef = db.collection('registrationSessions').doc(registrationSessionId);
      const session = (await tx.get(sessionRef)).data();
      if (!session || session.completed) {
        throw new OtpError(403, 'registration-session-invalid', 'Registration session is invalid.');
      }
      if (session.registrationLimitReservation?.uid === userUid && session.registrationLimitReservation?.status === 'reserved') return;
      const refs = refsFor(db, session);
      const snapshots = await Promise.all(refs.map((ref) => tx.get(ref)));
      assertCapacity(snapshots, session.securityPolicySnapshot, true);
      refs.forEach((ref, index) => tx.set(ref, {
        reservedCount: count(snapshots[index].data(), 'reservedCount') + 1,
        updatedAt: new Date(now()),
      }, { merge: true }));
      tx.update(sessionRef, {
        registrationLimitReservation: { uid: userUid, status: 'reserved', reservedAt: new Date(now()) },
      });
    });
  }

  async function apply(tx, sessionRef, session, userUid, commit) {
    const commitApply = await prepareApply(tx, sessionRef, session, userUid, commit);
    commitApply();
  }

  async function release(registrationSessionId, userUid) {
    await db.runTransaction(async (tx) => {
      const sessionRef = db.collection('registrationSessions').doc(registrationSessionId);
      const session = (await tx.get(sessionRef)).data();
      if (session?.registrationLimitReservation?.uid !== userUid || session.registrationLimitReservation.status !== 'reserved') return;
      await apply(tx, sessionRef, session, userUid, false);
    });
  }

  return { apply, prepareApply, refsFor: (session) => refsFor(db, session), release, reserve };
}

module.exports = {
  DEVICE_LIMIT_MESSAGE,
  IP_LIMIT_MESSAGE,
  checkFinalizedRegistrationLimits,
  createRegistrationLimitService,
};
