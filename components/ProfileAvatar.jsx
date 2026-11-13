import React from 'react';
import { Image, Text } from 'react-native';

export default function ProfileAvatar({ uri, name, initialsStyle }) {
  const [failedUri, setFailedUri] = React.useState('');
  const source = typeof uri === 'string' ? uri.trim() : '';
  const initials = String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase() || 'BT';
  if (!source || source === failedUri) return <Text style={initialsStyle}>{initials}</Text>;
  return <Image accessibilityLabel="Profile picture" source={{ uri: source }} onError={() => setFailedUri(source)} style={{ width: '100%', height: '100%', resizeMode: 'cover' }} />;
}
