import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';

export default function DistributorProfileBanner({ isComplete, loading }) {
  const router = useRouter();

  if (loading || isComplete) return null;

  return (
    <View style={styles.banner} accessibilityRole="alert">
      <View style={styles.content}>
        <Text style={styles.title}>Action Required</Text>
        <Text style={styles.message}>
          Complete your profile before handling deliveries.
        </Text>
      </View>
      <TouchableOpacity
        onPress={() => router.push('/distributor/d_profile')}
        style={styles.button}
        accessibilityRole="button"
        accessibilityLabel="Complete Profile"
      >
        <Text style={styles.buttonText}>Complete Profile</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: '#FFFBEB',
    borderColor: '#F59E0B',
    borderWidth: 1,
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 16,
    marginVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  content: {
    flex: 1,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    color: '#B45309',
    marginBottom: 2,
  },
  message: {
    fontSize: 12,
    color: '#92400E',
    lineHeight: 16,
  },
  button: {
    backgroundColor: '#D97706',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '600',
  },
});

