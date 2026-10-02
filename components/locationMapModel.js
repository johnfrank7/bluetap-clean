const STATION_PALETTE = Object.freeze(['#DC2626', '#EA580C', '#15803D', '#9333EA', '#B45309']);

const PIN_GEOMETRY = Object.freeze({
  delivery: Object.freeze({ width: 30, height: 37, iconAnchor: Object.freeze([15, 37]) }),
  station: Object.freeze({ width: 28, height: 33, iconAnchor: Object.freeze([14, 33]) }),
  stationSelected: Object.freeze({ width: 34, height: 41, iconAnchor: Object.freeze([17, 41]) }),
});

function pinTipTransform(config) {
  const anchor = config?.iconAnchor || [0, 0];
  return [{ translateX: -Number(anchor[0] || 0) }, { translateY: -Number(anchor[1] || 0) }];
}

function stationColorFor(branchIdentity) {
  const value = String(branchIdentity || 'station');
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = ((hash * 31) + value.charCodeAt(index)) >>> 0;
  return STATION_PALETTE[hash % STATION_PALETTE.length];
}

function connectorCoordinates(delivery, station) {
  if (![delivery?.latitude, delivery?.longitude, station?.latitude, station?.longitude].every(Number.isFinite)) return [];
  return [delivery, station];
}

function fitZoomWithMarkerPadding(baseZoom, pointCount) {
  return pointCount > 1 ? Math.max(3, Number(baseZoom) - 1) : Number(baseZoom);
}

module.exports = {
  PIN_GEOMETRY,
  STATION_PALETTE,
  connectorCoordinates,
  fitZoomWithMarkerPadding,
  pinTipTransform,
  stationColorFor,
};
