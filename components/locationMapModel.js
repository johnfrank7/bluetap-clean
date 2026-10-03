const STATION_PALETTE = Object.freeze(['#DC2626', '#EA580C', '#15803D', '#9333EA', '#B45309']);

const PIN_GEOMETRY = Object.freeze({
  delivery: Object.freeze({ width: 30, height: 37, iconAnchor: Object.freeze([15, 37]) }),
  station: Object.freeze({ width: 28, height: 33, iconAnchor: Object.freeze([14, 33]) }),
  stationSelected: Object.freeze({ width: 34, height: 41, iconAnchor: Object.freeze([17, 41]) }),
});

function pinBodyPosition(point, config) {
  if (![point?.left, point?.top, config?.width, config?.height].every(Number.isFinite)) return null;
  return {
    left: point.left - (config.width / 2),
    top: point.top - config.height,
    width: config.width,
    height: config.height,
  };
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

function normalizedCoordinates(value) {
  const latitude = Number(value?.latitude);
  const longitude = Number(value?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;
  return { latitude, longitude };
}

function branchMapDataForRequest(request = {}, branches = []) {
  const source = request && typeof request === 'object' ? request : {};
  const branchId = String(source.currentBranchId || source.branchId || '').trim();
  const branch = (Array.isArray(branches) ? branches : []).find((item) => (
    String(item?.id || item?.branchId || '').trim() === branchId
  ));
  const location = normalizedCoordinates(source.currentBranchLocation || source.branchLocation)
    || normalizedCoordinates(branch?.location || branch);
  if (!location) return null;
  return {
    id: branchId || String(branch?.id || branch?.branchId || 'station'),
    name: String(
      source.waterStation
      || source.currentBranchName
      || source.currentBranchNameSnapshot
      || source.branchNameSnapshot
      || branch?.name
      || 'Water Station'
    ),
    location,
  };
}

function projectedOverlayGeometry(deliveryPoint, stationPoint, lineThickness = 3) {
  if (![deliveryPoint?.left, deliveryPoint?.top, stationPoint?.left, stationPoint?.top].every(Number.isFinite)) return null;
  const dx = stationPoint.left - deliveryPoint.left;
  const dy = stationPoint.top - deliveryPoint.top;
  const length = Math.sqrt((dx * dx) + (dy * dy));
  if (length < 2) return null;
  const midpoint = { left: (deliveryPoint.left + stationPoint.left) / 2, top: (deliveryPoint.top + stationPoint.top) / 2 };
  return {
    deliveryPoint,
    stationPoint,
    midpoint,
    line: {
      left: midpoint.left - (length / 2),
      top: midpoint.top - (lineThickness / 2),
      width: length,
      height: lineThickness,
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    },
  };
}

function fitZoomWithMarkerPadding(baseZoom, pointCount) {
  return pointCount > 1 ? Math.max(3, Number(baseZoom) - 1) : Number(baseZoom);
}

module.exports = {
  PIN_GEOMETRY,
  STATION_PALETTE,
  branchMapDataForRequest,
  connectorCoordinates,
  fitZoomWithMarkerPadding,
  pinBodyPosition,
  projectedOverlayGeometry,
  stationColorFor,
};
