import React from 'react';
import { Image, PanResponder, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BLUETAP_COLORS, BLUETAP_LAYOUT } from '../constants/bluetapTheme';
import { haversineDistanceKm, normalizeLocation } from '../services/location';
import { useBlueTapTheme } from './BlueTapTheme';

const TILE_SIZE = 256;
const DEFAULT_MAP_HEIGHT = 250;
const DEFAULT_CENTER = { latitude: 10.267, longitude: 123.584 };
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const project = ({ latitude, longitude }, zoom) => {
  const scale = TILE_SIZE * 2 ** zoom;
  const sin = clamp(Math.sin((latitude * Math.PI) / 180), -0.9999, 0.9999);
  return {
    x: ((longitude + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
};
const unproject = ({ x, y }, zoom) => {
  const scale = TILE_SIZE * 2 ** zoom;
  const longitude = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  return { latitude: (180 / Math.PI) * Math.atan(Math.sinh(n)), longitude };
};
const fitZoom = (points) => {
  if (points.length < 2) return 14;
  const latitudes = points.map((point) => point.latitude);
  const longitudes = points.map((point) => point.longitude);
  const span = Math.max(
    Math.max(...latitudes) - Math.min(...latitudes),
    Math.max(...longitudes) - Math.min(...longitudes)
  );
  if (span > 0.5) return 9;
  if (span > 0.2) return 10;
  if (span > 0.08) return 11;
  if (span > 0.03) return 12;
  if (span > 0.012) return 13;
  return 14;
};
const roundedCoordinate = (value) => Math.round(value * 1_000_000) / 1_000_000;

export default function LocationMap({
  location,
  branches = [],
  selectedBranchId,
  onLocationChange,
  onSelectBranch,
  serviceRadiusKm,
  markerLabel = 'Your delivery location',
  themed = false,
  readOnly = false,
  height = DEFAULT_MAP_HEIGHT,
}) {
  const { colors, isDark } = useBlueTapTheme();
  const useDarkSurface = themed && isDark;
  const [width, setWidth] = React.useState(0);
  const [viewport, setViewport] = React.useState({ center: DEFAULT_CENTER, zoom: 13 });
  const requester = normalizeLocation(location);
  const branchPoints = branches
    .map((branch) => ({ ...normalizeLocation(branch), branch }))
    .filter((item) => Number.isFinite(item.latitude));
  const radius = Number(serviceRadiusKm);
  const radiusPoints =
    requester && Number.isFinite(radius) && radius > 0
      ? [
          { latitude: requester.latitude + radius / 111.32, longitude: requester.longitude },
          { latitude: requester.latitude - radius / 111.32, longitude: requester.longitude },
          {
            latitude: requester.latitude,
            longitude:
              requester.longitude +
              radius / (111.32 * Math.max(Math.cos((requester.latitude * Math.PI) / 180), 0.1)),
          },
          {
            latitude: requester.latitude,
            longitude:
              requester.longitude -
              radius / (111.32 * Math.max(Math.cos((requester.latitude * Math.PI) / 180), 0.1)),
          },
        ]
      : [];
  const points = [requester, ...branchPoints, ...radiusPoints].filter(Boolean);
  const pointSignature = points
    .map((point) => `${roundedCoordinate(point.latitude)},${roundedCoordinate(point.longitude)}`)
    .join('|');
  const viewportRef = React.useRef(viewport);
  const requesterRef = React.useRef(requester);
  const mapDragRef = React.useRef(null);
  const markerDragRef = React.useRef(null);

  viewportRef.current = viewport;
  requesterRef.current = requester;

  const fitView = React.useCallback(() => {
    const center = points.length
      ? {
          latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
          longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length,
        }
      : DEFAULT_CENTER;
    setViewport({ center, zoom: fitZoom(points) });
  }, [pointSignature]);

  React.useEffect(() => {
    fitView();
  }, [fitView]);

  const mapPanResponder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          mapDragRef.current = {
            startViewport: viewportRef.current,
            didMove: false,
          };
        },
        onPanResponderMove: (_event, gesture) => {
          const drag = mapDragRef.current;
          if (!drag || Math.abs(gesture.dx) + Math.abs(gesture.dy) < 4) return;
          drag.didMove = true;
          const origin = project(drag.startViewport.center, drag.startViewport.zoom);
          setViewport({
            center: unproject(
              { x: origin.x - gesture.dx, y: origin.y - gesture.dy },
              drag.startViewport.zoom
            ),
            zoom: drag.startViewport.zoom,
          });
        },
        onPanResponderRelease: (event) => {
          const drag = mapDragRef.current;
          mapDragRef.current = null;
          if (readOnly || drag?.didMove || !onLocationChange) return;
          const activeViewport = viewportRef.current;
          const centerPixel = project(activeViewport.center, activeViewport.zoom);
          const x = clamp(event.nativeEvent.locationX, 0, Math.max(width, 1));
          const y = clamp(event.nativeEvent.locationY, 0, height);
          onLocationChange(
            unproject(
              {
                x: centerPixel.x - Math.max(width, 1) / 2 + x,
                y: centerPixel.y - height / 2 + y,
              },
              activeViewport.zoom
            )
          );
        },
      }),
    [onLocationChange, width, readOnly, height]
  );

  const markerPanResponder = React.useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => Boolean(!readOnly && onLocationChange && requesterRef.current),
        onMoveShouldSetPanResponder: () => Boolean(!readOnly && onLocationChange && requesterRef.current),
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          const activeViewport = viewportRef.current;
          const currentLocation = requesterRef.current;
          markerDragRef.current = currentLocation
            ? { point: project(currentLocation, activeViewport.zoom), zoom: activeViewport.zoom }
            : null;
        },
        onPanResponderMove: (_event, gesture) => {
          const drag = markerDragRef.current;
          if (!drag || !onLocationChange || readOnly) return;
          onLocationChange(
            unproject(
              { x: drag.point.x + gesture.dx, y: drag.point.y + gesture.dy },
              drag.zoom
            )
          );
        },
        onPanResponderRelease: () => {
          markerDragRef.current = null;
        },
        onPanResponderTerminate: () => {
          markerDragRef.current = null;
        },
      }),
    [onLocationChange, readOnly]
  );

  const viewportWidth = Math.max(width, 1);
  const centerPixel = project(viewport.center, viewport.zoom);
  const left = centerPixel.x - viewportWidth / 2;
  const top = centerPixel.y - height / 2;
  const tiles = [];
  const minTileX = Math.floor(left / TILE_SIZE);
  const minTileY = Math.floor(top / TILE_SIZE);
  for (let x = minTileX; x <= Math.floor((left + viewportWidth) / TILE_SIZE); x += 1) {
    for (let y = minTileY; y <= Math.floor((top + height) / TILE_SIZE); y += 1) {
      const max = 2 ** viewport.zoom;
      if (y >= 0 && y < max) tiles.push({ x: ((x % max) + max) % max, rawX: x, y });
    }
  }

  const position = (point) => {
    const pixel = project(point, viewport.zoom);
    return { left: pixel.x - left, top: pixel.y - top };
  };

  const zoomBy = (amount) =>
    setViewport((current) => ({
      ...current,
      zoom: clamp(current.zoom + amount, MIN_ZOOM, MAX_ZOOM),
    }));

  const radiusPixels =
    requester && Number.isFinite(radius) && radius > 0
      ? (radius * 1000 * (TILE_SIZE * 2 ** viewport.zoom) * Math.cos((requester.latitude * Math.PI) / 180)) /
        40075016.686
      : 0;

  // Selected station connection line calculations
  const selectedBranchPoint = React.useMemo(() => {
    if (!selectedBranchId) return null;
    return branchPoints.find((bp) => bp.branch.id === selectedBranchId) || null;
  }, [selectedBranchId, branchPoints]);

  const distanceKmValue = React.useMemo(() => {
    if (!requester || !selectedBranchPoint?.branch) return null;
    return haversineDistanceKm(requester, selectedBranchPoint.branch);
  }, [requester, selectedBranchPoint]);

  const lineDetails = React.useMemo(() => {
    if (!requester || !selectedBranchPoint) return null;
    const reqPos = position(requester);
    const stationPos = position(selectedBranchPoint);
    const dx = stationPos.left - reqPos.left;
    const dy = stationPos.top - reqPos.top;
    const length = Math.sqrt(dx * dx + dy * dy);
    if (length < 2) return null;
    const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    const midX = (reqPos.left + stationPos.left) / 2;
    const midY = (reqPos.top + stationPos.top) / 2;
    return {
      left: reqPos.left,
      top: reqPos.top,
      width: length,
      angle,
      midX,
      midY,
    };
  }, [requester, selectedBranchPoint, viewport.center, viewport.zoom, left, top]);

  return (
    <View
      style={[
        styles.shell,
        useDarkSurface && { backgroundColor: colors.surface, borderColor: colors.border },
      ]}
      onLayout={(event) => setWidth(Math.max(0, event.nativeEvent.layout.width))}
    >
      <View
        accessibilityRole="image"
        accessibilityLabel="Interactive delivery and provider map"
        style={[styles.map, { height }]}
        {...mapPanResponder.panHandlers}
      >
        {tiles.map((tile) => (
          <Image
            key={`${viewport.zoom}-${tile.rawX}-${tile.y}`}
            source={{
              uri: `https://tile.openstreetmap.org/${viewport.zoom}/${tile.x}/${tile.y}.png`,
            }}
            style={[
              styles.tile,
              { left: tile.rawX * TILE_SIZE - left, top: tile.y * TILE_SIZE - top },
            ]}
          />
        ))}

        {!requester && !readOnly && (
          <View pointerEvents="none" style={styles.selectionPrompt}>
            <Text style={styles.selectionPromptText}>Tap to place a location pin</Text>
          </View>
        )}

        {/* Normal delivery area radius circle */}
        {requester && radiusPixels > 0 && (
          <View
            pointerEvents="none"
            style={[
              styles.radiusCircle,
              {
                ...position(requester),
                width: radiusPixels * 2,
                height: radiusPixels * 2,
                borderRadius: radiusPixels,
                marginLeft: -radiusPixels,
                marginTop: -radiusPixels,
              },
            ]}
          />
        )}

        {/* Geodesic straight line connecting requester and selected station */}
        {lineDetails && (
          <>
            <View
              pointerEvents="none"
              style={[
                styles.distanceLine,
                {
                  left: lineDetails.left,
                  top: lineDetails.top,
                  width: lineDetails.width,
                  transform: [{ rotate: `${lineDetails.angle}deg` }],
                },
              ]}
            />
            {distanceKmValue !== null && (
              <View
                pointerEvents="none"
                style={[
                  styles.distanceBadge,
                  {
                    left: lineDetails.midX,
                    top: lineDetails.midY,
                  },
                ]}
              >
                <Text style={styles.distanceBadgeText}>{distanceKmValue.toFixed(1)} km</Text>
              </View>
            )}
          </>
        )}

        {/* Station Landmark Pins (Red Landmark Pin) */}
        {branchPoints.map(({ branch, ...point }) => {
          const selected = branch.id === selectedBranchId;
          const pos = position(point);
          return (
            <TouchableOpacity
              key={branch.id}
              accessibilityRole="button"
              accessibilityLabel={`Station: ${branch.name}`}
              onPress={() => onSelectBranch?.(branch)}
              style={[
                styles.branchMarker,
                styles.stationPinContainer,
                { left: pos.left, top: pos.top },
                selected && styles.stationPinSelected,
              ]}
            >
              <View style={[styles.stationPinHead, selected && styles.stationPinHeadSelected]}>
                <View style={styles.stationPinInnerCircle}>
                  <Text style={styles.stationPinLetter}>S</Text>
                </View>
              </View>
              <View
                style={[styles.stationPinPoint, selected && styles.stationPinPointSelected]}
              />
              <Text
                numberOfLines={1}
                style={[styles.stationPinLabel, selected && styles.stationPinLabelSelected]}
              >
                {branch.name}
              </Text>
            </TouchableOpacity>
          );
        })}

        {/* Distinct BlueTap Requester Location Marker */}
        {requester && (
          <View
            accessibilityLabel={`${markerLabel}${readOnly ? '' : '. Drag to adjust.'}`}
            style={[styles.requesterMarker, styles.requesterPinContainer, position(requester)]}
            {...(!readOnly ? markerPanResponder.panHandlers : {})}
          >
            <View style={styles.requesterPulseRing} />
            <View style={styles.requesterPinHead}>
              <View style={styles.requesterPinDot} />
            </View>
            <Text style={styles.requesterMarkerLabel}>{markerLabel}</Text>
          </View>
        )}

        {requester && radiusPixels > 0 && (
          <View pointerEvents="none" style={[styles.radiusLabel, position(requester)]}>
            <Text style={styles.radiusLabelText}>Normal delivery area · {radius} km</Text>
          </View>
        )}

        <View style={styles.zoomControls}>
          <TouchableOpacity
            accessibilityLabel="Zoom in"
            onPress={() => zoomBy(1)}
            style={styles.zoomButton}
          >
            <Text style={styles.zoomText}>+</Text>
          </TouchableOpacity>
          <TouchableOpacity
            accessibilityLabel="Zoom out"
            onPress={() => zoomBy(-1)}
            style={styles.zoomButton}
          >
            <Text style={styles.zoomText}>−</Text>
          </TouchableOpacity>
        </View>

        <View pointerEvents="none" style={styles.attribution}>
          <Text style={styles.attributionText}>© OpenStreetMap contributors</Text>
        </View>
      </View>

      <View style={styles.mapFooter}>
        <Text style={[styles.help, useDarkSurface && { color: colors.textSecondary }]}>
          {readOnly
            ? 'Drag or zoom to inspect distance and stations.'
            : onLocationChange
            ? 'Tap to place, drag the pin to refine, or drag the map to pan.'
            : 'Drag or zoom to inspect the branch location.'}
        </Text>
        <TouchableOpacity
          onPress={fitView}
          style={[styles.fitButton, useDarkSurface && { backgroundColor: colors.primarySoft }]}
        >
          <Text
            style={[styles.fitText, useDarkSurface && { color: colors.primaryLight }]}
          >
            Fit view
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  shell: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    alignSelf: 'stretch',
    borderWidth: 1,
    borderColor: BLUETAP_COLORS.border,
    borderRadius: BLUETAP_LAYOUT.radius.lg,
    overflow: 'hidden',
    backgroundColor: BLUETAP_COLORS.surface,
  },
  map: {
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    overflow: 'hidden',
    backgroundColor: '#DCECF5',
    position: 'relative',
  },
  tile: {
    position: 'absolute',
    width: TILE_SIZE,
    height: TILE_SIZE,
  },
  // Distinct BlueTap Requester Marker
  requesterMarker: {},
  requesterPinContainer: {
    position: 'absolute',
    alignItems: 'center',
    zIndex: 5,
    transform: [{ translateX: -15 }, { translateY: -30 }],
  },
  requesterPulseRing: {
    position: 'absolute',
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(2, 132, 199, 0.2)',
    top: -4,
    left: -4,
  },
  requesterPinHead: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: BLUETAP_COLORS.primary,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 4,
  },
  requesterPinDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
  },
  requesterMarkerLabel: {
    fontSize: 10,
    fontWeight: '900',
    color: BLUETAP_COLORS.primary,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    marginTop: 3,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 1,
  },
  // Red Landmark Station Pins
  branchMarker: {},
  stationPinContainer: {
    position: 'absolute',
    alignItems: 'center',
    zIndex: 4,
    transform: [{ translateX: -14 }, { translateY: -30 }],
  },
  stationPinSelected: {
    zIndex: 6,
    transform: [{ translateX: -17 }, { translateY: -36 }],
  },
  stationPinHead: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EF4444',
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3,
    elevation: 3,
  },
  stationPinHeadSelected: {
    backgroundColor: '#DC2626',
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2.5,
    borderColor: '#FEF08A',
  },
  stationPinInnerCircle: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stationPinLetter: {
    color: '#DC2626',
    fontSize: 9,
    fontWeight: '900',
  },
  stationPinPoint: {
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderTopWidth: 6,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: '#EF4444',
    marginTop: -1,
  },
  stationPinPointSelected: {
    borderTopColor: '#DC2626',
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 8,
  },
  stationPinLabel: {
    fontSize: 9,
    fontWeight: '800',
    color: BLUETAP_COLORS.textPrimary,
    backgroundColor: 'rgba(255,255,255,0.92)',
    paddingHorizontal: 5,
    paddingVertical: 1.5,
    borderRadius: 4,
    marginTop: 2,
    maxWidth: 95,
  },
  stationPinLabelSelected: {
    fontWeight: '900',
    color: '#B91C1C',
    borderColor: '#F87171',
    borderWidth: 0.5,
  },
  // Geodesic Straight Distance Line & Badge
  distanceLine: {
    position: 'absolute',
    height: 3,
    backgroundColor: '#EF4444',
    zIndex: 2,
    borderRadius: 1.5,
    opacity: 0.85,
  },
  distanceBadge: {
    position: 'absolute',
    transform: [{ translateX: -30 }, { translateY: -12 }],
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#EF4444',
    zIndex: 5,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 2,
    elevation: 2,
  },
  distanceBadgeText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#DC2626',
  },
  radiusCircle: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(37,99,235,.72)',
    backgroundColor: 'rgba(37,99,235,.13)',
  },
  radiusLabel: {
    position: 'absolute',
    zIndex: 1,
    transform: [{ translateX: 8 }, { translateY: 9 }],
  },
  radiusLabelText: {
    fontSize: 10,
    fontWeight: '900',
    color: BLUETAP_COLORS.primary,
    backgroundColor: 'rgba(255,255,255,.92)',
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 5,
  },
  attribution: {
    position: 'absolute',
    right: 4,
    bottom: 4,
    backgroundColor: 'rgba(255,255,255,.82)',
    paddingHorizontal: 4,
    paddingVertical: 2,
  },
  attributionText: {
    fontSize: 8,
    color: BLUETAP_COLORS.muted,
  },
  selectionPrompt: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: 'rgba(255,255,255,.94)',
    borderRadius: BLUETAP_LAYOUT.radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: BLUETAP_COLORS.border,
  },
  selectionPromptText: {
    color: BLUETAP_COLORS.textPrimary,
    fontWeight: '800',
    fontSize: 12,
  },
  zoomControls: {
    position: 'absolute',
    right: 10,
    top: 10,
    overflow: 'hidden',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BLUETAP_COLORS.border,
    backgroundColor: '#FFF',
    zIndex: 6,
  },
  zoomButton: {
    width: 34,
    height: 31,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomText: {
    fontSize: 20,
    lineHeight: 23,
    fontWeight: '800',
    color: BLUETAP_COLORS.primary,
  },
  mapFooter: {
    minHeight: 46,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  help: {
    flex: 1,
    color: BLUETAP_COLORS.muted,
    fontSize: 11,
  },
  fitButton: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: BLUETAP_COLORS.primarySoft,
  },
  fitText: {
    color: BLUETAP_COLORS.primary,
    fontSize: 11,
    fontWeight: '900',
  },
});
