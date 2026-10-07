const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '../../..');
const read = (relPath) => readFileSync(resolve(root, relPath), 'utf8');

// Load canonical pricing normalization
const { normalizeBranchDeliveryPricing } = require('../../../services/deliveryPricing');

// Parse location ranking functions from services/location.js
const locationSource = read('services/location.js');

function loadLocationRankingFunctions() {
  const asCoordinate = (value, minimum, maximum) => {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
  };

  const normalizeLocation = (location) => {
    const latitude = asCoordinate(location?.latitude, -90, 90);
    const longitude = asCoordinate(location?.longitude, -180, 180);
    const accuracy = Number.isFinite(Number(location?.accuracy)) && Number(location?.accuracy) >= 0 ? Number(location.accuracy) : null;
    return latitude === null || longitude === null ? null : { latitude, longitude, ...(accuracy !== null ? { accuracy } : {}) };
  };

  const haversineDistanceKm = (fromValue, toValue) => {
    const from = normalizeLocation(fromValue);
    const to = normalizeLocation(toValue);
    if (!from || !to) return null;
    const radians = (degrees) => degrees * (Math.PI / 180);
    const latitudeDelta = radians(to.latitude - from.latitude);
    const longitudeDelta = radians(to.longitude - from.longitude);
    const a = Math.sin(latitudeDelta / 2) ** 2
      + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
    const bounded = Math.min(1, Math.max(0, a));
    return Math.round(6371 * 2 * Math.atan2(Math.sqrt(bounded), Math.sqrt(1 - bounded)) * 10) / 10;
  };

  const rankProviderBranches = (branches, location) => {
    const normLoc = normalizeLocation(location);
    if (!normLoc || !Array.isArray(branches)) return [];

    const candidates = branches
      .map((branch) => {
        const distanceKm = haversineDistanceKm(normLoc, branch);
        if (distanceKm === null) return null;
        const pricing = normalizeBranchDeliveryPricing(branch);
        const serviceRadiusKm = pricing.serviceRadiusKm;
        const isWithinNormalArea = distanceKm <= serviceRadiusKm;
        return {
          ...branch,
          distanceKm,
          serviceRadiusKm,
          withinServiceArea: isWithinNormalArea,
          isWithinNormalArea,
          requiresApproval: !isWithinNormalArea,
        };
      })
      .filter(Boolean);

    const eligible = candidates
      .filter((branch) => branch.isWithinNormalArea)
      .sort((left, right) => left.distanceKm - right.distanceKm);

    const outside = candidates
      .filter((branch) => !branch.isWithinNormalArea)
      .sort((left, right) => left.distanceKm - right.distanceKm);

    const hasEligible = eligible.length > 0;

    const markedEligible = eligible.map((branch, index) => ({
      ...branch,
      isRecommended: index === 0,
      isNearestInCoverage: index === 0,
    }));

    const markedOutside = outside.map((branch, index) => ({
      ...branch,
      isRecommended: false,
      isNearestInCoverage: false,
      isClosestOutside: !hasEligible && index === 0,
    }));

    return [...markedEligible, ...markedOutside];
  };

  return { normalizeLocation, haversineDistanceKm, rankProviderBranches };
}

const { rankProviderBranches, haversineDistanceKm } = loadLocationRankingFunctions();

