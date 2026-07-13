import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  TouchableOpacity,
  ScrollView,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import BlueTapHeader from '../../components/BlueTapHeader';

const DISTRIBUTOR_NAME = 'Distributor';

const DASHBOARD_SUMMARY = [
  {
    label: 'Pending Requests',
    value: '2',
  },
  {
    label: 'Scheduled Today',
    value: '3',
  },
  {
    label: 'Delivered Today',
    value: '1',
  },
];

const CURRENT_REQUEST = {
  requestId: 'BT-01245',
  customerName: 'Jeanne Ortega',
  contactNumber: '09123456789',
  deliveryAddress: 'Poblacion, Toledo City',
  productsOrdered: 'Purified Mineral Water',
  quantity: '3 Gallons',
  containerType: 'New Container',
  total_cost: 75,
  deliveryDate: 'Jan 25, 2026',
  status: 'Out for Delivery',
};

const STATUS_ACTIONS = {
  pending: 'Accept Request',
  accepted: 'Schedule Delivery',
  scheduled: 'Start Delivery',
  'out for delivery': 'Delivered',
};

const formatDashboardDate = (date) =>
  new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date);

const normalizeStatus = (status) =>
  (status || '').toString().trim().toLowerCase().replace(/[_-]+/g, ' ');

const getStatusActionLabel = (status) =>
  STATUS_ACTIONS[normalizeStatus(status)] || 'Update Request';

const formatAmountDue = (amount) =>
  `\u20B1${Number(amount || 0).toFixed(2)}`;

