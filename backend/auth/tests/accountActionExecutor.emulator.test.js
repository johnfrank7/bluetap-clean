const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { initializeApp: initializeAdminApp, deleteApp: deleteAdminApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth: getAdminAuth } = require('firebase-admin/auth');
const { initializeApp: initializeClientApp, deleteApp: deleteClientApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut } = require('firebase/auth');
const { actionIdentity, authorizeAccountActionIntent,
  authorizeChatCaseAccountIntent, claimIntentLease } = require('../accountActionIntentService');
const { resumePendingIntent } = require('../accountActionExecutor');
const { createEmailOtpService } = require('../emailOtp');
const { applyModerationAction } = require('../../moderation/moderationHandler');

const firestoreHost = process.env.FIRESTORE_EMULATOR_HOST;
const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
const projectId = 'demo-bluetap';

test('real Auth and Firestore emulators disable and revoke only after a committed intent and hold',
  { skip: !firestoreHost || !authHost || process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId }, async () => {
    const suffix = randomUUID();
    const adminUid = `admin-${suffix}`;
    const targetUid = `target-${suffix}`;
    const app = initializeAdminApp({ projectId }, `auth-action-${suffix}`);
    const clientApp = initializeClientApp({ apiKey: 'demo-key', authDomain: 'demo-bluetap.firebaseapp.com', projectId }, `auth-client-${suffix}`);
    const db = getFirestore(app);
    const auth = getAdminAuth(app);
    const clientAuth = getAuth(clientApp);
    connectAuthEmulator(clientAuth, `http://${authHost}`, { disableWarnings: true });
    try {
      await auth.createUser({ uid: adminUid, email: `admin-${suffix}@example.test`, password: 'SafePassword2026' });
      await auth.setCustomUserClaims(adminUid, { admin: true, role: 'admin' });
      await auth.createUser({ uid: targetUid, email: `target-${suffix}@example.test`,
        emailVerified: true, password: 'SafePassword2026' });
      await Promise.all([
        db.collection('users').doc(adminUid).set({ role: 'admin', accountStatus: 'active' }),
        db.collection('users').doc(targetUid).set({ role: 'requester', accountStatus: 'active',
          email: `target-${suffix}@example.test` }),
      ]);
      const credential = await signInWithEmailAndPassword(clientAuth, `admin-${suffix}@example.test`, 'SafePassword2026');
      const idToken = await credential.user.getIdToken(true);
      const request = { source: 'admin_account', action: 'suspend', targetUid,
        clientMutationId: `mutation-${suffix}`, reason: 'Reviewed account safety incident.' };
      const authorized = await authorizeAccountActionIntent({ db, auth, idToken, request });
      assert.equal((await auth.getUser(targetUid)).disabled, false);
      assert.equal((await db.collection('users').doc(targetUid).get()).data().accountActionHoldIntentId, authorized.intent.id);
      const executed = await resumePendingIntent({ db, auth, intentId: authorized.intent.id,
        actingUid: adminUid, sendEmail: async () => ({ provider: 'test', providerStatus: 200 }) });
      assert.equal(executed.state, 'applied');
      const user = await auth.getUser(targetUid);
      assert.equal(user.disabled, true);
      assert.ok(user.tokensValidAfterTime);
      assert.equal((await db.collection('users').doc(targetUid).get()).data().accountStatus, 'suspended');
      assert.equal((await db.collection('accountActionReservations').doc(targetUid).get()).data().intentId, authorized.intent.id);
      assert.equal((await db.collection('adminAuditLogs').doc(`account_action_${authorized.intent.id}`).get()).exists, true);
      await assert.rejects(resumePendingIntent({ db, auth, intentId: authorized.intent.id, actingUid: adminUid }),
        (error) => error.reason === 'ACCOUNT_ACTION_FINALIZED');
      const enable = await authorizeAccountActionIntent({ db, auth, idToken, request: {
        source: 'admin_account', action: 'reactivate', targetUid,
        clientMutationId: `reactivate-${suffix}`,
      } });
      assert.equal((await auth.getUser(targetUid)).disabled, true);
      assert.equal((await db.collection('accountAccessHolds').doc(targetUid).get()).data().state, 'pending_enable');
      const enabled = await resumePendingIntent({ db, auth, intentId: enable.intent.id, actingUid: adminUid });
      assert.equal(enabled.accountStatus, 'active');
      assert.equal((await auth.getUser(targetUid)).disabled, false);
      assert.equal((await db.collection('users').doc(targetUid).get()).data().accountStatus, 'active');
      assert.equal((await db.collection('accountAccessHolds').doc(targetUid).get()).exists, false);
      assert.equal((await db.collection('adminAuditLogs').doc(`account_action_${enable.intent.id}`).get()).data().action, 'ACCOUNT_REACTIVATED');
      await signOut(clientAuth);
    } finally {
      await deleteClientApp(clientApp);
      await deleteAdminApp(app);
    }
  });

