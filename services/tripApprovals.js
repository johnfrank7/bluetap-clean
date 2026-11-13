import React from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth, db } from '../firebase';
import { resolveLocalQaClient } from './stagingConfig';
import { getApiBaseUrl, getApiUrl } from './apiClientConfig';

// A local hostname or public flag alone never authorizes experimental writes.
export async function getVerifiedTripMode() {
  const qa = resolveLocalQaClient();
  if (!qa) return 'default';
  if (getApiBaseUrl() !== qa.apiUrl || auth.app?.options?.projectId !== qa.firebase.projectId || db.app?.options?.projectId !== qa.firebase.projectId ||
      globalThis.__bluetapLocalQaAuthConnections?.get(auth) !== qa.authUrl ||
      globalThis.__bluetapLocalQaFirestoreConnections?.get(db) !== `${qa.firestoreHost}:${qa.firestorePort}`) throw new Error('The local emulator connection could not be verified.');
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sign in to verify trip availability.');
  const response = await fetch(getApiUrl('/api/trip-capability'), { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  const result = await response.json().catch(() => null);
  if (!response.ok || typeof result?.tripApprovalAvailable !== 'boolean') throw new Error('Trip availability could not be verified.');
  if (result.tripApprovalAvailable && result.emulatorProjectId !== qa.firebase.projectId) throw new Error('The backend emulator project does not match this app.');
  return result.tripApprovalAvailable ? 'trip' : 'default';
}

export function useVerifiedTripMode() {
  const [mode, setMode] = React.useState('checking');
  React.useEffect(() => {
    let active = true; let sequence = 0;
    const stop = onAuthStateChanged(auth, () => {
      const current = ++sequence; setMode('checking');
      getVerifiedTripMode().then((value) => { if (active && current === sequence) setMode(value); })
        .catch(() => { if (active && current === sequence) setMode('blocked'); });
    });
    return () => { active = false; sequence += 1; stop(); };
  }, []);
  return mode;
}

async function tripRequest(path, method = 'GET', body) {
  if (await getVerifiedTripMode() !== 'trip') throw new Error('Trip actions are unavailable in this environment.');
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error('Sign in to continue.');
  let response;
  try { response = await fetch(getApiUrl(path), { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store' }); }
  catch (cause) { const error = new Error('The trip request could not be confirmed. Retry the same request.'); error.uncertain = true; throw error; }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) { const error = new Error(result?.error?.message || 'The trip action could not be confirmed.'); error.code = result?.error?.reason || 'service-unavailable'; error.uncertain = response.status >= 500 || !result; throw error; }
  return result;
}

export function tripMutationId() {
  if (typeof globalThis.crypto?.randomUUID !== 'function') throw new Error('A secure request ID is unavailable.');
  return globalThis.crypto.randomUUID();
}
// The entered date and time are Philippine local time, independent of device zone.
export function parseManilaTripTime(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/.exec(String(value || '').trim());
  if (!match) return null;
  const [, y, m, d, h, minute] = match.map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || minute > 59 || y < 2000) return null;
  const millis = Date.UTC(y, m - 1, d, h - 8, minute); const local = new Date(millis + 8 * 3600000);
  if (local.getUTCFullYear() !== y || local.getUTCMonth() !== m - 1 || local.getUTCDate() !== d || local.getUTCHours() !== h || local.getUTCMinutes() !== minute) return null;
  return new Date(millis);
}
function confirmedProposal(result, expected) {
  const proposal = result?.proposal;
  if (!proposal || proposal.status !== 'pending' || proposal.orderId !== expected.orderId || proposal.id !== expected.clientMutationId || proposal.scheduledAt !== expected.scheduledAt || (expected.tripId && (proposal.tripId !== expected.tripId || proposal.distributorUid !== expected.distributorUid || proposal.reason !== expected.reason))) {
    const error = new Error('The proposal could not be confirmed. Retry the same details.'); error.uncertain = true; throw error;
  }
  return result;
}
export const getDistributorProposal = (orderId) => tripRequest(`/api/distributor/orders?rescheduleProposalOrderId=${encodeURIComponent(orderId)}`);
export const proposeDistributorSchedule = async (orderId, scheduledAt, clientMutationId) => confirmedProposal(await tripRequest('/api/distributor/orders', 'PATCH', { action: 'propose-reschedule', orderId, scheduledAt, clientMutationId }), { orderId, scheduledAt, clientMutationId });
export const getManagerTripOptions = (orderId, proposalId) => tripRequest(`/api/manager/dispatch-orders?tripApprovalOrderId=${encodeURIComponent(orderId)}&tripApprovalProposalId=${encodeURIComponent(proposalId)}`);
export const getManagerAdminProposals = (orderId) => tripRequest(`/api/manager/dispatch-orders?adminOverrideOrderId=${encodeURIComponent(orderId)}`);
export const decideManagerProposal = (orderId, proposalId, action, tripId) => tripRequest('/api/manager/dispatch-orders', 'PATCH', { orderId, proposalId, action, ...(tripId ? { tripId } : {}) });
export const getAdminTripOptions = (orderId) => tripRequest(`/api/admin/dispatch-override?orderId=${encodeURIComponent(orderId)}&tripOptions=1`);
export const proposeAdminTrip = async (body) => confirmedProposal(await tripRequest('/api/admin/dispatch-override', 'POST', { action: 'propose-trip-override', ...body }), body);

const lifecycleRoutes = { manager: '/api/manager/dispatch-orders', distributor: '/api/distributor/orders' };
const lifecycleActions = { manager: ['confirm-trip-loading', 'confirm-trip-unloading'], distributor: ['report-trip-loading', 'report-trip-unloading'] };
export async function getTripLifecycle(role) {
  if (!lifecycleRoutes[role]) throw new Error('Trip role is invalid.');
  const result = await tripRequest(`${lifecycleRoutes[role]}?tripLifecycle=1`);
  if (!Array.isArray(result.trips) || result.trips.some((trip) => !trip || typeof trip.tripId !== 'string' || !trip.tripId || typeof trip.distributorUid !== 'string' || !trip.distributorUid || !(trip.updatedAt === null || (typeof trip.updatedAt === 'string' && Number.isFinite(Date.parse(trip.updatedAt)))) || !['resource_reserved', 'loading_reported', 'in_transit', 'return_reported', 'closed'].includes(trip.state))) throw new Error('Trip status could not be verified.');
  return result.trips;
}
export async function updateTripLifecycle(role, tripId, action) {
  if (!lifecycleActions[role]?.includes(action) || typeof tripId !== 'string' || !tripId || tripId.includes('/')) throw new Error('Trip action is invalid.');
  const result = await tripRequest(lifecycleRoutes[role], 'PATCH', { tripId, action });
  if (result.success !== true || result.tripId !== tripId) { const error = new Error('The trip action could not be confirmed. Refresh and retry.'); error.uncertain = true; throw error; }
  return result;
}

export async function getTripPreparation() {
  const data = await tripRequest('/api/manager/dispatch-orders?tripPreparation=1');
  if (!Array.isArray(data.trips) || !Array.isArray(data.orders) || !Array.isArray(data.eligibleDistributorUids) || data.eligibleDistributorUids.some((uid) => typeof uid !== 'string' || !uid) || !Array.isArray(data.resources) || data.resources.length !== 2 ||
      data.resources.some((r) => typeof r?.id !== 'string' || !r.id || typeof r.available !== 'boolean') || new Set(data.resources.map((r) => r.id)).size !== 2 ||
      data.trips.some((t) => !t || typeof t.tripId !== 'string' || typeof t.distributorUid !== 'string' || !['planning', 'approved'].includes(t.state) || !Number.isSafeInteger(t.revision) || typeof t.verified !== 'boolean' || !Array.isArray(t.members) || (t.verified && (!Number.isSafeInteger(t.standardContainers) || t.standardContainers < 0 || t.standardContainers > 60 || typeof t.hasOtherCargo !== 'boolean'))) ||
      data.orders.some((o) => !o || typeof o.orderId !== 'string' || typeof o.verified !== 'boolean' || !Array.isArray(o.cargo) || (o.verified && (!Number.isSafeInteger(o.containers) || o.containers < 0)))) throw new Error('Trip preparation data could not be verified.');
  return data;
}
const validCapacityId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 128 && value.trim() === value && !value.includes('/');
function validCapacityTrip(trip) {
  return !!trip && validCapacityId(trip.tripId) && validCapacityId(trip.distributorUid) && ['planning', 'approved', 'resource_reserved', 'loading_reported', 'in_transit', 'return_reported'].includes(trip.state) &&
    (trip.plannedDeparture === null || (typeof trip.plannedDeparture === 'string' && Number.isFinite(Date.parse(trip.plannedDeparture)))) &&
    typeof trip.verified === 'boolean' && typeof trip.eligible === 'boolean' && ['unscheduled', 'available', 'occupied', 'reserved'].includes(trip.resourceStatus) &&
    (['planning', 'approved'].includes(trip.state) ? trip.resourceStatus !== 'reserved' : trip.resourceStatus === 'reserved') &&
    ((trip.resourceStatus === 'unscheduled') === (trip.plannedDeparture === null)) && ['unknown', 'not_required', 'required', 'confirmed'].includes(trip.mixedReviewStatus) &&
    (trip.verified ? Number.isSafeInteger(trip.standardContainers) && trip.standardContainers >= 0 && trip.standardContainers <= 60 && typeof trip.hasOtherCargo === 'boolean' && (trip.hasOtherCargo ? ['required', 'confirmed'].includes(trip.mixedReviewStatus) : trip.mixedReviewStatus === 'not_required') : trip.standardContainers === null && trip.hasOtherCargo === null && trip.mixedReviewStatus === 'unknown');
}
export async function getManagerTripCapacity(tripId = '') {
  if (tripId !== '' && !validCapacityId(tripId)) throw new Error('Trip selection is invalid.');
  const data = await tripRequest(`/api/manager/dispatch-orders?tripPreparation=1&capacityOnly=1${tripId ? `&tripId=${encodeURIComponent(tripId)}` : ''}`);
  const trip = data?.selectedTrip;
  if (!Array.isArray(data?.distributors) || data.distributors.some((item) => !validCapacityId(item?.distributorUid) || !Number.isSafeInteger(item.tripCount) || item.tripCount < 1 || !Number.isSafeInteger(item.inProgressCount) || item.inProgressCount < 0 || item.inProgressCount > item.tripCount || (item.soleActiveTrip != null && (tripId || item.tripCount !== 1 || item.inProgressCount !== 1 || !validCapacityTrip(item.soleActiveTrip) || item.soleActiveTrip.distributorUid !== item.distributorUid || ['planning', 'approved'].includes(item.soleActiveTrip.state)))) || new Set(data.distributors.map((item) => item.distributorUid)).size !== data.distributors.length ||
      !(trip === null || (validCapacityTrip(trip) && trip.tripId === tripId))) throw new Error('Trip capacity could not be verified.');
  if (trip && !data.distributors.some((item) => item.distributorUid === trip.distributorUid)) throw new Error('Trip capacity could not be verified.');
  return data;
}
export async function prepareManagerTrip(body) {
  if (!['create-trip', 'schedule-trip', 'assign-distributor', 'approve-trip', 'reserve-trip-resource'].includes(body?.action) || typeof body.tripId !== 'string' || !body.tripId || body.tripId.includes('/')) throw new Error('Trip action is invalid.');
  const result = await tripRequest('/api/manager/dispatch-orders', 'PATCH', body);
  const confirmed = body.action === 'assign-distributor' ? result.order?.id === body.orderId && result.order?.assignedDistributorUid === body.distributorUid : result.success === true && result.tripId === body.tripId;
  if (!confirmed) { const error = new Error('The trip action could not be confirmed. Refresh before retrying.'); error.uncertain = true; throw error; }
  return result;
}
