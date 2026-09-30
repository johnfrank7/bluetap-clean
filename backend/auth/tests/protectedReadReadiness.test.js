const assert = require('node:assert/strict');
const test = require('node:test');
const { protectedReadReadiness } = require('../../../services/protectedReadReadiness');

const ready = (role = 'requester') => ({ authReady: true, tokenReady: true, uid: 'test-user', role, profileLoading: false, profile: { uid: 'test-user', role, accountStatus: 'active', managerStatus: 'active', distributorStatus: 'active', branchId: 'a' }, branchLoading: false, branch: { id: 'a', status: 'active' }, claims: { manager: true } });

for (const surface of ['dashboard', 'Active Orders', 'History', 'Messages']) {
  test(`Requester ${surface} cold readiness never attaches protected reads during hydration`, () => {
    const state = ready();
    assert.equal(protectedReadReadiness({ ...state, authReady: false, uid: '' }), 'AUTH_PENDING');
    assert.equal(protectedReadReadiness({ ...state, tokenReady: false }), 'ROLE_PENDING');
    assert.equal(protectedReadReadiness({ ...state, profileLoading: true, profile: null }), 'PROFILE_PENDING');
    assert.equal(protectedReadReadiness(state), 'READY');
    for (const uid of [null, undefined, '']) assert.equal(protectedReadReadiness({ ...state, uid }), 'GENUINE_DENIED');
    assert.equal(protectedReadReadiness({ ...state, profile: { ...state.profile, uid: 'old-account' } }), 'GENUINE_DENIED');
  });
}
for (const role of ['requester', 'distributor', 'manager']) {
  test(`${role} explicit and legacy account restrictions remain denied`, () => {
    const state = ready(role);
    for (const accountStatus of ['inactive', 'suspended', 'terminated', 'unknown']) assert.equal(protectedReadReadiness({ ...state, profile: { ...state.profile, accountStatus } }), 'GENUINE_DENIED');
    assert.equal(protectedReadReadiness({ ...state, profile: { ...state.profile, accountStatus: '', status: 'Disabled' } }), 'GENUINE_DENIED');
    assert.equal(protectedReadReadiness({ ...state, profile: { ...state.profile, mustChangePassword: true } }), 'GENUINE_DENIED');
  });
}
for (const role of ['distributor', 'manager']) {
  test(`${role} waits for authoritative active branch and rejects old branch`, () => {
    const state = ready(role);
    assert.equal(protectedReadReadiness({ ...state, branchLoading: true, branch: null }), 'BRANCH_PENDING');
    assert.equal(protectedReadReadiness(state), 'READY');
    assert.equal(protectedReadReadiness({ ...state, branch: { id: 'b', status: 'active' } }), 'GENUINE_DENIED');
    assert.equal(protectedReadReadiness({ ...state, branch: { id: 'a', status: 'inactive' } }), 'GENUINE_DENIED');
    if (role === 'manager') assert.equal(protectedReadReadiness({ ...state, claims: {} }), 'GENUINE_DENIED');
  });
}