test('real emulators apply deactivation and termination once; only deactivation can be reactivated',
  { skip: !firestoreHost || !authHost || process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId }, async () => {
    const suffix = randomUUID();
    const adminUid = `matrix-admin-${suffix}`;
    const app = initializeAdminApp({ projectId }, `matrix-admin-app-${suffix}`);
    const clientApp = initializeClientApp({ apiKey: 'demo-key', authDomain: 'demo-bluetap.firebaseapp.com', projectId }, `matrix-client-${suffix}`);
    const db = getFirestore(app);
    const auth = getAdminAuth(app);
    const clientAuth = getAuth(clientApp);
    connectAuthEmulator(clientAuth, `http://${authHost}`, { disableWarnings: true });
    try {
      await auth.createUser({ uid: adminUid, email: `matrix-admin-${suffix}@example.test`, password: 'SafePassword2026' });
      await auth.setCustomUserClaims(adminUid, { admin: true, role: 'admin' });
      await db.collection('users').doc(adminUid).set({ role: 'admin', accountStatus: 'active' });
      const credential = await signInWithEmailAndPassword(clientAuth, `matrix-admin-${suffix}@example.test`, 'SafePassword2026');
      const idToken = await credential.user.getIdToken(true);
      for (const [action, finalStatus] of [['deactivate', 'inactive'], ['terminate', 'terminated']]) {
        const targetUid = `matrix-${action}-${suffix}`;
        const email = `${targetUid}@example.test`;
        await auth.createUser({ uid: targetUid, email, emailVerified: false, password: 'SafePassword2026' });
        await db.collection('users').doc(targetUid).set({ role: 'requester', accountStatus: 'active', email });
        let code = '';
        const otp = createEmailOtpService({ auth, db, hashSecret: 'emulator-only-otp-secret',
          sendEmailOtp: async ({ recipient, code: issued }) => { assert.equal(recipient, email); code = issued; } });
        await otp.request(targetUid);
        await otp.verify(targetUid, code);
        assert.equal((await auth.getUser(targetUid)).emailVerified, true);
        const request = { source: 'admin_account', action, targetUid,
          clientMutationId: `matrix-${action}-${suffix}`, reason: 'Reviewed account safety incident.' };
        const authorized = await authorizeAccountActionIntent({ db, auth, idToken, request });
        let noticeCalls = 0;
        const applied = await resumePendingIntent({ db, auth, intentId: authorized.intent.id,
          actingUid: adminUid, sendEmail: async () => { noticeCalls += 1; return { provider: 'test', providerStatus: 200 }; } });
        assert.equal(applied.state, 'applied');
        assert.equal((await auth.getUser(targetUid)).disabled, true);
        assert.equal((await db.collection('users').doc(targetUid).get()).data().accountStatus, finalStatus);
        assert.equal((await db.collection('accountActionIntents').doc(authorized.intent.id).get()).data().noticeDelivery.state, 'accepted');
        assert.equal((await db.collection('adminAuditLogs').doc(`account_action_${authorized.intent.id}`).get()).exists, true);
        const replay = await authorizeAccountActionIntent({ db, auth, idToken, request });
        assert.equal(replay.intent.id, authorized.intent.id);
        assert.equal(noticeCalls, 1);
        if (action === 'deactivate') {
          const enable = await authorizeAccountActionIntent({ db, auth, idToken, request: {
            source: 'admin_account', action: 'reactivate', targetUid,
            clientMutationId: `matrix-enable-${suffix}`,
          } });
          const restored = await resumePendingIntent({ db, auth, intentId: enable.intent.id, actingUid: adminUid });
          assert.equal(restored.accountStatus, 'active');
          assert.equal((await auth.getUser(targetUid)).disabled, false);
        } else {
          await assert.rejects(authorizeAccountActionIntent({ db, auth, idToken, request: {
            source: 'admin_account', action: 'reactivate', targetUid,
            clientMutationId: `matrix-enable-terminated-${suffix}`,
          } }), (error) => error.reason === 'ACCOUNT_NOT_REACTIVATABLE');
        }
      }
      await signOut(clientAuth);
    } finally {
      await deleteClientApp(clientApp);
      await deleteAdminApp(app);
    }
  });

