import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Image,
  ActivityIndicator,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { db } from '../../firebase';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { getLocalUsers, subscribeLocalUsers, updateLocalUserStatus } from '../../localUsers';
import { signOutAndClearSessions } from '../../services/authSession';

const normalizeApplicationStatus = (status) =>
  (status || 'pending').toString().trim().toLowerCase();

const toApplicationStatus = (status) => {
  const normalizedStatus = normalizeApplicationStatus(status);

  if (normalizedStatus === 'approved') return 'Approved';
  if (normalizedStatus === 'rejected') return 'Rejected';

  return 'Pending';
};

const getDistributorApplicationStatus = (distributor) =>
  normalizeApplicationStatus(
    distributor.status ||
      distributor.approvalStatus ||
      distributor.accountStatus ||
      'pending'
  );

const getPendingLocalDistributors = (firestoreDistributors = []) =>
  getLocalUsers()
    .filter(
      (user) =>
        user.role === 'distributor' &&
        getDistributorApplicationStatus(user) === 'pending'
    )
    .map((user) => ({ ...user, id: user.uid, isLocal: true }))
    .filter(
      (localUser) =>
        !firestoreDistributors.some(
          (firestoreUser) =>
            firestoreUser.uid === localUser.uid ||
            firestoreUser.email === localUser.email
        )
    );

const buildDistributorUpdate = (distributor, approvalStatus, rejectionReason = '') => {
  const uid = distributor.uid || distributor.id;
  const isRejected = approvalStatus === 'rejected';

  return {
    uid,
    firstName: distributor.firstName || '',
    lastName: distributor.lastName || '',
    email: distributor.email || '',
    phone: distributor.phone || '',
    barangay: distributor.barangay || distributor.address || '',
    address: distributor.address || distributor.barangay || '',
    role: 'distributor',
    approvalStatus,
    status: toApplicationStatus(approvalStatus),
    rejectionReason: isRejected ? rejectionReason : null,
    reviewedAt: serverTimestamp(),
  };
};

