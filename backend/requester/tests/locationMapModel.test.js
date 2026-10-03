const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PIN_GEOMETRY,
  branchMapDataForRequest,
  connectorCoordinates,
  fitZoomWithMarkerPadding,
  pinBodyPosition,
  projectedOverlayGeometry,
  stationColorFor,
} = require('../../../components/locationMapModel');

test('map connector reuses the exact delivery and station coordinate objects', () => {
  const delivery = { latitude: 10.26712345, longitude: 123.58498765 };
  const station = { latitude: 10.30123456, longitude: 123.61234567 };
  const endpoints = connectorCoordinates(delivery, station);
  assert.equal(endpoints[0], delivery);
  assert.equal(endpoints[1], station);
  assert.deepEqual(endpoints, [delivery, station]);
  assert.deepEqual(connectorCoordinates(delivery, { latitude: null, longitude: 1 }), []);
});

test('request details use the authoritative branch location when an order snapshot is missing', () => {
  const order = { branchId: 'branch-b', waterStation: 'BlueTap B' };
  const branches = [
    { id: 'branch-a', name: 'BlueTap A', latitude: 10.1, longitude: 123.1 },
    { id: 'branch-b', name: 'BlueTap B', latitude: 10.2, longitude: 123.2, privateNote: 'not projected' },
  ];
  assert.deepEqual(branchMapDataForRequest(order, branches), {
    id: 'branch-b',
    name: 'BlueTap B',
    location: { latitude: 10.2, longitude: 123.2 },
  });
});

test('request details preserve a valid branch snapshot and omit a station when coordinates are unavailable', () => {
  const snapshotOrder = {
    currentBranchId: 'branch-b',
    currentBranchName: 'BlueTap B',
    branchLocation: { latitude: '10.25', longitude: '123.25' },
  };
  assert.deepEqual(branchMapDataForRequest(snapshotOrder, []), {
    id: 'branch-b',
    name: 'BlueTap B',
    location: { latitude: 10.25, longitude: 123.25 },
  });
  assert.equal(branchMapDataForRequest({ branchId: 'missing' }, []), null);
  assert.equal(branchMapDataForRequest(null, []), null);
});

test('projected circle center, marker tips, connector endpoints, and midpoint share one geometry', () => {
  const deliveryPoint = { left: 42.25, top: 91.5 };
  const stationPoint = { left: 212.75, top: 36.25 };
  const geometry = projectedOverlayGeometry(deliveryPoint, stationPoint);
  assert.equal(geometry.deliveryPoint, deliveryPoint);
  assert.equal(geometry.stationPoint, stationPoint);
  assert.deepEqual(geometry.midpoint, {
    left: (deliveryPoint.left + stationPoint.left) / 2,
    top: (deliveryPoint.top + stationPoint.top) / 2,
  });
  const radians = geometry.line.angle * Math.PI / 180;
  const halfX = Math.cos(radians) * geometry.line.width / 2;
  const halfY = Math.sin(radians) * geometry.line.width / 2;
  assert.ok(Math.abs((geometry.midpoint.left - halfX) - deliveryPoint.left) < 1e-9);
  assert.ok(Math.abs((geometry.midpoint.top - halfY) - deliveryPoint.top) < 1e-9);
  assert.ok(Math.abs((geometry.midpoint.left + halfX) - stationPoint.left) < 1e-9);
  assert.ok(Math.abs((geometry.midpoint.top + halfY) - stationPoint.top) < 1e-9);
});

test('delivery and station pins anchor their bottom tips to the projected LatLng', () => {
  assert.deepEqual(PIN_GEOMETRY.delivery.iconAnchor, [PIN_GEOMETRY.delivery.width / 2, PIN_GEOMETRY.delivery.height]);
  assert.deepEqual(PIN_GEOMETRY.station.iconAnchor, [PIN_GEOMETRY.station.width / 2, PIN_GEOMETRY.station.height]);
  assert.deepEqual(PIN_GEOMETRY.stationSelected.iconAnchor, [PIN_GEOMETRY.stationSelected.width / 2, PIN_GEOMETRY.stationSelected.height]);
  const point = { left: 91.25, top: 142.75 };
  const deliveryBody = pinBodyPosition(point, PIN_GEOMETRY.delivery);
  const stationBody = pinBodyPosition(point, PIN_GEOMETRY.stationSelected);
  assert.deepEqual(deliveryBody, { left: 76.25, top: 105.75, width: 30, height: 37 });
  assert.deepEqual(stationBody, { left: 74.25, top: 101.75, width: 34, height: 41 });
  assert.equal(deliveryBody.left + (deliveryBody.width / 2), point.left);
  assert.equal(deliveryBody.top + deliveryBody.height, point.top);
  assert.equal(stationBody.left + (stationBody.width / 2), point.left);
  assert.equal(stationBody.top + stationBody.height, point.top);
});

test('station colors are deterministic, distinct from delivery blue, and fit view reserves marker padding', () => {
  assert.equal(stationColorFor('branch-a'), stationColorFor('branch-a'));
  assert.notEqual(stationColorFor('branch-a'), '#187BCD');
  assert.equal(fitZoomWithMarkerPadding(14, 2), 13);
  assert.equal(fitZoomWithMarkerPadding(14, 1), 14);
});