test('real Auth and Firestore emulators finalize one chat-case account action and deny changed replay',
  { skip: !firestoreHost || !authHost || process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId }, async () => {
    const suffix = randomUUID();
    const adminUid = `chat-admin-${suffix}`;
    const targetUid = `chat-target-${suffix}`;
    const reporterUid = `chat-reporter-${suffix}`;
    const reportId = `chat-report-${suffix}`;
    const conversationId = `chat-conversation-${suffix}`;
    const app = initializeAdminApp({ projectId }, `chat-admin-${suffix}`);
    const clientApp = initializeClientApp({ apiKey: 'demo-key',
      authDomain: 'demo-bluetap.firebaseapp.com', projectId }, `chat-client-${suffix}`);
    const db = getFirestore(app);
    const auth = getAdminAuth(app);
    const clientAuth = getAuth(clientApp);
    connectAuthEmulator(clientAuth, `http://${authHost}`, { disableWarnings: true });
    try {
      await auth.createUser({ uid: adminUid, email: `chat-admin-${suffix}@example.test`, password: 'SafePassword2026' });
      await auth.setCustomUserClaims(adminUid, { admin: true, role: 'admin' });
      await auth.createUser({ uid: targetUid, email: `chat-target-${suffix}@example.test`,
        emailVerified: true, password: 'SafePassword2026' });
      await Promise.all([
        db.collection('users').doc(adminUid).set({ role: 'admin', accountStatus: 'active', publicUid: 'Adm001' }),
        db.collection('users').doc(targetUid).set({ role: 'requester', accountStatus: 'active',
          email: `chat-target-${suffix}@example.test`, publicUid: 'Req001' }),
        db.collection('chatReports').doc(reportId).set({ schemaVersion: 1, status: 'open',
          reporterUid, reporterRole: 'distributor', reportedUid: targetUid, reportedRole: 'requester',
          conversationId, jurisdictionBranchId: 'branch-a', category: 'SPAM' }),
        db.collection('chatConversations').doc(conversationId).set({ type: 'requester_distributor',
          branchIds: ['branch-a'], requesterUid: targetUid, distributorUid: reporterUid,
          participantUserUids: [targetUid, reporterUid], participantBranchIds: [],
          participantState: [
            { principalType: 'user', principalId: targetUid },
            { principalType: 'user', principalId: reporterUid },
          ] }),
      ]);
      const credential = await signInWithEmailAndPassword(clientAuth, `chat-admin-${suffix}@example.test`, 'SafePassword2026');
      const idToken = await credential.user.getIdToken(true);
      const request = { reportId, action: 'suspend_account', reason: 'Reviewed specific chat evidence.',
        privateNote: 'Private context.', clientMutationId: `chat-${suffix}` };
      const apply = (body) => applyModerationAction({ auth, db, idToken, body,
        actor: { uid: adminUid, publicUid: 'Adm001' }, actorRole: 'admin',
        sendEmail: async () => ({ provider: 'test', providerStatus: 200 }) });
      const first = await apply(request);
      assert.equal(first.accountAction.state, 'applied');
      const id = first.accountAction.id;
      assert.equal((await auth.getUser(targetUid)).disabled, true);
      assert.equal((await db.collection('chatReports').doc(reportId).get()).data().status, 'resolved');
      assert.equal((await db.collection('moderationActions').doc(`account_${id}`).get()).exists, true);
      assert.equal((await db.collection('moderationNotices').doc(targetUid).collection('items').doc(`account_${id}`).get()).exists, true);
      assert.equal((await db.collection('adminAuditLogs').doc(`account_action_${id}`).get()).exists, true);
      assert.equal((await apply(request)).created, false);
      await assert.rejects(apply({ ...request, reason: 'A different reason for this action.' }),
        (error) => error.reason === 'ACCOUNT_ACTION_MUTATION_CONFLICT');
      await signOut(clientAuth);
    } finally {
      await deleteClientApp(clientApp);
      await deleteAdminApp(app);
    }
  });

