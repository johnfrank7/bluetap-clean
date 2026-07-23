import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import BlueTapHeader from '../../components/BlueTapHeader';

export default function DistributorNotification() {
  const router = useRouter();

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <BlueTapHeader
        notificationPath="/distributor/d_notification"
        rightContent={
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={styles.backIcon}>{'\u2190'}</Text>
          </TouchableOpacity>
        }
      />

      <View style={styles.phoneWrapper}>
        {/* Main content - light blue border card */}
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.card}>
            <Text style={styles.cardTitle}>NOTIFICATION</Text>
            <View style={styles.titleDivider} />

            <View style={styles.cardBody}>
              <Text style={styles.messageText}>
                Request <Text style={styles.boldId}>#BT-01278</Text> has been delivered to Maylene Minoza.
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 12,
  },
  appName: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#187BCD',
  },
  backIcon: {
    fontSize: 24,
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  card: {
    borderWidth: 2,
    borderColor: '#90CAF9',
    borderRadius: 8,
    overflow: 'hidden',
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#187BCD',
    letterSpacing: 1,
    textAlign: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  titleDivider: {
    height: 1,
    backgroundColor: '#90CAF9',
  },
  cardBody: {
    paddingHorizontal: 14,
    paddingVertical: 16,
  },
  messageText: {
    fontSize: 14,
    color: '#187BCD',
    lineHeight: 20,
  },
  boldId: {
    fontWeight: 'bold',
    color: '#1565C0',
  },
  divider: {
    height: 1,
    backgroundColor: '#90CAF9',
    marginTop: 14,
  },
});