export default function AdminRequestPage() {
  const router = useRouter();
  const [pendingDistributors, setPendingDistributors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [rejectingDistributor, setRejectingDistributor] = useState(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectionReasonError, setRejectionReasonError] = useState('');

  useEffect(() => {
    let firestorePending = [];

    const refreshPendingDistributors = (nextFirestorePending = firestorePending) => {
      firestorePending = nextFirestorePending;
      setPendingDistributors([
        ...firestorePending,
        ...getPendingLocalDistributors(firestorePending),
      ]);
      setLoading(false);
    };

    refreshPendingDistributors();
    const unsubscribeLocalUsers = subscribeLocalUsers(() => refreshPendingDistributors());

    const pendingQuery = query(
      collection(db, 'users'),
      where('role', '==', 'distributor')
    );

    const unsubscribe = onSnapshot(
      pendingQuery,
      (snapshot) => {
        const firestoreDistributors = snapshot.docs
          .map((item) => ({
            id: item.id,
            uid: item.id,
            ...item.data(),
          }))
          .filter((item) => getDistributorApplicationStatus(item) === 'pending');

        refreshPendingDistributors(firestoreDistributors);
        setLoadError('');
      },
      (error) => {
        console.log('Pending distributors error:', error.message);
        setLoadError(error.message);
        refreshPendingDistributors();
      }
    );

    return () => {
      unsubscribe();
      unsubscribeLocalUsers();
    };
  }, []);

  const handleLogout = async () => {
    await signOutAndClearSessions();
    router.replace('/login');
  };

  const updateDistributorStatus = async (distributor, approvalStatus, reason = '') => {
    const id = distributor.uid || distributor.id;
    const rejectionReason = reason.trim();

    if (approvalStatus === 'rejected' && !rejectionReason) {
      setRejectionReasonError('Rejection reason is required.');
      return;
    }

    try {
      setUpdatingId(id);
      updateLocalUserStatus(id, approvalStatus, { rejectionReason });
      setPendingDistributors((current) =>
        current.filter((distributor) => distributor.uid !== id && distributor.id !== id)
      );

      try {
        await setDoc(
          doc(db, 'users', id),
          buildDistributorUpdate(distributor, approvalStatus, rejectionReason),
          { merge: true }
        );
      } catch (error) {
        console.log('Distributor Firestore review error:', error.message);
        Alert.alert(
          'Saved locally',
          'The distributor status was updated on this device, but Firestore did not accept the change.'
        );
      }
    } catch (error) {
      console.log('Distributor review error:', error.message);
      Alert.alert('Update failed', error.message);
    } finally {
      setUpdatingId(null);
    }
  };

  const openRejectModal = (distributor) => {
    setRejectingDistributor(distributor);
    setRejectionReason('');
    setRejectionReasonError('');
  };

  const closeRejectModal = () => {
    const id = rejectingDistributor?.uid || rejectingDistributor?.id;

    if (id && updatingId === id) return;

    setRejectingDistributor(null);
    setRejectionReason('');
    setRejectionReasonError('');
  };

  const submitRejection = async () => {
    if (!rejectingDistributor) return;

    const trimmedReason = rejectionReason.trim();

    if (!trimmedReason) {
      setRejectionReasonError('Rejection reason is required.');
      return;
    }

    await updateDistributorStatus(rejectingDistributor, 'rejected', trimmedReason);
    closeRejectModal();
  };

  const rejectingDistributorId = rejectingDistributor?.uid || rejectingDistributor?.id;
  const isSavingRejection = !!rejectingDistributorId && updatingId === rejectingDistributorId;

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      <View style={styles.container}>
        {/* Sidebar */}
        <View style={styles.sidebar}>
          <View style={styles.stationHeader}>
            <Image
              source={require('../../assets/icons/bluetaplogo.png')}
              style={styles.logoImage}
              resizeMode="contain"
            />
            <Text style={styles.stationName}>Station Name</Text>
          </View>

          <TouchableOpacity
            style={styles.navItem}
            onPress={() => router.replace('/admin/dashboard')}
          >
            <Text style={styles.navItemText}>Dashboard</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navItem}
            onPress={() => router.replace('/admin/products')}
          >
            <Text style={styles.navItemText}>Products</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.navItem, styles.navItemActive]}
            onPress={() => router.replace('/admin/request')}
          >
            <Text style={[styles.navItemText, styles.navItemTextActive]}>Request</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.navItem}>
            <Text style={styles.navItemText}>Profile</Text>
          </TouchableOpacity>

          <View style={styles.sidebarFooter}>
            <Text style={styles.footerBrand}>BlueTap</Text>
          </View>
        </View>

        {/* Main content */}
        <View style={styles.main}>
          {/* Top bar */}
          <View style={styles.topBar}>
            <View style={styles.searchContainer}>
              <TextInput
                style={styles.searchInput}
                placeholder="Search"
                placeholderTextColor="#B0BEC5"
              />
              <TouchableOpacity style={styles.searchButton}>
                <Text style={styles.searchIcon}>🔍</Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
              <Text style={styles.logoutText}>LOGOUT</Text>
            </TouchableOpacity>
          </View>

          {/* Pending distributors table */}
          <ScrollView contentContainerStyle={styles.cardScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Pending Distributors</Text>
                
              </View>

              {/* Table header */}
              <View style={[styles.row, styles.tableHeaderRow]}>
                <Text style={[styles.cell, styles.cellNameHeader]}>Name</Text>
                <Text style={[styles.cell, styles.cellPhoneHeader]}>Contact Number</Text>
                <Text style={[styles.cell, styles.cellEmailHeader]}>Email Address</Text>
                <Text style={[styles.cell, styles.cellActionsHeader]}>Actions</Text>
              </View>

              {loading ? (
                <View style={styles.emptyState}>
                  <ActivityIndicator size="small" color="#187BCD" />
                </View>
              ) : pendingDistributors.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>No pending distributors.</Text>
                  {!!loadError && (
                    <Text style={styles.errorText}>Firestore: {loadError}</Text>
                  )}
                </View>
              ) : (
                pendingDistributors.map((d, idx) => {
                  const fullName = `${d.firstName || ''} ${d.lastName || ''}`.trim() || 'Unnamed distributor';
                  const distributorId = d.uid || d.id;
                  const isUpdating = updatingId === distributorId;

                  return (
                    <View
                      key={d.id}
                      style={[styles.row, idx % 2 === 1 && styles.rowStriped]}
                    >
                      <Text style={[styles.cell, styles.cellName]}>{fullName}</Text>
                      <Text style={[styles.cell, styles.cellPhone]}>{d.phone || 'Not set'}</Text>
                      <Text style={[styles.cell, styles.cellEmail]}>{d.email || 'Not set'}</Text>
                      <View style={[styles.cell, styles.cellActions]}>
                        <TouchableOpacity
                          style={[styles.rejectButton, isUpdating && styles.actionDisabled]}
                          onPress={() => openRejectModal(d)}
                          disabled={isUpdating}
                        >
                          <Text style={styles.rejectText}>Reject</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.acceptButton, isUpdating && styles.actionDisabled]}
                          onPress={() => updateDistributorStatus(d, 'approved')}
                          disabled={isUpdating}
                        >
                          <Text style={styles.acceptText}>Accept</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          </ScrollView>
        </View>
      </View>

      <Modal visible={!!rejectingDistributor} transparent animationType="fade">
        <View style={styles.modalBackground}>
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Reject Application</Text>
            <Text style={styles.modalMessage}>
              Enter the reason this distributor application is being rejected.
            </Text>

            <TextInput
              style={[
                styles.reasonInput,
                !!rejectionReasonError && styles.reasonInputError,
              ]}
              placeholder="Example: Unable to verify your identity (Unverified Personnel)"
              placeholderTextColor="#90A4AE"
              value={rejectionReason}
              onChangeText={(value) => {
                setRejectionReason(value);
                if (rejectionReasonError && value.trim()) {
                  setRejectionReasonError('');
                }
              }}
              multiline
              textAlignVertical="top"
            />
            {!!rejectionReasonError && (
              <Text style={styles.reasonErrorText}>{rejectionReasonError}</Text>
            )}

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={closeRejectModal}
                disabled={isSavingRejection}
              >
                <Text style={styles.modalCancelButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modalRejectButton,
                  isSavingRejection && styles.actionDisabled,
                ]}
                onPress={submitRejection}
                disabled={isSavingRejection}
              >
                <Text style={styles.modalRejectButtonText}>
                  {isSavingRejection ? 'Saving...' : 'Save Rejection'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F2F4F7',
  },
  container: {
    flex: 1,
    flexDirection: 'row',
  },

  /* Sidebar */
  sidebar: {
    width: 260,
    backgroundColor: '#187BCD',
    paddingTop: 24,
    paddingHorizontal: 20,
  },
  stationHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 32,
  },
  logoImage: {
    width: 32,
    height: 32,
    marginRight: 10,
  },
  stationName: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },

  navItem: {
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 4,
    marginBottom: 6,
  },
  navItemActive: {
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  navItemText: {
    color: '#E3F2FD',
    fontSize: 14,
  },
  navItemTextActive: {
    fontWeight: 'bold',
  },

  sidebarFooter: {
    marginTop: 'auto',
    paddingVertical: 16,
  },
  footerBrand: {
    color: '#FFFFFF',
    fontSize: 14,
  },

  /* Main area */
  main: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 20,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E0E0E0',
  },
  searchInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    fontSize: 14,
    color: '#455A64',
  },
  searchButton: {
    width: 44,
    height: '100%',
    backgroundColor: '#187BCD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchIcon: {
    color: '#FFFFFF',
    fontSize: 18,
  },

  logoutButton: {
    marginLeft: 16,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#187BCD',
    backgroundColor: '#FFFFFF',
  },
  logoutText: {
    color: '#187BCD',
    fontWeight: '600',
    fontSize: 13,
  },

  cardScroll: {
    paddingBottom: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  cardTitle: {
    color: '#187BCD',
    fontSize: 16,
    fontWeight: 'bold',
  },
  removeButton: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: '#E3F2FD',
  },
  removeButtonText: {
    color: '#187BCD',
    fontSize: 13,
    fontWeight: '600',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F1F1',
  },
  tableHeaderRow: {
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  rowStriped: {
    backgroundColor: '#FAFAFA',
  },
  cell: {
    fontSize: 14,
    color: '#455A64',
  },
  cellNameHeader: { flex: 1.7, fontWeight: 'bold' },
  cellPhoneHeader: { flex: 1.3, fontWeight: 'bold' },
  cellEmailHeader: { flex: 2, fontWeight: 'bold' },
  cellActionsHeader: { flex: 1.6, fontWeight: 'bold', textAlign: 'center' },
  cellName: { flex: 1.7 },
  cellPhone: { flex: 1.3 },
  cellEmail: { flex: 2 },
  cellActions: {
    flex: 1.6,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  emptyState: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    color: '#757575',
    fontSize: 14,
  },
  errorText: {
    color: '#D32F2F',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
  rejectButton: {
    minWidth: 58,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#EEEEEE',
    marginRight: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectText: {
    color: '#757575',
    fontSize: 13,
  },
  acceptButton: {
    minWidth: 72,
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#187BCD',
    alignItems: 'center',
    justifyContent: 'center',
  },
  acceptText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  actionDisabled: {
    opacity: 0.6,
  },
  modalBackground: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalContainer: {
    width: '85%',
    maxWidth: 420,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
  },
  modalTitle: {
    color: '#187BCD',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  modalMessage: {
    width: '100%',
    color: '#455A64',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 14,
  },
  reasonInput: {
    width: '100%',
    minHeight: 96,
    borderWidth: 1,
    borderColor: '#BBDEFB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: '#455A64',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 8,
  },
  reasonInputError: {
    borderColor: '#D32F2F',
    backgroundColor: '#FFEBEE',
  },
  reasonErrorText: {
    width: '100%',
    color: '#D32F2F',
    fontSize: 12,
    marginBottom: 8,
  },
  modalActions: {
    width: '100%',
    flexDirection: 'row',
    marginTop: 4,
  },
  modalCancelButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#187BCD',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginRight: 8,
  },
  modalCancelButtonText: {
    color: '#187BCD',
    fontWeight: 'bold',
  },
  modalRejectButton: {
    flex: 1,
    backgroundColor: '#187BCD',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginLeft: 8,
  },
  modalRejectButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
  },
});