async function chatFixture(suffix, { adminCount = 1, reportCount = 1 } = {}) {
  const targetUid = `race-target-${suffix}`;
  const reporterUid = `race-reporter-${suffix}`;
  const conversationId = `race-conversation-${suffix}`;
  const app = initializeAdminApp({ projectId }, `race-admin-${suffix}`);
  const db = getFirestore(app);
  const auth = getAdminAuth(app);
  const clients = [];
  const admins = [];
  const reportIds = Array.from({ length: reportCount }, (_, i) => `race-report-${i}-${suffix}`);
  try {
    await auth.createUser({ uid: targetUid, email: `race-target-${suffix}@example.test`,
      emailVerified: true, password: 'SafePassword2026' });
    await db.collection('users').doc(targetUid).set({ role: 'requester', accountStatus: 'active',
      email: `race-target-${suffix}@example.test`, publicUid: 'Req001' });
    await db.collection('chatConversations').doc(conversationId).set({ type: 'requester_distributor',
      branchIds: ['branch-a'], requesterUid: targetUid, distributorUid: reporterUid,
      participantUserUids: [targetUid, reporterUid], participantBranchIds: [],
      participantState: [
        { principalType: 'user', principalId: targetUid },
        { principalType: 'user', principalId: reporterUid },
      ] });
    await Promise.all(reportIds.map((reportId) => db.collection('chatReports').doc(reportId).set({
      schemaVersion: 1, status: 'open', reporterUid, reporterRole: 'distributor',
      reportedUid: targetUid, reportedRole: 'requester', conversationId,
      jurisdictionBranchId: 'branch-a', category: 'SPAM',
    })));
    for (let i = 0; i < adminCount; i += 1) {
      const uid = `race-admin-${i}-${suffix}`;
      const email = `race-admin-${i}-${suffix}@example.test`;
      await auth.createUser({ uid, email, password: 'SafePassword2026' });
      await auth.setCustomUserClaims(uid, { admin: true, role: 'admin' });
      await db.collection('users').doc(uid).set({ role: 'admin', accountStatus: 'active', publicUid: 'Adm001' });
      const clientApp = initializeClientApp({ apiKey: 'demo-key',
        authDomain: 'demo-bluetap.firebaseapp.com', projectId }, `race-client-${i}-${suffix}`);
      clients.push(clientApp);
      const clientAuth = getAuth(clientApp);
      connectAuthEmulator(clientAuth, `http://${authHost}`, { disableWarnings: true });
      const credential = await signInWithEmailAndPassword(clientAuth, email, 'SafePassword2026');
      admins.push({ uid, idToken: await credential.user.getIdToken(true) });
    }
    return { app, db, auth, clients, admins, targetUid, reportIds, conversationId };
  } catch (error) {
    await Promise.all(clients.map(deleteClientApp));
    await deleteAdminApp(app);
    throw error;
  }
}

async function disposeChatFixture(fixture) {
  await Promise.all(fixture.clients.map(deleteClientApp));
  await deleteAdminApp(fixture.app);
}

const emulatorOnly = { skip: !firestoreHost || !authHost
  || process.env.GCLOUD_PROJECT && process.env.GCLOUD_PROJECT !== projectId };

