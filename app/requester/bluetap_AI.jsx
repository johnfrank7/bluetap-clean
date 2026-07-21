import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { createShadow } from '../../components/shadowStyles';

export default function BlueTapAIPage() {
  const router = useRouter();

  return (
    <LinearGradient
      colors={['#187BCD', '#42A5F5']}
      style={styles.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
    >
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
        <StatusBar style="light" />

        <View style={styles.phoneWrapper}>
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          <View style={styles.aiTitleRow}>
            <Text style={styles.aiTitle}>BlueTap AI</Text>

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

        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    width: '100%',
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
  aiTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  aiTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  closeIcon: {
    fontSize: 20,
    color: '#FFFFFF',
  },
  sectionTitle: {
    marginTop: 24,
    fontSize: 16,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  sectionDivider: {
    marginTop: 4,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  bulletList: {
    marginTop: 12,
  },
  bulletItem: {
    color: '#FFFFFF',
    fontSize: 14,
    marginBottom: 4,
  },
  chip: {
    alignSelf: 'center',
    marginTop: 20,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 24,
    paddingVertical: 8,
    borderRadius: 20,
  },
  chipText: {
    color: '#187BCD',
    fontSize: 13,
    fontWeight: 'bold',
  },
  responseCard: {
    marginTop: 24,
    borderWidth: 1.5,
    borderColor: '#FFFFFF',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    ...createShadow({
      color: '#0D47A1',
      elevation: 5,
      opacity: 0.12,
      radius: 10,
      offset: { width: 0, height: 5 },
    }),
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
    borderColor: '#FFFFFF',
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 13,
    color: '#187BCD',
  },
  sendButton: {
    marginLeft: 8,
    backgroundColor: '#FFFFFF',
    width: 36,
    height: 36,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendIcon: {
    color: '#187BCD',
    fontSize: 16,
  },
});
