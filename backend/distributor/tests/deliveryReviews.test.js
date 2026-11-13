const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const babel = require('@babel/core');
const { reviewViewModel } = require('../../../services/distributorReviewPresentation');

const attemptId = 'a'.repeat(64);
const pending = { attemptId, orderId: 'order-one', orderReference: 'Order #1',
  reviewStatus: 'pending_review', summary: 'Your reported delivery attempt is awaiting Manager review.' };

function loadClient(auth, fetch) {
  const filename = resolve(__dirname, '../../../services/distributorDeliveryReviews.js');
  const source = babel.transformSync(readFileSync(filename, 'utf8'), {
    filename, babelrc: false, configFile: false, plugins: ['@babel/plugin-transform-modules-commonjs'],
  }).code;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', 'fetch', 'AbortController', 'setTimeout', 'clearTimeout', source)(
    (name) => {
      if (name === '../firebase') return { auth };
      if (name === './apiClient') return { getApiUrl: (path) => `https://backend.test${path}` };
      if (name === './authSession') return { ensureAuthStateReady: async () => {} };
      if (name === './unavailableEndpoint') return require('../../../services/unavailableEndpoint.js');
      throw new Error(`Unexpected import: ${name}`);
    }, module, module.exports, fetch, AbortController, setTimeout, clearTimeout,
  );
  return module.exports;
}

test('Distributor review presentation accepts only the bounded neutral server contract', () => {
  assert.equal(reviewViewModel(pending).statusLabel, 'Pending Review');
  for (const responsibility of ['requester_responsible', 'provider_responsible', 'shared', 'undetermined']) {
    const completed = reviewViewModel({ ...pending, reviewStatus: 'completed', responsibility,
      decidedAt: '2026-10-24T12:00:00.000Z',
      summary: 'The Manager review of your reported delivery attempt is complete.' });
    assert.equal(completed.statusLabel, 'Review Completed');
    assert.ok(completed.responsibilityLabel);
  }
  assert.equal(reviewViewModel({ ...pending, attemptId: 'forged' }), null);
  assert.equal(reviewViewModel({ ...pending, reviewStatus: 'completed' }), null);
  const root = resolve(__dirname, '../../..');
  const ui = readFileSync(resolve(root, 'components/DistributorDeliveryReviews.jsx'), 'utf8');
  const history = readFileSync(resolve(root, 'app/distributor/d_history.jsx'), 'utf8');
  assert.match(ui, /auth\.currentUser\?\.uid === uid/);
  assert.match(ui, /fetchDistributorDeliveryReview\(item\.attemptId, ownerUid\)/);
  assert.match(ui, /epochRef\.current/);
  assert.match(ui, /colors\.surfaceAlt/);
  assert.match(history, /<DistributorDeliveryReviews/);
});

test('Distributor client sends an authenticated exact lookup and rejects stale account responses', async () => {
  const auth = { currentUser: { uid: 'd1', getIdToken: async () => 'trusted-token' } };
  const calls = [];
  let release;
  const client = loadClient(auth, async (url, options) => {
    calls.push({ url, options });
    if (url.includes('attemptId=')) await new Promise((resolve) => { release = resolve; });
    return { ok: true, status: 200, json: async () => url.includes('attemptId=')
      ? { review: pending } : { reviews: [pending], nextCursor: null } };
  });
  assert.equal((await client.fetchDistributorDeliveryReviews({ expectedUid: 'd1' })).reviews.length, 1);
  assert.match(calls[0].url, /limit=5/);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer trusted-token');
  assert.throws(() => client.fetchDistributorDeliveryReviews({ expectedUid: 'd1', limit: 26 }), RangeError);
  const detail = client.fetchDistributorDeliveryReview(attemptId, 'd1');
  await new Promise((resolve) => setImmediate(resolve));
  auth.currentUser = { uid: 'd2', getIdToken: async () => 'second-token' };
  release();
  await assert.rejects(detail, /session changed/);
  await assert.rejects(client.fetchDistributorDeliveryReviews({ expectedUid: 'd1' }), /session changed/);
  assert.match(calls[1].url, new RegExp(`attemptId=${attemptId}`));
});