test('real emulators reject a chat-case action when the case closes during authorization',
  emulatorOnly, async () => {
    const fixture = await chatFixture(randomUUID(), { reportCount: 2 });
    const { db, auth, admins, targetUid, reportIds, conversationId } = fixture;
    const [closingReportId, validReportId] = reportIds;
    const request = { reportId: closingReportId, action: 'suspend_account',
      reason: 'Reviewed the reported conversation and evidence.', privateNote: '',
      clientMutationId: `race-${randomUUID()}` };
    let entered;
    let release;
    const caseReadStarted = new Promise((resolve) => { entered = resolve; });
    const caseMayRead = new Promise((resolve) => { release = resolve; });
    let delayed = false;
    const authCalls = { disable: 0, revoke: 0 };
    const observedAuth = {
      verifyIdToken: (...args) => auth.verifyIdToken(...args),
      getUser: (...args) => auth.getUser(...args),
      updateUser: async (...args) => { authCalls.disable += 1; return auth.updateUser(...args); },
      revokeRefreshTokens: async (...args) => { authCalls.revoke += 1; return auth.revokeRefreshTokens(...args); },
    };
    const racingDb = {
      collection: (...args) => db.collection(...args),
      runTransaction: (callback) => db.runTransaction((tx) => callback(new Proxy(tx, {
        get(target, property) {
          if (property === 'get') return async (ref) => {
            if (!delayed && ref.path === `chatReports/${closingReportId}`) {
              delayed = true;
              entered();
              await caseMayRead;
            }
            return target.get(ref);
          };
          const value = target[property];
          return typeof value === 'function' ? value.bind(target) : value;
        },
      }))),
    };
    try {
      const pending = authorizeChatCaseAccountIntent({ db: racingDb, auth: observedAuth,
        idToken: admins[0].idToken, actingUid: admins[0].uid, request });
      await caseReadStarted;
      await db.collection('chatReports').doc(closingReportId).update({ status: 'resolved' });
      release();
      await assert.rejects(pending, (error) => error.reason === 'MODERATION_RELATIONSHIP_INVALID');
      const rejectedId = actionIdentity(admins[0].uid, request);
      assert.equal((await db.collection('accountActionIntents').doc(rejectedId).get()).exists, false);
      assert.equal((await db.collection('accountActionReservations').doc(targetUid).get()).exists, false);
      assert.equal((await db.collection('accountAccessHolds').doc(targetUid).get()).exists, false);
      assert.equal((await db.collection('moderationActions').doc(`account_${rejectedId}`).get()).exists, false);
      assert.equal((await db.collection('adminAuditLogs').doc(`account_action_${rejectedId}`).get()).exists, false);
      assert.equal((await db.collection('moderationNotices').doc(targetUid)
        .collection('items').doc(`account_${rejectedId}`).get()).exists, false);
      assert.equal((await auth.getUser(targetUid)).disabled, false);
      assert.deepEqual(authCalls, { disable: 0, revoke: 0 });
      const validRequest = { ...request, reportId: validReportId, clientMutationId: `valid-${randomUUID()}` };
      const accepted = await authorizeChatCaseAccountIntent({ db, auth,
        idToken: admins[0].idToken, actingUid: admins[0].uid, request: validRequest });
      assert.equal(accepted.created, true);
      const stored = (await db.collection('accountActionIntents').doc(accepted.intent.id).get()).data();
      assert.deepEqual(stored.caseRef, { type: 'chat_report', id: validReportId,
        conversationId, branchId: 'branch-a' });
      assert.equal((await auth.getUser(targetUid)).disabled, false);
      assert.deepEqual(authCalls, { disable: 0, revoke: 0 });
    } finally {
      release?.();
      await disposeChatFixture(fixture);
    }
  });

