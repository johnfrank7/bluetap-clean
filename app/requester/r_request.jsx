import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';

import { auth } from '../../firebase';
import { getLocalUsers } from '../../localUsers';
import { subscribeRequesterRequests } from '../../services/requests';

const formatPrice = (price) => `\u20B1${Number(price || 0).toFixed(2)}`;
const initialVisibleRequestCount = 1;

const timestampToDate = (timestamp) => {
  if (!timestamp) return null;
  if (timestamp instanceof Date) return timestamp;
  if (typeof timestamp === 'string') {
    const parsedDate = new Date(timestamp);
    return Number.isNaN(parsedDate.getTime()) ? null : parsedDate;
  }
  if (typeof timestamp.toDate === 'function') return timestamp.toDate();
  if (timestamp.seconds) return new Date(timestamp.seconds * 1000);
  return null;
};

const formatRequestDate = (request) => {
  if (request.delivery_date) return request.delivery_date;

  const date = timestampToDate(request.created_at);
  if (!date) return 'Date not set';

  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(date);
  } catch (error) {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month} - ${day} - ${date.getFullYear()}`;
  }
};

const getRequestProductSummary = (request) => {
  if (Array.isArray(request.items) && request.items.length > 0) {
    return request.items
      .map((item) => `${item.quantity} ${item.product_name}`)
      .join(', ');
  }

  return `${request.quantity} ${request.product_name}`.trim();
};

export default function RequesterRequests() {
  const router = useRouter();
  const [requests, setRequests] = useState([]);
  const [selectedRequest, setSelectedRequest] = useState(null);
  const [showAllRequests, setShowAllRequests] = useState(false);

  useEffect(() => {
    const requesterId =
      auth.currentUser?.uid ||
      getLocalUsers().find((localUser) => localUser.role === 'requester')?.uid ||
      '';

    if (!requesterId) return undefined;

    return subscribeRequesterRequests(requesterId, setRequests);
  }, []);

  const visibleRequests = showAllRequests
    ? requests
    : requests.slice(0, initialVisibleRequestCount);

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.container}>
      <StatusBar style="light" />

      <View style={styles.phoneWrapper}>
        <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
          {/* Blue requests panel */}
          <View style={styles.requestsPanel}>
            <Text style={styles.pageTitle}>REQUESTS</Text>

            <View style={styles.historyHeader}>
              <Text style={styles.historyTitle}>Request History</Text>
              <View style={styles.historyDivider} />
            </View>

            {requests.length === 0 ? (
              <View style={styles.requestCard}>
                <Text style={styles.requestMeta}>No request history yet.</Text>
              </View>
            ) : (
              visibleRequests.map((request) => (
                <View style={styles.requestCard} key={request.id}>
                  <Text style={styles.requestId}>
                    Request #{request.request_id || request.id}
                  </Text>
                  <Text style={styles.requestMeta}>{formatRequestDate(request)}</Text>
                  <Text style={styles.requestMeta}>{getRequestProductSummary(request)}</Text>
                  <Text style={styles.requestMeta}>{request.container} container</Text>
                  <Text style={styles.requestMeta}>{request.water_station}</Text>
                  <Text style={styles.requestStatus}>Status: {request.status}</Text>

                  <View style={styles.requestFooterRow}>
                    <View style={styles.requestUnderline} />
                    <TouchableOpacity
                      style={styles.detailsButton}
                      onPress={() => setSelectedRequest(request)}
                    >
                      <Text style={styles.detailsText}>View Details</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}

            {requests.length > initialVisibleRequestCount && (
              <TouchableOpacity
                style={styles.seeMoreButton}
                onPress={() => setShowAllRequests((isVisible) => !isVisible)}
              >
                <Text style={styles.seeMoreText}>
                  {showAllRequests ? 'See less' : 'See more'}
                </Text>
              </TouchableOpacity>
            )}

            <TouchableOpacity
              style={styles.addRequestButton}
              onPress={() => router.replace('/requester/requestform')}
            >
              <Text style={styles.addRequestText}>Add request</Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 140 }} />
        </ScrollView>

        <Modal visible={!!selectedRequest} transparent animationType="slide">
          <View style={styles.modalBackground}>
            <View style={styles.modalContainer}>
              <Text style={styles.modalTitle}>Request Details</Text>

              {!!selectedRequest && (
                <>
                  <Text style={styles.modalText}>
                    Request: #{selectedRequest.request_id || selectedRequest.id}
                  </Text>
                  <Text style={styles.modalText}>Date: {formatRequestDate(selectedRequest)}</Text>
                  <Text style={styles.modalText}>Container: {selectedRequest.container}</Text>
                  <Text style={styles.modalText}>
                    Water Station: {selectedRequest.water_station}
                  </Text>
                  <Text style={styles.modalText}>Status: {selectedRequest.status}</Text>

                  <View style={styles.modalDivider} />

                  {selectedRequest.items?.length > 0 ? (
                    selectedRequest.items.map((item) => (
                      <Text style={styles.modalText} key={item.product_id}>
                        {item.product_name}: {item.quantity} x{' '}
                        {formatPrice(item.product_price)}
                      </Text>
                    ))
                  ) : (
                    <Text style={styles.modalText}>
                      {selectedRequest.product_name}: {selectedRequest.quantity}
                    </Text>
                  )}

                  <Text style={styles.modalTotal}>
                    Total: {formatPrice(selectedRequest.total_cost)}
                  </Text>
                </>
              )}

              <TouchableOpacity
                style={styles.modalButton}
                onPress={() => setSelectedRequest(null)}
              >
                <Text style={styles.modalButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
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
    width: '100%',
    maxWidth: 375,
    alignSelf: 'center',
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 0,
    paddingBottom: 140,
  },
  requestsPanel: {
    marginTop: 28,
    backgroundColor: '#187BCD',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingTop: 20,
    paddingBottom: 24,
  },
  pageTitle: {
    marginTop: 0,
    fontSize: 24,
    fontWeight: 'bold',
    letterSpacing: 1,
    color: '#FFFFFF',
  },
  historyHeader: {
    marginTop: 18,
  },
  historyTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#EAF4FF',
    marginBottom: 6,
  },
  historyDivider: {
    height: 1,
    backgroundColor: '#EAF4FF',
    opacity: 0.6,
  },
  requestCard: {
    marginTop: 18,
  },
  requestId: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  requestMeta: {
    color: '#EAF4FF',
    fontSize: 14,
    marginBottom: 2,
  },
  requestStatus: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: 'bold',
    marginTop: 4,
  },
  requestFooterRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
  },
  requestUnderline: {
    flex: 1,
    height: 1,
    backgroundColor: '#EAF4FF',
    opacity: 0.7,
  },
  detailsButton: {
    marginLeft: 8,
  },
  detailsText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
  seeMoreButton: {
    alignSelf: 'center',
    borderWidth: 1,
    borderColor: '#FFFFFF',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 7,
    marginTop: 18,
  },
  seeMoreText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
  },
  addRequestButton: {
    marginTop: 28,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRequestText: {
    color: '#187BCD',
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalBackground: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '85%',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
  },
  modalTitle: {
    color: '#187BCD',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
  },
  modalText: {
    color: '#187BCD',
    fontSize: 14,
    marginBottom: 7,
  },
  modalDivider: {
    height: 1,
    backgroundColor: '#E0E0E0',
    marginVertical: 8,
  },
  modalTotal: {
    color: '#187BCD',
    fontSize: 15,
    fontWeight: 'bold',
    marginTop: 6,
    marginBottom: 16,
  },
  modalButton: {
    backgroundColor: '#187BCD',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
  },
  modalButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
});
