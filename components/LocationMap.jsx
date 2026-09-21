import React from 'react';
import { Image, Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { BLUETAP_COLORS, BLUETAP_LAYOUT } from '../constants/bluetapTheme';
import { normalizeLocation } from '../services/location';

const TILE_SIZE = 256;
const MAP_HEIGHT = 250;
const DEFAULT_CENTER = { latitude: 10.267, longitude: 123.584 };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const project = ({ latitude, longitude }, zoom) => {
  const scale = TILE_SIZE * 2 ** zoom;
  const sin = Math.sin(latitude * Math.PI / 180);
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
  const span = Math.max(Math.max(...latitudes) - Math.min(...latitudes), Math.max(...longitudes) - Math.min(...longitudes));
  if (span > 0.5) return 9;
  if (span > 0.2) return 10;
  if (span > 0.08) return 11;
  if (span > 0.03) return 12;
  if (span > 0.012) return 13;
  return 14;
};

export default function LocationMap({ location, branches = [], selectedBranchId, onLocationChange, onSelectBranch }) {
  const [width, setWidth] = React.useState(320);
  const [fitVersion, setFitVersion] = React.useState(0);
  const requester = normalizeLocation(location);
  const branchPoints = branches.map((branch) => ({ ...normalizeLocation(branch), branch })).filter((item) => Number.isFinite(item.latitude));
  const points = [requester, ...branchPoints].filter(Boolean);
  const center = points.length ? {
    latitude: points.reduce((sum, point) => sum + point.latitude, 0) / points.length,
    longitude: points.reduce((sum, point) => sum + point.longitude, 0) / points.length,
  } : DEFAULT_CENTER;
  const zoom = fitZoom(points);
  const centerPixel = project(center, zoom);
  const tiles = [];
  const left = centerPixel.x - width / 2;
  const top = centerPixel.y - MAP_HEIGHT / 2;
  const minTileX = Math.floor(left / TILE_SIZE);
  const minTileY = Math.floor(top / TILE_SIZE);
  for (let x = minTileX; x <= Math.floor((left + width) / TILE_SIZE); x += 1) {
    for (let y = minTileY; y <= Math.floor((top + MAP_HEIGHT) / TILE_SIZE); y += 1) {
      const max = 2 ** zoom;
      if (y >= 0 && y < max) tiles.push({ x: ((x % max) + max) % max, rawX: x, y });
    }
  }
  const position = (point) => {
    const pixel = project(point, zoom);
    return { left: pixel.x - left, top: pixel.y - top };
  };
  const chooseLocation = (event) => {
    if (!onLocationChange) return;
    const x = clamp(event.nativeEvent.locationX, 0, width);
    const y = clamp(event.nativeEvent.locationY, 0, MAP_HEIGHT);
    onLocationChange(unproject({ x: left + x, y: top + y }, zoom));
  };
  return <View key={fitVersion} style={styles.shell} onLayout={(event) => setWidth(Math.max(280, event.nativeEvent.layout.width))}>
    <Pressable accessibilityRole="image" accessibilityLabel="Delivery and provider map" onPress={chooseLocation} style={styles.map}>
      {tiles.map((tile) => <Image key={`${zoom}-${tile.rawX}-${tile.y}`} source={{ uri: `https://tile.openstreetmap.org/${zoom}/${tile.x}/${tile.y}.png` }} style={[styles.tile, { left: tile.rawX * TILE_SIZE - left, top: tile.y * TILE_SIZE - top }]} />)}
      {requester && <View pointerEvents="none" style={[styles.requesterMarker, position(requester)]}><View style={styles.requesterDot} /><Text style={styles.markerLabel}>Delivery</Text></View>}
      {branchPoints.map(({ branch, ...point }) => {
        const selected = branch.id === selectedBranchId;
        return <TouchableOpacity key={branch.id} accessibilityRole="button" accessibilityLabel={`Select ${branch.name}`} onPress={(event) => { event.stopPropagation?.(); onSelectBranch?.(branch); }} style={[styles.branchMarker, position(point), selected && styles.branchMarkerSelected]}>
          <Text style={styles.branchMarkerText}>B</Text>
        </TouchableOpacity>;
      })}
      <View pointerEvents="none" style={styles.attribution}><Text style={styles.attributionText}>© OpenStreetMap contributors</Text></View>
    </Pressable>
    <View style={styles.mapFooter}><Text style={styles.help}>{onLocationChange ? 'Tap the map to adjust the delivery pin.' : 'Branch location preview'}</Text><TouchableOpacity onPress={() => setFitVersion((value) => value + 1)} style={styles.fitButton}><Text style={styles.fitText}>Fit view</Text></TouchableOpacity></View>
  </View>;
}

const styles = StyleSheet.create({
  shell:{borderWidth:1,borderColor:BLUETAP_COLORS.border,borderRadius:BLUETAP_LAYOUT.radius.lg,overflow:'hidden',backgroundColor:BLUETAP_COLORS.surface},
  map:{height:MAP_HEIGHT,overflow:'hidden',backgroundColor:'#DCECF5',position:'relative'},
  tile:{position:'absolute',width:TILE_SIZE,height:TILE_SIZE},
  requesterMarker:{position:'absolute',transform:[{translateX:-28},{translateY:-34}],alignItems:'center'},requesterDot:{width:18,height:18,borderRadius:9,backgroundColor:BLUETAP_COLORS.primary,borderWidth:4,borderColor:'#FFF'},markerLabel:{fontSize:10,fontWeight:'900',color:BLUETAP_COLORS.text,backgroundColor:'#FFF',paddingHorizontal:5,paddingVertical:2,borderRadius:5,marginTop:2},
  branchMarker:{position:'absolute',transform:[{translateX:-15},{translateY:-15}],width:30,height:30,borderRadius:15,backgroundColor:BLUETAP_COLORS.success,borderWidth:3,borderColor:'#FFF',alignItems:'center',justifyContent:'center'},branchMarkerSelected:{backgroundColor:BLUETAP_COLORS.warning,width:36,height:36,borderRadius:18,transform:[{translateX:-18},{translateY:-18}]},branchMarkerText:{color:'#FFF',fontWeight:'900',fontSize:11},
  attribution:{position:'absolute',right:4,bottom:4,backgroundColor:'rgba(255,255,255,.82)',paddingHorizontal:4,paddingVertical:2},attributionText:{fontSize:8,color:BLUETAP_COLORS.muted},
  mapFooter:{minHeight:46,paddingHorizontal:12,flexDirection:'row',alignItems:'center',gap:10},help:{flex:1,color:BLUETAP_COLORS.muted,fontSize:11},fitButton:{paddingHorizontal:10,paddingVertical:7,borderRadius:8,backgroundColor:BLUETAP_COLORS.primarySoft},fitText:{color:BLUETAP_COLORS.primary,fontSize:11,fontWeight:'900'},
});

