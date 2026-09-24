import { Platform } from 'react-native';

const asCoordinate = (value, minimum, maximum) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= minimum && number <= maximum ? number : null;
};

export const normalizeLocation = (location) => {
  const latitude = asCoordinate(location?.latitude, -90, 90);
  const longitude = asCoordinate(location?.longitude, -180, 180);
  const accuracy = Number.isFinite(Number(location?.accuracy)) && Number(location?.accuracy) >= 0 ? Number(location.accuracy) : null;
  return latitude === null || longitude === null ? null : { latitude, longitude, ...(accuracy !== null ? { accuracy } : {}) };
};

export const haversineDistanceKm = (fromValue, toValue) => {
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

const locationError = (code, message) => Object.assign(new Error(message), { code });

export async function requestCurrentLocation() {
  if (Platform.OS === 'web') {
    if (!globalThis.navigator?.geolocation) throw locationError('LOCATION_UNAVAILABLE', 'Location is not available in this browser.');
    return new Promise((resolve, reject) => {
      globalThis.navigator.geolocation.getCurrentPosition(
        (position) => resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: Number.isFinite(position.coords.accuracy) ? Math.round(position.coords.accuracy * 10) / 10 : null,
        }),
        (error) => reject(locationError(
          error?.code === 1 ? 'LOCATION_PERMISSION_DENIED' : 'LOCATION_UNAVAILABLE',
          error?.code === 1
            ? 'Location access is needed to automatically find nearby BlueTap providers.'
            : 'Your current location could not be determined. Try again or select a point on the map.'
        )),
        { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 }
      );
    });
  }
  const Location = await import('expo-location');
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== 'granted') {
    throw locationError('LOCATION_PERMISSION_DENIED', 'Location access is needed to automatically find nearby BlueTap providers.');
  }
  const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: Number.isFinite(position.coords.accuracy) ? Math.round(position.coords.accuracy * 10) / 10 : null,
  };
}

export const rankBranchesByDistance = (branches, location) => (branches || [])
  .map((branch) => ({ ...branch, distanceKm: haversineDistanceKm(location, branch) }))
  .filter((branch) => branch.distanceKm !== null)
  .sort((left, right) => left.distanceKm - right.distanceKm);
