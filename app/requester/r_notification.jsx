import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';

export default function RequesterNotification() {
  const router = useRouter();

  const goBack = () => {
    router.replace('/requester/r_dashboard');
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.phoneWrapper}>
        {/* Main notification card */}
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity
            style={styles.backButton}
            activeOpacity={0.85}
            onPress={goBack}
          >
            <Text style={styles.backIcon}>{'\u2190'}</Text>
          </TouchableOpacity>

          <View style={styles.card}>
            {/* Blue title bar */}
            <View style={styles.cardHeader}>
              <Text style={styles.cardHeaderText}>NOTIFICATION</Text>
            </View>

            {/* Notification messages */}
            <View style={styles.cardBody}>
              <Text style={styles.messageText}>
                Your request for <Text style={styles.boldNumber}>#BT-01245</Text> has been sent to
                Toledo Pure Water Station. Please wait for confirmation.
              </Text>

              <View style={styles.divider} />

              <Text style={styles.messageText}>
                Your request <Text style={styles.boldNumber}>#BT-01212</Text> has been approved by
                Toledo Pure Water Station. Delivery will be scheduled soon.
              </Text>

              <View style={styles.divider} />
            </View>
          </View>

          <View style={{ height: 140 }} />
        </ScrollView>

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
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 12,
  },
  backIcon: {
    color: '#187BCD',
    fontSize: 22,
    fontWeight: 'bold',
  },
  card: {
    borderWidth: 2,
    borderColor: '#187BCD',
    borderRadius: 4,
    overflow: 'hidden',
  },
  cardHeader: {
    backgroundColor: '#187BCD',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  cardHeaderText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  cardBody: {
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  messageText: {
    fontSize: 13,
    color: '#187BCD',
    lineHeight: 18,
    marginBottom: 12,
  },
  boldNumber: {
    fontWeight: 'bold',
  },
  divider: {
    height: 1,
    backgroundColor: '#187BCD',
    opacity: 0.4,
    marginBottom: 14,
  },
});
