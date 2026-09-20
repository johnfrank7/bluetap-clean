const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEVICE_LIMIT_MESSAGE,
  IP_LIMIT_MESSAGE,
  checkFinalizedRegistrationLimits,
  createRegistrationLimitService,
} = require('../registrationLimits');

function fixture() {
  const records = new Map();
  let queue = Promise.resolve();
  const snapshot = (key) => ({ exists: records.has(key), data: () => records.get(key) });
  const db = {
    collection: (collection) => ({ doc: (id) => ({ key: `${collection}/${id}` }) }),
    runTransaction(callback) {
      const task = queue.then(async () => {
        const writes = [];
        const result = await callback({
          get: async (ref) => snapshot(ref.key),
          set: (ref, data, options) => writes.push([ref.key, options?.merge ? { ...records.get(ref.key), ...data } : data]),
          update: (ref, data) => writes.push([ref.key, { ...records.get(ref.key), ...data }]),
        });
        writes.forEach(([key, data]) => records.set(key, data));
        return result;
      });
      queue = task.catch(() => {});
      return task;
    },
  };
  const limits = createRegistrationLimitService({ db, now: () => 1800000000000 });
  const addSession = (id, { deviceHash = 'shared-device', ipHash = 'shared-ip', deviceLimit = 3, ipLimit = 3 } = {}) => {
    records.set(`registrationSessions/${id}`, {
      completed: false,
      registrationLimitKeys: { deviceHash, ipHash },
      securityPolicySnapshot: { maxAccountsPerDevice: deviceLimit, maxAccountsPerIp: ipLimit },
    });
  };
  const finalize = async (id, uid) => {
    await limits.reserve(id, uid);
    await db.runTransaction(async (tx) => {
      const sessionRef = db.collection('registrationSessions').doc(id);
      const session = (await tx.get(sessionRef)).data();
      await limits.apply(tx, sessionRef, session, uid, true);
      tx.update(sessionRef, { completed: true });
    });
  };
  return { addSession, db, finalize, limits, records };
}

test('device limit allows the first three finalized accounts and blocks the fourth', async () => {
  const f = fixture();
  for (let index = 1; index <= 3; index += 1) {
    f.addSession(`device-${index}`, { ipLimit: 20 });
    await f.finalize(`device-${index}`, `user-${index}`);
  }
  assert.equal(f.records.get('registrationLimits/device_shared-device').finalizedCount, 3);
  f.addSession('device-4', { ipLimit: 20 });
  await assert.rejects(f.finalize('device-4', 'user-4'), (error) => {
    assert.equal(error.reason, 'DEVICE_ACCOUNT_LIMIT_REACHED');
    assert.equal(error.message, DEVICE_LIMIT_MESSAGE);
    return true;
  });
  assert.equal(f.records.get('registrationLimits/device_shared-device').finalizedCount, 3);
});

test('network limit counts finalized accounts across different devices and blocks the next account', async () => {
  const f = fixture();
  for (let index = 1; index <= 3; index += 1) {
    f.addSession(`ip-${index}`, { deviceHash: `device-${index}`, deviceLimit: 20 });
    await f.finalize(`ip-${index}`, `user-${index}`);
  }
  f.addSession('ip-4', { deviceHash: 'device-4', deviceLimit: 20 });
  await assert.rejects(f.finalize('ip-4', 'user-4'), (error) => {
    assert.equal(error.reason, 'IP_ACCOUNT_LIMIT_REACHED');
    assert.equal(error.message, IP_LIMIT_MESSAGE);
    return true;
  });
  assert.equal(f.records.get('registrationLimits/ip_shared-ip').finalizedCount, 3);
});

test('abandoned and released reservations never consume a finalized account slot', async () => {
  const f = fixture();
  f.addSession('abandoned');
  assert.equal(f.records.has('registrationLimits/device_shared-device'), false);

  f.addSession('failed');
  await f.limits.reserve('failed', 'failed-user');
  await f.limits.release('failed', 'failed-user');
  assert.deepEqual({
    finalizedCount: f.records.get('registrationLimits/device_shared-device').finalizedCount,
    reservedCount: f.records.get('registrationLimits/device_shared-device').reservedCount,
  }, { finalizedCount: 0, reservedCount: 0 });
});

test('simultaneous finalizations atomically allow exactly one remaining slot', async () => {
  const f = fixture();
  f.records.set('registrationLimits/device_shared-device', { finalizedCount: 2, reservedCount: 0 });
  f.records.set('registrationLimits/ip_shared-ip', { finalizedCount: 2, reservedCount: 0 });
  f.addSession('race-a');
  f.addSession('race-b');
  const results = await Promise.allSettled([
    f.finalize('race-a', 'race-user-a'),
    f.finalize('race-b', 'race-user-b'),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(results.find((result) => result.status === 'rejected').reason.reason, 'DEVICE_ACCOUNT_LIMIT_REACHED');
  assert.deepEqual({
    finalizedCount: f.records.get('registrationLimits/device_shared-device').finalizedCount,
    reservedCount: f.records.get('registrationLimits/device_shared-device').reservedCount,
  }, { finalizedCount: 3, reservedCount: 0 });
});

test('session creation check uses finalized counts only and reports the matching signal', async () => {
  const f = fixture();
  f.records.set('registrationLimits/device_shared-device', { finalizedCount: 2, reservedCount: 7 });
  f.records.set('registrationLimits/ip_shared-ip', { finalizedCount: 1, reservedCount: 7 });
  await checkFinalizedRegistrationLimits({
    db: f.db,
    deviceHash: 'shared-device',
    ipHash: 'shared-ip',
    policy: { maxAccountsPerDevice: 3, maxAccountsPerIp: 2 },
  });
  f.records.set('registrationLimits/ip_shared-ip', { finalizedCount: 2, reservedCount: 0 });
  await assert.rejects(checkFinalizedRegistrationLimits({
    db: f.db,
    deviceHash: 'shared-device',
    ipHash: 'shared-ip',
    policy: { maxAccountsPerDevice: 3, maxAccountsPerIp: 2 },
  }), (error) => error.reason === 'IP_ACCOUNT_LIMIT_REACHED');
});
