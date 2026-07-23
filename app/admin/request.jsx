import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';

import { db } from '../../firebase';
import { getLocalUsers, subscribeLocalUsers, updateLocalUserStatus } from '../../localUsers';
import { getProfileUniqueId, saveUserProfileWithUniqueId } from '../../services/uniqueIds';
import AdminShell, {
  ADMIN_COLORS,
  AdminPill,
} from '../../components/AdminShell';

const normalizeApplicationStatus = (status) =>
  (status || 'pending').toString().trim().toLowerCase();

const normalizeRole = (role) => (role || '').toString().trim().toLowerCase();

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
        normalizeRole(user.role) === 'distributor' &&
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

const getFullName = (user = {}) =>
  `${user.firstName || ''} ${user.lastName || ''}`.trim() ||
  user.full_name ||
  user.fullName ||
  user.email ||
  'Unnamed user';

const getBarangay = (user = {}) =>
  (user.barangay || user.address || 'Not set').toString().trim() || 'Not set';

const buildDistributorUpdate = (distributor, approvalStatus, rejectionReason = '') => {
  const uid = distributor.uid || distributor.id;
  const isRejected = approvalStatus === 'rejected';
  const uniqueId = getProfileUniqueId(distributor);

  const update = {
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

  if (uniqueId) {
    update.unique_id = uniqueId;
  }

  return update;
};

export default function AdminRequestPage() {
  const [pendingDistributors, setPendingDistributors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [updatingId, setUpdatingId] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
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

  const filteredDistributors = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) return pendingDistributors;

    return pendingDistributors.filter((distributor) =>
      [
        getFullName(distributor),
        getProfileUniqueId(distributor),
        distributor.phone,
        distributor.email,
        getBarangay(distributor),
      ]
        .join(' ')
        .toLowerCase()
        .includes(normalizedSearch)
    );
  }, [pendingDistributors, search]);

  const updateDistributorStatus = async (distributor, approvalStatus, reason = '') => {
    const id = distributor.uid || distributor.id;
    const rejectionReason = reason.trim();

    if (approvalStatus === 'rejected' && !rejectionReason) {
      setRejectionReasonError('Rejection reason is required.');
      return;
    }

    try {
      setUpdatingId(id);
      let distributorWithUniqueId = distributor;

      try {
        distributorWithUniqueId = await saveUserProfileWithUniqueId(
          id,
          'distributor',
          {
            uid: id,
            role: 'distributor',
          }
        );
      } catch (error) {
        console.log('Distributor Unique ID review error:', error.message);
      }

      updateLocalUserStatus(id, approvalStatus, { rejectionReason });
      setPendingDistributors((current) =>
        current.filter((distributor) => distributor.uid !== id && distributor.id !== id)
      );

      try {
        await setDoc(
          doc(db, 'users', id),
          buildDistributorUpdate(
            {
              ...distributor,
              ...distributorWithUniqueId,
            },
            approvalStatus,
            rejectionReason
          ),
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
    <AdminShell
      active="requests"
      title="Requests"
      subtitle="Pending distributor approvals"
      searchValue={search}
      onSearchChange={setSearch}
    >
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>
            Pending approvals ({pendingDistributors.length})
          </Text>
        </View>

        <View style={[styles.tableRow, styles.tableHeadRow]}>
          <Text style={[styles.th, styles.nameCol]}>NAME</Text>
          <Text style={[styles.th, styles.idCol]}>UNIQUE ID</Text>
          <Text style={[styles.th, styles.contactCol]}>CONTACT</Text>
          <Text style={[styles.th, styles.emailCol]}>EMAIL</Text>
          <Text style={[styles.th, styles.barangayCol]}>BARANGAY</Text>
          <Text style={[styles.th, styles.roleCol]}>ROLE</Text>
          <Text style={[styles.th, styles.actionsCol]}>ACTIONS</Text>
        </View>

        {loading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color={ADMIN_COLORS.blue} size="small" />
          </View>
        ) : filteredDistributors.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No pending distributors.</Text>
            {!!loadError && <Text style={styles.errorText}>Firestore: {loadError}</Text>}
          </View>
        ) : (
          filteredDistributors.map((distributor) => {
            const distributorId = distributor.uid || distributor.id;
            const isUpdating = updatingId === distributorId;

            return (
              <View key={distributorId || distributor.email} style={styles.tableRow}>
                <Text style={[styles.tdName, styles.nameCol]} numberOfLines={1}>
                  {getFullName(distributor)}
                </Text>
                <Text style={[styles.td, styles.idCol]} numberOfLines={1}>
                  {getProfileUniqueId(distributor) || 'Pending'}
                </Text>
                <Text style={[styles.td, styles.contactCol]} numberOfLines={1}>
                  {distributor.phone || 'Not set'}
                </Text>
                <Text style={[styles.tdLink, styles.emailCol]} numberOfLines={1}>
                  {distributor.email || 'Not set'}
                </Text>
                <Text style={[styles.td, styles.barangayCol]} numberOfLines={1}>
                  {getBarangay(distributor)}
                </Text>
                <View style={[styles.roleCell, styles.roleCol]}>
                  <AdminPill tone="cyan">Distributor</AdminPill>
                </View>
                <View style={[styles.actionButtons, styles.actionsCol]}>
                  <TouchableOpacity
                    activeOpacity={0.82}
                    style={[styles.acceptButton, isUpdating && styles.actionDisabled]}
                    onPress={() => updateDistributorStatus(distributor, 'approved')}
                    disabled={isUpdating}
                  >
                    <Text style={styles.acceptButtonText}>
                      {isUpdating ? 'Saving...' : 'Accept'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.82}
                    style={[styles.rejectButton, isUpdating && styles.actionDisabled]}
                    onPress={() => openRejectModal(distributor)}
                    disabled={isUpdating}
                  >
                    <Text style={styles.rejectButtonText}>Reject</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </View>

      <Modal visible={!!rejectingDistributor} transparent animationType="fade">
        <View style={styles.modalBackground}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Reject application</Text>
            <Text style={styles.modalMessage}>
              Enter the reason this distributor application is being rejected.
            </Text>

            <TextInput
              style={[
                styles.reasonInput,
                !!rejectionReasonError && styles.reasonInputError,
              ]}
              placeholder="Reason"
              placeholderTextColor="#95A6B8"
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
                activeOpacity={0.82}
                style={styles.modalCancelButton}
                onPress={closeRejectModal}
                disabled={isSavingRejection}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.82}
                style={[
                  styles.modalRejectButton,
                  isSavingRejection && styles.actionDisabled,
                ]}
                onPress={submitRejection}
                disabled={isSavingRejection}
              >
                <Text style={styles.modalRejectText}>
                  {isSavingRejection ? 'Saving...' : 'Save rejection'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </AdminShell>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: ADMIN_COLORS.card,
    borderWidth: 1,
    borderColor: ADMIN_COLORS.border,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
  },
  cardHeader: {
    marginBottom: 18,
  },
  cardTitle: {
    color: ADMIN_COLORS.text,
    fontSize: 16,
    fontWeight: 'bold',
  },
  tableRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: ADMIN_COLORS.border,
  },
  tableHeadRow: {
    minHeight: 38,
  },
  th: {
    color: ADMIN_COLORS.muted,
    fontSize: 11,
    fontWeight: 'bold',
  },
  td: {
    color: ADMIN_COLORS.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  tdName: {
    color: ADMIN_COLORS.text,
    fontSize: 13,
    fontWeight: 'bold',
  },
  tdLink: {
    color: ADMIN_COLORS.blue,
    fontSize: 13,
    fontWeight: '600',
  },
  nameCol: {
    flex: 1.35,
  },
  idCol: {
    flex: 1,
  },
  contactCol: {
    flex: 1,
  },
  emailCol: {
    flex: 1.65,
  },
  barangayCol: {
    flex: 1,
  },
  roleCol: {
    flex: 0.9,
  },
  actionsCol: {
    flex: 1.15,
    textAlign: 'right',
  },
  roleCell: {
    alignItems: 'flex-start',
  },
  actionButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
  },
  acceptButton: {
    borderRadius: 999,
    backgroundColor: '#E3F8EF',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  acceptButtonText: {
    color: ADMIN_COLORS.green,
    fontSize: 12,
    fontWeight: 'bold',
  },
  rejectButton: {
    borderRadius: 999,
    backgroundColor: '#FFE9E9',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  rejectButtonText: {
    color: ADMIN_COLORS.red,
    fontSize: 12,
    fontWeight: 'bold',
  },
  actionDisabled: {
    opacity: 0.6,
  },
  emptyState: {
    minHeight: 96,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    color: ADMIN_COLORS.muted,
    fontSize: 13,
    fontWeight: '600',
  },
  errorText: {
    color: ADMIN_COLORS.red,
    fontSize: 12,
    marginTop: 8,
  },
  modalBackground: {
    flex: 1,
    backgroundColor: 'rgba(6, 36, 71, 0.46)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '90%',
    maxWidth: 430,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: ADMIN_COLORS.border,
    padding: 22,
  },
  modalTitle: {
    color: ADMIN_COLORS.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  modalMessage: {
    color: ADMIN_COLORS.muted,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 8,
    marginBottom: 14,
  },
  reasonInput: {
    minHeight: 104,
    borderWidth: 1,
    borderColor: ADMIN_COLORS.border,
    borderRadius: 8,
    color: ADMIN_COLORS.text,
    fontSize: 14,
    lineHeight: 19,
    paddingHorizontal: 12,
    paddingVertical: 10,
    outlineStyle: 'none',
  },
  reasonInputError: {
    borderColor: ADMIN_COLORS.red,
    backgroundColor: '#FFF7F7',
  },
  reasonErrorText: {
    color: ADMIN_COLORS.red,
    fontSize: 12,
    marginTop: 7,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 16,
  },
  modalCancelButton: {
    minWidth: 92,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: ADMIN_COLORS.blue,
    backgroundColor: '#FFFFFF',
  },
  modalCancelText: {
    color: ADMIN_COLORS.blue,
    fontSize: 13,
    fontWeight: 'bold',
  },
  modalRejectButton: {
    minWidth: 122,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 20,
    backgroundColor: '#FFE9E9',
  },
  modalRejectText: {
    color: ADMIN_COLORS.red,
    fontSize: 13,
    fontWeight: 'bold',
  },
});
