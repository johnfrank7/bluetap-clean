import React from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';

export default function BlueTapAIPage() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="dark" />

      <View style={styles.phoneWrapper}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.appName}>BlueTap AI</Text>

            <TouchableOpacity onPress={() => router.replace('/requester/r_profile')}>
              <Text style={styles.closeIcon}>✕</Text>
            </TouchableOpacity>
          </View>

          {/* Quick Help */}
          <Text style={styles.sectionTitle}>Quick Help</Text>
          <View style={styles.sectionDivider} />

          <View style={styles.bulletList}>
            <Text style={styles.bulletItem}>• How BlueTap works</Text>
            <Text style={styles.bulletItem}>• Reordering water</Text>
            <Text style={styles.bulletItem}>• Managing delivery addresses</Text>
            <Text style={styles.bulletItem}>• Common request issues</Text>
          </View>

          {/* Primary topic chip */}
          <TouchableOpacity style={styles.chip}>
            <Text style={styles.chipText}>How BlueTap works</Text>
          </TouchableOpacity>

          {/* Info bubble / response card */}
          <View style={styles.responseCard}>
            <Text style={styles.responseTitle}>New to BlueTap?</Text>
            <Text style={styles.responseText}>Here's how it works:</Text>
            <Text style={styles.responseText}>1. Request mineral water from the Request tab</Text>
            <Text style={styles.responseText}>2. Track your request status on the Home screen</Text>
            <Text style={styles.responseText}>
              3. Receive notifications until delivery is completed
            </Text>
          </View>

          {/* Input + send row */}
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder="Ask BlueTap AI..."
              placeholderTextColor="#9BB7D7"
            />
            <TouchableOpacity style={styles.sendButton}>
              <Text style={styles.sendIcon}>➤</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 120 }} />
        </ScrollView>

        {/* Bottom Nav */}
        <View style={styles.bottomNav}>
          <TouchableOpacity onPress={() => router.replace('/requester/r_dashboard')}>
            <Image source={require('../../assets/icons/home.png')} style={styles.navIcon} />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace('/requester/requestform')}>
            <Image source={require('../../assets/icons/square-plus.png')} style={styles.navIcon} />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace('/requester/r_profile')}>
            <Image source={require('../../assets/icons/user.png')} style={styles.navIcon} />
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  phoneWrapper: {
    flex: 1,
    width: '100%',
    maxWidth: 375,
    alignSelf: 'center',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 140,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  appName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#187BCD',
  },
  closeIcon: {
    fontSize: 20,
    color: '#187BCD',
  },
  sectionTitle: {
    marginTop: 24,
    fontSize: 16,
    fontWeight: 'bold',
    color: '#187BCD',
  },
  sectionDivider: {
    marginTop: 4,
    height: 1,
    backgroundColor: '#E0ECF8',
  },
  bulletList: {
    marginTop: 12,
  },
  bulletItem: {
    color: '#187BCD',
    fontSize: 14,
    marginBottom: 4,
  },
  chip: {
    alignSelf: 'center',
    marginTop: 20,
    backgroundColor: '#187BCD',
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 20,
  },
  chipText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  responseCard: {
    marginTop: 24,
    borderWidth: 1.5,
    borderColor: '#187BCD',
    borderRadius: 14,
    padding: 14,
  },
  responseTitle: {
    color: '#187BCD',
    fontSize: 14,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  responseText: {
    color: '#187BCD',
    fontSize: 13,
    marginTop: 2,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 18,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#187BCD',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: '#187BCD',
  },
  sendButton: {
    marginLeft: 8,
    backgroundColor: '#187BCD',
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendIcon: {
    color: '#FFFFFF',
    fontSize: 16,
  },
  bottomNav: {
    position: 'absolute',
    bottom: 24,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    paddingHorizontal: 28,
    borderRadius: 22,
    zIndex: 2,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  navIcon: { width: 26, height: 26, tintColor: '#187BCD' },
});

