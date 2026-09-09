import { Platform } from 'react-native';
import { File } from 'expo-file-system';

export async function captureFaceImage(camera) {
  let photo;
  try {
    photo = await camera.takePictureAsync({ base64: true, quality: 0.45, exif: false, skipProcessing: false, shutterSound: false });
    const data = photo?.base64?.replace(/^data:image\/\w+;base64,/, '');
    if (!data || data.length > 1398104) throw new Error('The photo is too large or could not be captured. Please try again.');
    return `data:image/jpeg;base64,${data}`;
  } finally {
    // Expo Camera creates a native cache file. Delete it even on validation failure.
    if (Platform.OS !== 'web' && photo?.uri) {
      const file = new File(photo.uri);
      if (file.exists) file.delete();
    }
    photo = undefined;
  }
}
