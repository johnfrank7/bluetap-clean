const assert = require('node:assert/strict');
const test = require('node:test');

const {
  PIN_GEOMETRY,
  connectorCoordinates,
  fitZoomWithMarkerPadding,
  pinTipTransform,
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

test('delivery and station pins anchor their bottom tips to the projected LatLng', () => {
  assert.deepEqual(PIN_GEOMETRY.delivery.iconAnchor, [PIN_GEOMETRY.delivery.width / 2, PIN_GEOMETRY.delivery.height]);
  assert.deepEqual(PIN_GEOMETRY.station.iconAnchor, [PIN_GEOMETRY.station.width / 2, PIN_GEOMETRY.station.height]);
  assert.deepEqual(PIN_GEOMETRY.stationSelected.iconAnchor, [PIN_GEOMETRY.stationSelected.width / 2, PIN_GEOMETRY.stationSelected.height]);
  assert.deepEqual(pinTipTransform(PIN_GEOMETRY.delivery), [{ translateX: -15 }, { translateY: -37 }]);
});

test('station colors are deterministic, distinct from delivery blue, and fit view reserves marker padding', () => {
  assert.equal(stationColorFor('branch-a'), stationColorFor('branch-a'));
  assert.notEqual(stationColorFor('branch-a'), '#187BCD');
  assert.equal(fitZoomWithMarkerPadding(14, 2), 13);
  assert.equal(fitZoomWithMarkerPadding(14, 1), 14);
});