test('real emulators reserve one of two competing chat-case account actions',
  emulatorOnly, async () => {
    const fixture = await chatFixture(randomUUID(), { adminCount: 2, reportCount: 2 });
    const { db, auth, admins, targetUid, reportIds } = fixture;
    const requests = reportIds.map((reportId, i) => ({ reportId, action: 'suspend_account',
      reason: `Reviewed distinct chat evidence for report ${i}.`, privateNote: '',
      clientMutationId: `compete-${i}-${randomUUID()}` }));
    const authCalls = { disable: 0, revoke: 0 };
    const observedAuth = {
      verifyIdToken: (...args) => auth.verifyIdToken(...args),
      getUser: (...args) => auth.getUser(...args),
      updateUser: async (...args) => { authCalls.disable += 1; return auth.updateUser(...args); },
      revokeRefreshTokens: async (...args) => { authCalls.revoke += 1; return auth.revokeRefreshTokens(...args); },
    };
    try {
      const outcomes = await Promise.allSettled(requests.map((request, i) =>
        authorizeChatCaseAccountIntent({ db, auth: observedAuth, idToken: admins[i].idToken,
          actingUid: admins[i].uid, request })));
      const successes = outcomes.map((outcome, i) => ({ outcome, i }))
        .filter(({ outcome }) => outcome.status === 'fulfilled');
      assert.equal(successes.length, 1);
      const winner = successes[0].i;
      const loser = 1 - winner;
      assert.equal(outcomes[loser].status, 'rejected');
      assert.equal(outcomes[loser].reason.reason, 'ACCOUNT_ACTION_RESERVED');
      const winningIntent = successes[0].outcome.value.intent;
      const losingId = actionIdentity(admins[loser].uid, requests[loser]);
      assert.equal((await db.collection('accountActionIntents').doc(losingId).get()).exists, false);
      assert.equal((await db.collection('accountActionReservations').doc(targetUid).get()).data().intentId, winningIntent.id);
      assert.equal((await db.collection('accountAccessHolds').doc(targetUid).get()).data().intentId, winningIntent.id);
      const beforeReplay = (await db.collection('accountActionIntents').doc(winningIntent.id).get()).data().revision;
      const replay = await authorizeChatCaseAccountIntent({ db, auth: observedAuth,
        idToken: admins[winner].idToken, actingUid: admins[winner].uid, request: requests[winner] });
      assert.equal(replay.created, false);
      assert.equal((await db.collection('accountActionIntents').doc(winningIntent.id).get()).data().revision, beforeReplay);
      await assert.rejects(authorizeChatCaseAccountIntent({ db, auth: observedAuth,
        idToken: admins[winner].idToken, actingUid: admins[winner].uid,
        request: { ...requests[winner], reason: 'A materially different reviewed case reason.' } }),
      (error) => error.reason === 'ACCOUNT_ACTION_MUTATION_CONFLICT');
      const applied = await resumePendingIntent({ db, auth: observedAuth,
        intentId: winningIntent.id, actingUid: admins[winner].uid,
        sendEmail: async () => ({ provider: 'test', providerStatus: 200 }) });
      assert.equal(applied.state, 'applied');
      assert.deepEqual(authCalls, { disable: 1, revoke: 1 });
      assert.equal((await auth.getUser(targetUid)).disabled, true);
      assert.equal((await db.collection('moderationActions').doc(`account_${winningIntent.id}`).get()).exists, true);
      assert.equal((await db.collection('moderationActions').doc(`account_${losingId}`).get()).exists, false);
      assert.equal((await db.collection('moderationNotices').doc(targetUid)
        .collection('items').doc(`account_${winningIntent.id}`).get()).exists, true);
      assert.equal((await db.collection('moderationNotices').doc(targetUid)
        .collection('items').doc(`account_${losingId}`).get()).exists, false);
      assert.equal((await db.collection('chatReports').doc(reportIds[loser]).get()).data().status, 'open');
      assert.equal((await db.collection('chatReports').doc(reportIds[winner]).get()).data().status, 'resolved');
      const appliedRevision = (await db.collection('accountActionIntents').doc(winningIntent.id).get()).data().revision;
      const finalizedReplay = await authorizeChatCaseAccountIntent({ db, auth: observedAuth,
        idToken: admins[winner].idToken, actingUid: admins[winner].uid, request: requests[winner] });
      assert.equal(finalizedReplay.created, false);
      assert.equal(finalizedReplay.intent.state, 'applied');
      assert.equal((await db.collection('accountActionIntents').doc(winningIntent.id).get()).data().revision, appliedRevision);
      assert.deepEqual(authCalls, { disable: 1, revoke: 1 });
    } finally {
      await disposeChatFixture(fixture);
    }
  });