export default function DistributorDashboard() {
  const router = useRouter();
  const [detailsVisible, setDetailsVisible] = useState(false);
  const todayText = formatDashboardDate(new Date());
  const activeRequest = CURRENT_REQUEST;
  const primaryActionLabel = activeRequest
    ? getStatusActionLabel(activeRequest.status)
    : '';
  const requestDetails = activeRequest
    ? [
        { label: 'Customer Name', value: activeRequest.customerName },
        { label: 'Contact Number', value: activeRequest.contactNumber },
        { label: 'Delivery Address', value: activeRequest.deliveryAddress },
        { label: 'Products Ordered', value: activeRequest.productsOrdered },
        { label: 'Quantity', value: activeRequest.quantity },
        { label: 'Container Type', value: activeRequest.containerType },
        { label: 'Delivery Date', value: activeRequest.deliveryDate },
        { label: 'Status', value: activeRequest.status },
      ]
    : [];

  const handleCurrentRequestAction = () => {
    if (!activeRequest) return;

    if (normalizeStatus(activeRequest.status) === 'pending') {
      router.replace('/distributor/d_requests');
      return;
    }

    router.replace('/distributor/d_scheduled_requests');
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <BlueTapHeader
        notificationPath="/distributor/d_notification"
      />

      <View style={styles.phoneWrapper}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.welcomeSection}>
            <Text style={styles.welcomeText}>WELCOME!</Text>
            <Text style={styles.greetingText}>
              Good Morning, {DISTRIBUTOR_NAME}
            </Text>
            <Text style={styles.dateText}>{todayText}</Text>
          </View>

          <View style={styles.summaryRow}>
            {DASHBOARD_SUMMARY.map((item) => (
              <View key={item.label} style={styles.summaryCard}>
                <Text style={styles.summaryValue}>{item.value}</Text>
                <Text style={styles.summaryLabel}>{item.label}</Text>
              </View>
            ))}
          </View>

          <View style={styles.currentRequestSection}>
            <Text style={styles.sectionTitle}>Current Request</Text>

            {activeRequest ? (
              <View style={styles.currentRequestCard}>
                <View style={styles.requestCardHeader}>
                  <View style={styles.requestTitleBlock}>
                    <Text style={styles.requestId}>
                      Request ID {activeRequest.requestId}
                    </Text>
                  </View>
                  <View style={styles.statusPill}>
                    <Text style={styles.statusPillText}>
                      {activeRequest.status}
                    </Text>
                  </View>
                </View>

                <View style={styles.compactRequestBody}>
                  <View style={[styles.infoGridRow, styles.infoGridRowDivider]}>
                    <View style={styles.infoGridColumn}>
                      <Text style={styles.infoGridLabel}>Customer</Text>
                      <Text style={styles.infoGridValue} numberOfLines={1}>
                        {activeRequest.customerName}
                      </Text>
                    </View>

                    <View style={styles.infoGridColumn}>
                      <Text style={styles.infoGridLabel}>Amount Due</Text>
                      <Text style={styles.infoGridValue} numberOfLines={1}>
                        {formatAmountDue(activeRequest.total_cost)}
                      </Text>
                    </View>
                  </View>

                  <View style={styles.infoGridRow}>
                    <View style={styles.infoGridColumn}>
                      <Text style={styles.infoGridLabel}>Address</Text>
                      <Text style={styles.infoGridValue} numberOfLines={2}>
                        {activeRequest.deliveryAddress}
                      </Text>
                    </View>

                    <View style={styles.infoGridColumn}>
                      <Text style={styles.infoGridLabel}>Product</Text>
                      <Text style={styles.infoGridValue} numberOfLines={2}>
                        {activeRequest.quantity} | {activeRequest.containerType}
                      </Text>
                    </View>
                  </View>
                </View>

                <View style={styles.cardActionsRow}>
                  <TouchableOpacity
                    style={styles.viewDetailsButton}
                    activeOpacity={0.75}
                    onPress={() => setDetailsVisible(true)}
                  >
                    <Text style={styles.viewDetailsText}>View Details</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.primaryActionButton}
                    activeOpacity={0.85}
                    onPress={handleCurrentRequestAction}
                  >
                    <Text style={styles.primaryActionText}>
                      {primaryActionLabel}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <View style={styles.emptyRequestCard}>
                <Text style={styles.emptyRequestTitle}>No active delivery.</Text>
                <Text style={styles.emptyRequestText}>
                  Go to the Requests page to accept a new order.
                </Text>
              </View>
            )}
          </View>

          <View style={styles.quickActionsSection}>
            <Text style={styles.sectionTitle}>Quick Actions</Text>
            <View style={styles.quickActionsRow}>
              <TouchableOpacity
                style={styles.quickActionButton}
                activeOpacity={0.85}
                onPress={() => router.replace('/distributor/d_requests')}
              >
                <Text style={styles.quickActionText}>
                  View Pending Requests
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.quickActionButton, styles.quickActionSecondary]}
                activeOpacity={0.85}
                onPress={() => router.replace('/distributor/d_scheduled_requests')}
              >
                <Text
                  style={[
                    styles.quickActionText,
                    styles.quickActionSecondaryText,
                  ]}
                >
                  View Delivery Schedule
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </ScrollView>

        {/* Bottom navigation bar */}
        <View style={styles.bottomNav}>
          <TouchableOpacity onPress={() => router.replace('/distributor/d_dashboard')}>
            <Image
              source={require('../../assets/icons/home.png')}
              style={styles.navIcon}
            />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace('/distributor/d_requests')}>
            <Image
              source={require('../../assets/icons/ballot.png')}
              style={styles.navIcon}
            />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace('/distributor/d_scheduled_requests')}>
            <Image
              source={require('../../assets/icons/calendar-clock.png')}
              style={styles.navIcon}
            />
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace('/distributor/d_profile')}>
            <Image
              source={require('../../assets/icons/user.png')}
              style={styles.navIcon}
            />
          </TouchableOpacity>
        </View>
      </View>

      <Modal
        visible={detailsVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDetailsVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.detailsModal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Request Details</Text>
              <TouchableOpacity
                activeOpacity={0.75}
                onPress={() => setDetailsVisible(false)}
              >
                <Text style={styles.modalCloseText}>Close</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.modalDivider} />

            {requestDetails.map((detail) => (
              <View key={detail.label} style={styles.modalDetailRow}>
                <Text style={styles.modalDetailLabel}>{detail.label}</Text>
                <Text style={styles.modalDetailValue}>{detail.value}</Text>
              </View>
            ))}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  phoneWrapper: {
    width: '100%',
    maxWidth: 375,
    alignSelf: 'center',
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 160,
  },
  welcomeSection: {
    marginTop: 12,
  },
  welcomeText: {
    color: '#187BCD',
    fontSize: 26,
    fontWeight: 'bold',
    letterSpacing: 0,
  },
  greetingText: {
    color: '#187BCD',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 4,
  },
  dateText: {
    color: '#6F8EA8',
    fontSize: 13,
    marginTop: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 20,
  },
  summaryCard: {
    flex: 1,
    minHeight: 86,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#90CAF9',
    borderRadius: 14,
    paddingHorizontal: 8,
    paddingVertical: 12,
    justifyContent: 'space-between',
  },
  summaryValue: {
    color: '#187BCD',
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  summaryLabel: {
    color: '#187BCD',
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  currentRequestSection: {
    marginTop: 24,
  },
  sectionTitle: {
    color: '#187BCD',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  currentRequestCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#90CAF9',
    borderRadius: 14,
    padding: 16,
  },
  requestCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E3F2FD',
  },
  requestTitleBlock: {
    flex: 1,
  },
  requestId: {
    color: '#187BCD',
    fontSize: 16,
    fontWeight: 'bold',
  },
  statusPill: {
    backgroundColor: '#E3F2FD',
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 5,
    flexShrink: 0,
  },
  statusPillText: {
    color: '#187BCD',
    fontSize: 11,
    fontWeight: 'bold',
  },
  compactRequestBody: {
    paddingTop: 2,
  },
  infoGridRow: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 10,
  },
  infoGridRowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: '#E3F2FD',
  },
  infoGridColumn: {
    flex: 1,
  },
  infoGridLabel: {
    color: '#6F8EA8',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 3,
  },
  infoGridValue: {
    color: '#187BCD',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
  },
  cardActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  viewDetailsButton: {
    flex: 1,
    height: 44,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#187BCD',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewDetailsText: {
    color: '#187BCD',
    fontSize: 14,
    fontWeight: 'bold',
  },
  primaryActionButton: {
    flex: 1,
    height: 44,
    backgroundColor: '#187BCD',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
  },
  emptyRequestCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#90CAF9',
    borderRadius: 14,
    padding: 16,
  },
  emptyRequestTitle: {
    color: '#187BCD',
    fontSize: 15,
    fontWeight: 'bold',
  },
  emptyRequestText: {
    color: '#6F8EA8',
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  quickActionsSection: {
    marginTop: 24,
  },
  quickActionsRow: {
    flexDirection: 'row',
    gap: 10,
  },
  quickActionButton: {
    flex: 1,
    minHeight: 50,
    backgroundColor: '#187BCD',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  quickActionSecondary: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#187BCD',
  },
  quickActionText: {
    color: '#FFFFFF',
    fontSize: 12,
    lineHeight: 16,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  quickActionSecondaryText: {
    color: '#187BCD',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  detailsModal: {
    width: '100%',
    maxWidth: 375,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 28,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    color: '#187BCD',
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalCloseText: {
    color: '#187BCD',
    fontSize: 13,
    fontWeight: 'bold',
  },
  modalDivider: {
    height: 1,
    backgroundColor: '#E3F2FD',
    marginTop: 12,
    marginBottom: 12,
  },
  modalDetailRow: {
    marginBottom: 11,
  },
  modalDetailLabel: {
    color: '#6F8EA8',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 2,
  },
  modalDetailValue: {
    color: '#187BCD',
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 18,
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
  navIcon: {
    width: 26,
    height: 26,
    tintColor: '#187BCD',
  },
});