test('Provider ranking: Branch B (1.9 km, 3 km radius) ranks above Branch A (1.5 km, 1 km radius)', () => {
  // Toledo reference coordinate
  const requesterLocation = { latitude: 10.375, longitude: 123.635 };

  // Branch A: ~1.5 km away, service radius 1.0 km -> outside coverage
  const branchA = {
    id: 'branch-a',
    name: 'Branch A (Close but small radius)',
    latitude: 10.388,
    longitude: 123.635,
    serviceRadiusKm: 1.0,
  };

  // Branch B: ~1.9 km away, service radius 3.0 km -> in coverage
  const branchB = {
    id: 'branch-b',
    name: 'Branch B (Slightly further but in coverage)',
    latitude: 10.392,
    longitude: 123.635,
    serviceRadiusKm: 3.0,
  };

  const distA = haversineDistanceKm(requesterLocation, branchA);
  const distB = haversineDistanceKm(requesterLocation, branchB);

  // Assert raw geometric distances
  assert.ok(distA < distB, `Branch A (${distA} km) must be geometrically closer than Branch B (${distB} km)`);
  assert.ok(distA > branchA.serviceRadiusKm, 'Branch A must be outside its service radius');
  assert.ok(distB <= branchB.serviceRadiusKm, 'Branch B must be within its service radius');

  const ranked = rankProviderBranches([branchA, branchB], requesterLocation);

  assert.equal(ranked.length, 2);

  // Branch B must be ranked FIRST because it is in-coverage
  assert.equal(ranked[0].id, 'branch-b');
  assert.equal(ranked[0].isRecommended, true);
  assert.equal(ranked[0].isNearestInCoverage, true);
  assert.equal(ranked[0].withinServiceArea, true);
  assert.equal(ranked[0].requiresApproval, false);

  // Branch A must be ranked SECOND because it is outside coverage
  assert.equal(ranked[1].id, 'branch-a');
  assert.equal(ranked[1].isRecommended, false);
  assert.equal(ranked[1].withinServiceArea, false);
  assert.equal(ranked[1].requiresApproval, true);
});

test('Provider ranking: multiple in-coverage branches are sorted by distance with only one nearest badge', () => {
  const requesterLocation = { latitude: 10.375, longitude: 123.635 };

  const branches = [
    { id: 'far-in', name: 'Far In', latitude: 10.395, longitude: 123.635, serviceRadiusKm: 5.0 },
    { id: 'near-in', name: 'Near In', latitude: 10.385, longitude: 123.635, serviceRadiusKm: 5.0 },
    { id: 'mid-in', name: 'Mid In', latitude: 10.390, longitude: 123.635, serviceRadiusKm: 5.0 },
  ];

  const ranked = rankProviderBranches(branches, requesterLocation);

  assert.equal(ranked.length, 3);
  assert.equal(ranked[0].id, 'near-in');
  assert.equal(ranked[0].isRecommended, true);
  assert.equal(ranked[0].isNearestInCoverage, true);

  assert.equal(ranked[1].id, 'mid-in');
  assert.equal(ranked[1].isRecommended, false);

  assert.equal(ranked[2].id, 'far-in');
  assert.equal(ranked[2].isRecommended, false);
});

test('Provider ranking: out-of-range branches never receive nearest provider badge', () => {
  const requesterLocation = { latitude: 10.375, longitude: 123.635 };

  const outsideBranches = [
    { id: 'outside-1', name: 'Outside 1', latitude: 10.450, longitude: 123.635, serviceRadiusKm: 2.0 },
    { id: 'outside-2', name: 'Outside 2', latitude: 10.500, longitude: 123.635, serviceRadiusKm: 2.0 },
  ];

  const ranked = rankProviderBranches(outsideBranches, requesterLocation);

  assert.equal(ranked.length, 2);
  // Neither branch should receive isRecommended: true
  assert.equal(ranked[0].isRecommended, false);
  assert.equal(ranked[1].isRecommended, false);

  // The closest outside branch is flagged for fallback UI
  assert.equal(ranked[0].isClosestOutside, true);
  assert.equal(ranked[1].isClosestOutside, false);
});

test('Provider ranking: services/location.js exports rankProviderBranches and rankBranchesByDistance alias', () => {
  assert.match(locationSource, /export const rankProviderBranches\s*=/);
  assert.match(locationSource, /export const rankBranchesByDistance\s*=\s*\(branches,\s*location\)\s*=>\s*rankProviderBranches\(branches,\s*location\)/);
});

test('Requester request form uses rankProviderBranches and branch.isRecommended badge', () => {
  const requestFormSource = read('app/requester/requestform.jsx');

  // Verify import
  assert.match(requestFormSource, /rankProviderBranches/);

  // Verify useMemo calls rankProviderBranches
  assert.match(requestFormSource, /rankProviderBranches\(catalog\?\.branches\s*\|\|\s*\[\],\s*deliveryLocation\)/);

  // Verify badge checks branch.isRecommended instead of index === 0
  assert.match(requestFormSource, /\{branch\.isRecommended\s*&&\s*<Text style=\{styles\.nearest\}>Nearest provider<\/Text>\}/);
  assert.doesNotMatch(requestFormSource, /\{index===0&&<Text style=\{styles\.nearest\}>Nearest provider<\/Text>\}/);
});