test('real emulators keep a reservation while an older Auth disable finishes after lease expiry',
  emulatorOnly, async () => {
    const suffix = randomUUID();
    const adminUid = `late-admin-${suffix}`;
    const targetUid = `late-target-${suffix}`;
    const app = initializeAdminApp({ projectId }, `late-admin-app-${suffix}`);
    const clientApp = initializeClientApp({ apiKey: 'demo-key',
      authDomain: 'demo-bluetap.firebaseapp.com', projectId }, `late-client-${suffix}`);
    const db = getFirestore(app);
    const auth = getAdminAuth(app);
    const clientAuth = getAuth(clientApp);
    connectAuthEmulator(clientAuth, `http://${authHost}`, { disableWarnings: true });
    let release;
    try {
      await auth.createUser({ uid: adminUid, email: `late-admin-${suffix}@example.test`, password: 'SafePassword2026' });
      await auth.setCustomUserClaims(adminUid, { admin: true, role: 'admin' });
      await auth.createUser({ uid: targetUid, email: `late-target-${suffix}@example.test`,
        emailVerified: true, password: 'SafePassword2026' });
      await Promise.all([
        db.collection('users').doc(adminUid).set({ role: 'admin', accountStatus: 'active' }),
        db.collection('users').doc(targetUid).set({ role: 'requester', accountStatus: 'active',
          email: `late-target-${suffix}@example.test` }),
      ]);
      const credential = await signInWithEmailAndPassword(clientAuth, `late-admin-${suffix}@example.test`, 'SafePassword2026');
      const idToken = await credential.user.getIdToken(true);
      const request = { source: 'admin_account', action: 'suspend', targetUid,
        clientMutationId: `late-${suffix}`, reason: 'Reviewed account safety incident.' };
      const authorized = await authorizeAccountActionIntent({ db, auth, idToken, request });
      let entered;
      const updateStarted = new Promise((resolve) => { entered = resolve; });
      const updateMayFinish = new Promise((resolve) => { release = resolve; });
      const delayedAuth = {
        getUser: (...args) => auth.getUser(...args),
        updateUser: async (...args) => { entered(); await updateMayFinish; return auth.updateUser(...args); },
        revokeRefreshTokens: (...args) => auth.revokeRefreshTokens(...args),
      };
      const running = resumePendingIntent({ db, auth: delayedAuth,
        intentId: authorized.intent.id, actingUid: adminUid,
        sendEmail: async () => ({ provider: 'test', providerStatus: 200 }) });
      await updateStarted;
      const reactivate = { source: 'admin_account', action: 'reactivate', targetUid,
        clientMutationId: `enable-${suffix}` };
      await assert.rejects(authorizeAccountActionIntent({ db, auth, idToken, request: reactivate }),
        (error) => error.reason === 'ACCOUNT_NOT_REACTIVATABLE');
      await claimIntentLease({ db, intentId: authorized.intent.id, ownerId: `successor-${suffix}`,
        now: new Date(Date.now() + 120_000), leaseMs: 1_000 });
      release();
      await assert.rejects(running, (error) => error.reason === 'ACCOUNT_ACTION_AUTHORITY_CHANGED');
      assert.equal((await auth.getUser(targetUid)).disabled, true);
      assert.equal((await db.collection('users').doc(targetUid).get()).data().accountStatus, 'active');
      assert.equal((await db.collection('users').doc(targetUid).get()).data().accountActionHoldIntentId, authorized.intent.id);
      assert.equal((await db.collection('accountActionReservations').doc(targetUid).get()).data().intentId, authorized.intent.id);
      await assert.rejects(authorizeAccountActionIntent({ db, auth, idToken, request: reactivate }),
        (error) => error.reason === 'ACCOUNT_NOT_REACTIVATABLE');
    } finally {
      release?.();
      await deleteClientApp(clientApp);
      await deleteAdminApp(app);
    }
  });
