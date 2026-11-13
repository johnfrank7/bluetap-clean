const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { getApps, deleteApp, initializeApp: initializeAdminApp } = require('firebase-admin/app');
const { getAuth: getAdminAuth } = require('firebase-admin/auth');
const { initializeApp, deleteApp: deleteClientApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword } = require('firebase/auth');
const { getFirebaseAdmin } = require('../../firebase/firebaseAdmin');
const { requireTripEmulator } = require('../../utils/deliveryTripFoundation');
const { createDistributorAssignedOrdersHandler } = require('../../distributor/assignedOrdersHandler');
const { createManagerDispatchHandler } = require('../dispatchHandler');
const { createTripCapabilityHandler } = require('../tripCapabilityHandler');
const { createAppServer } = require('../../app');

const enabled = process.env.FIRESTORE_EMULATOR_HOST === '127.0.0.1:8080' && process.env.FIREBASE_AUTH_EMULATOR_HOST === '127.0.0.1:9099' && ['demo-bluetap', 'demo-bluetap-local-qa'].includes(process.env.GCLOUD_PROJECT) && process.env.BLUETAP_TRIP_EMULATOR_MODE === '1';
const keys = ['APP_ENV', 'NODE_ENV', 'LOCAL_QA_EMULATORS', 'FIREBASE_PROJECT_ID', 'GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'EXPO_PUBLIC_FIREBASE_PROJECT_ID', 'EXPO_PUBLIC_APP_ENV', 'EXPO_PUBLIC_API_BASE_URL', 'FIREBASE_WEB_API_KEY', 'EMAIL_OTP_HASH_SECRET', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'EMAIL_PROVIDER', 'RESEND_API_KEY', 'VERCEL_MAIL_RELAY_URL', 'INTERNAL_MAIL_RELAY_SECRET', 'EMAIL_FROM_ADDRESS', 'DEEPFACE_API_URL', 'DEEPFACE_API_KEY', 'RENDER_EXTERNAL_HOSTNAME', 'RENDER_SERVICE_NAME', 'VERCEL_URL', 'ALLOWED_ORIGINS'];
const response = () => ({ statusCode: 200, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() { return this; } });

test('isolated project uses real Auth and Firestore emulators and denies cross-account proposal reads', { skip: !enabled, timeout: 60000 }, async () => {
  const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const selectedProject = process.env.GCLOUD_PROJECT;
  try {
    for (const project of [selectedProject]) {
      for (const key of keys) delete process.env[key];
      Object.assign(process.env, { FIREBASE_PROJECT_ID: project });
      if (!(project === 'demo-bluetap-local-qa' && process.env.TRIP_TEST_OMIT_GCLOUD === '1')) process.env.GCLOUD_PROJECT = project;
      if (project === 'demo-bluetap-local-qa') Object.assign(process.env, { APP_ENV: 'local-qa', LOCAL_QA_EMULATORS: '1', FIREBASE_WEB_API_KEY: 'fake-local-qa-key', EMAIL_OTP_HASH_SECRET: 'synthetic-test-only' });
      const { auth: adminAuth, db } = getFirebaseAdmin();
      assert.doesNotThrow(() => requireTripEmulator(db, adminAuth));
      const wrongApp = initializeAdminApp({ projectId: project === 'demo-bluetap' ? 'demo-bluetap-local-qa' : 'demo-bluetap' }, `wrong-${randomUUID()}`);
      try { assert.throws(() => requireTripEmulator(db, getAdminAuth(wrongApp)), { reason: 'TRIP_MODE_DISABLED' }); }
      finally { await deleteApp(wrongApp); }
      const suffix = randomUUID(); const uid = `dist-${suffix}`; const other = `other-${suffix}`; const branch = `branch-${suffix}`; const order = `order-${suffix}`; const proposalId = 'proposal-rejected';
      const email = `${uid}@example.test`; const password = `Test-${randomUUID()}-aA1!`; const managerUid = `manager-${suffix}`; const managerEmail = `${managerUid}@example.test`; const otherBranch = `other-branch-${suffix}`;
      await adminAuth.createUser({ uid, email, password }); await adminAuth.createUser({ uid: managerUid, email: managerEmail, password }); await adminAuth.setCustomUserClaims(managerUid, { role: 'manager', manager: true });
      await Promise.all([
        db.doc(`users/${uid}`).set({ role: 'distributor', approvalStatus: 'active', branchId: branch, fullName: 'Test Driver', phone: '09123456789', completeAddress: 'Test Barangay' }),
        db.doc(`branches/${branch}`).set({ status: 'active' }),
        db.doc(`branches/${otherBranch}`).set({ status: 'active' }),
        db.doc(`users/${managerUid}`).set({ role: 'manager', managerStatus: 'active', branchId: otherBranch }),
        db.doc(`requests/${order}`).set({ status: 'delivery_failed', branchId: branch, currentBranchId: branch, assignedDistributorUid: other, distributorRescheduleProposals: [{ id: proposalId, status: 'rejected', orderId: order, distributorUid: other, branchId: branch, scheduledAt: '2030-01-01T00:00:00.000Z' }] }),
      ]);
      const client = initializeApp({ apiKey: 'synthetic-emulator-key', projectId: project }, `client-${suffix}`); const clientAuth = getAuth(client);
      try {
        connectAuthEmulator(clientAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
        const token = await (await signInWithEmailAndPassword(clientAuth, email, password)).user.getIdToken();
        const handler = createDistributorAssignedOrdersHandler(() => ({ auth: adminAuth, db }));
        const call = async () => { const res = response(); await handler({ method: 'GET', headers: { authorization: `Bearer ${token}` }, query: { rescheduleProposalOrderId: order, rescheduleProposalId: proposalId } }, res); return res; };
        assert.equal((await call()).statusCode, 404);
        await db.doc(`requests/${order}`).update({ assignedDistributorUid: uid, distributorRescheduleProposals: [{ id: proposalId, status: 'rejected', orderId: order, distributorUid: uid, branchId: branch, scheduledAt: '2030-01-01T00:00:00.000Z' }] });
        const own = await call(); assert.equal(own.statusCode, 200, JSON.stringify(own.body)); assert.equal(own.body.proposal.status, 'rejected');
        const managerToken = await (await signInWithEmailAndPassword(clientAuth, managerEmail, password)).user.getIdToken();
        const managerHandler = createManagerDispatchHandler(() => ({ auth: adminAuth, db })); const denied = response();
        await managerHandler({ method: 'GET', headers: { authorization: `Bearer ${managerToken}` }, query: { tripApprovalOrderId: order, tripApprovalProposalId: proposalId } }, denied);
        assert.equal(denied.statusCode, 403);
        const capabilityHandler = createTripCapabilityHandler(() => ({ auth: adminAuth, db }));
        const server = createAppServer(new Map([['/api/distributor/orders', handler], ['/api/manager/dispatch-orders', managerHandler], ['/api/trip-capability', capabilityHandler]]));
        await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
        try {
          const base = `http://127.0.0.1:${server.address().port}`;
          const capability = await fetch(`${base}/api/trip-capability`, { headers: { Authorization: `Bearer ${managerToken}` } });
          assert.equal(capability.status, 200); assert.deepEqual(await capability.json(), { tripApprovalAvailable: true, emulatorProjectId: project });
          const ownHttp = await fetch(`${base}/api/distributor/orders?rescheduleProposalOrderId=${encodeURIComponent(order)}&rescheduleProposalId=${proposalId}`, { headers: { Authorization: `Bearer ${token}` } });
          assert.equal(ownHttp.status, 200); assert.equal((await ownHttp.json()).proposal.status, 'rejected');
          const latestHttp = await fetch(`${base}/api/distributor/orders?rescheduleProposalOrderId=${encodeURIComponent(order)}`, { headers: { Authorization: `Bearer ${token}` } });
          assert.equal(latestHttp.status, 200); assert.equal((await latestHttp.json()).proposal.id, proposalId);
          const deniedHttp = await fetch(`${base}/api/manager/dispatch-orders?tripApprovalOrderId=${encodeURIComponent(order)}&tripApprovalProposalId=${proposalId}`, { headers: { Authorization: `Bearer ${managerToken}` } });
          assert.equal(deniedHttp.status, 403);
        } finally { await new Promise((resolve) => server.close(resolve)); }
      } finally { await deleteClientApp(client); }
      const adminApp = getApps().find((item) => item.name === 'bluetap-vercel'); if (adminApp) await deleteApp(adminApp);
    }
  } finally {
    const adminApp = getApps().find((item) => item.name === 'bluetap-vercel'); if (adminApp) await deleteApp(adminApp);
    for (const key of keys) { if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key]; }
  }
});
