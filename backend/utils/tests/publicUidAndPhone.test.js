const assert = require('node:assert/strict');
const { test } = require('node:test');

const {
  normalizePhilippinePhone,
  isValidPhilippinePhone,
  formatPhilippinePhone,
} = require('../phoneUtils');
const {
  formatPublicUid,
  parsePublicUidNumber,
  generateNextPublicUid,
} = require('../publicUidGenerator');

test('Philippine phone normalization handles standard formats', () => {
  assert.equal(normalizePhilippinePhone('09123456789'), '+639123456789');
  assert.equal(normalizePhilippinePhone('+639123456789'), '+639123456789');
  assert.equal(normalizePhilippinePhone('639123456789'), '+639123456789');
  assert.equal(normalizePhilippinePhone('9123456789'), '+639123456789');
  assert.equal(normalizePhilippinePhone('(0912) 345-6789'), '+639123456789');
  assert.equal(normalizePhilippinePhone('+63 912 345 6789'), '+639123456789');

  assert.equal(isValidPhilippinePhone('09123456789'), true);
  assert.equal(isValidPhilippinePhone('12345'), false);
  assert.equal(isValidPhilippinePhone('08123456789'), false);
  assert.equal(isValidPhilippinePhone(''), false);
  assert.equal(normalizePhilippinePhone('invalid'), null);
});

test('Philippine phone display formatter formats as 09XX XXX XXXX', () => {
  assert.equal(formatPhilippinePhone('+639123456789'), '0912 345 6789');
  assert.equal(formatPhilippinePhone('09123456789'), '0912 345 6789');
});

test('formatPublicUid formats roles with 3-digit padding', () => {
  assert.equal(formatPublicUid('requester', 1), 'Req001');
  assert.equal(formatPublicUid('distributor', 2), 'Dis002');
  assert.equal(formatPublicUid('manager', 10), 'Mgr010');
  assert.equal(formatPublicUid('admin', 100), 'Adm100');
  assert.equal(formatPublicUid('requester', 1000), 'Req1000');
});

test('parsePublicUidNumber parses number from formatted string', () => {
  assert.equal(parsePublicUidNumber('requester', 'Req001'), 1);
  assert.equal(parsePublicUidNumber('distributor', 'Dis042'), 42);
  assert.equal(parsePublicUidNumber('manager', 'Mgr999'), 999);
  assert.equal(parsePublicUidNumber('requester', 'REQ-000001'), 1);
  assert.equal(parsePublicUidNumber('distributor', 'DIS-000005'), 5);
  assert.equal(parsePublicUidNumber('manager', 'MGR-000010'), 10);
  assert.equal(parsePublicUidNumber('admin', 'ADM-000002'), 2);
  assert.equal(parsePublicUidNumber('requester', 'invalid'), 0);
  assert.equal(parsePublicUidNumber('requester', 'Not set'), 0);
  assert.equal(parsePublicUidNumber('requester', 'aBcdEf1234567890XyZ12345'), 0);
});

test('generateNextPublicUid atomically increments role counter', async () => {
  const store = new Map();
  const db = {
    collection: (col) => ({
      doc: (id) => ({
        path: `${col}/${id}`,
      }),
    }),
  };

  const createTx = () => ({
    get: async (ref) => ({
      exists: store.has(ref.path),
      data: () => store.get(ref.path) || {},
    }),
    set: (ref, data, opts) => {
      const existing = opts?.merge ? (store.get(ref.path) || {}) : {};
      store.set(ref.path, { ...existing, ...data });
    },
  });

  const uid1 = await generateNextPublicUid(createTx(), db, 'requester');
  assert.equal(uid1, 'Req001');

  const uid2 = await generateNextPublicUid(createTx(), db, 'requester');
  assert.equal(uid2, 'Req002');

  const uid3 = await generateNextPublicUid(createTx(), db, 'distributor');
  assert.equal(uid3, 'Dis001');

  const uid4 = await generateNextPublicUid(createTx(), db, 'manager');
  assert.equal(uid4, 'Mgr001');

  // Verify counter doc in store
  assert.equal(store.get('accountCounters/requester').lastNumber, 2);
  assert.equal(store.get('accountCounters/distributor').lastNumber, 1);
  assert.equal(store.get('accountCounters/manager').lastNumber, 1);
});

