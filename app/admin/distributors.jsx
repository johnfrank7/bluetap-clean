import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';

import { db } from '../../firebase';
import { getLocalUsers, subscribeLocalUsers, updateLocalUserStatus } from '../../localUsers';
import { getProfileUniqueId } from '../../services/uniqueIds';
import AdminShell, { ADMIN_COLORS, AdminPill } from '../../components/AdminShell';

const normalizeApplicationStatus = (status) =>
  (status || 'pending').toString().trim().toLowerCase();

const normalizeRole = (role) => (role || '').toString().trim().toLowerCase();

const getDistributorApplicationStatus = (distributor) =>
  normalizeApplicationStatus(
    distributor.status ||
      distributor.approvalStatus ||
      distributor.accountStatus ||
      'pending'
  );

const getRegisteredLocalDistributors = (firestoreDistributors = []) =>
  getLocalUsers()
    .filter(
      (user) =>
        normalizeRole(user.role) === 'distributor' &&
        getDistributorApplicationStatus(user) === 'approved'
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
  'Unnamed distributor';

const getBarangay = (user = {}) =>
  (user.barangay || user.address || 'Not set').toString().trim() || 'Not set';

const getJoinedLabel = (user = {}) => {
  const value = user.createdAt || user.created_at || user.joinedAt || user.joined;

  if (!value) return 'Not set';

  let date = null;

  if (typeof value?.toDate === 'function') {
    date = value.toDate();
  } else if (typeof value?.toMillis === 'function') {
    date = new Date(value.toMillis());
  } else if (value.seconds) {
    date = new Date(value.seconds * 1000);
  } else {
    date = new Date(value);
  }

  if (!date || Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    year: 'numeric',
  }).format(date);
};

export default function AdminDistributorsPage() {
  const [registeredDistributors, setRegisteredDistributors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [removingId, setRemovingId] = useState(null);

  useEffect(() => {
    let firestoreRegistered = [];

    const refreshRegisteredDistributors = (
      nextFirestoreRegistered = firestoreRegistered
    ) => {
      firestoreRegistered = nextFirestoreRegistered;
      setRegisteredDistributors([
        ...firestoreRegistered,
        ...getRegisteredLocalDistributors(firestoreRegistered),
      ]);
      setLoading(false);
    };

    refreshRegisteredDistributors();
    const unsubscribeLocalUsers = subscribeLocalUsers(() =>
      refreshRegisteredDistributors()
    );

    const registeredQuery = query(
      collection(db, 'users'),
      where('role', '==', 'distributor')
    );

    const unsubscribe = onSnapshot(
      registeredQuery,
      (snapshot) => {
        const firestoreDistributors = snapshot.docs
          .map((item) => ({
            id: item.id,
            uid: item.id,
            ...item.data(),
          }))
          .filter((item) => getDistributorApplicationStatus(item) === 'approved');

        refreshRegisteredDistributors(firestoreDistributors);
        setLoadError('');
      },
      (error) => {
        console.log('Registered distributors error:', error.message);
        setLoadError(error.message);
        refreshRegisteredDistributors();
      }
    );

    return () => {
      unsubscribe();
      unsubscribeLocalUsers();
    };
  }, []);

  const filteredDistributors = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    if (!normalizedSearch) return registeredDistributors;

    return registeredDistributors.filter((distributor) =>
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
  }, [registeredDistributors, search]);

  const removeDistributor = async (distributor) => {
    const id = distributor.uid || distributor.id;

    try {
      setRemovingId(id);
      updateLocalUserStatus(id, 'rejected');
      setRegisteredDistributors((current) =>
        current.filter((item) => item.uid !== id && item.id !== id)
      );

      try {
        const uniqueId = getProfileUniqueId(distributor);
        const removePayload = {
          uid: id,
          firstName: distributor.firstName || '',
          lastName: distributor.lastName || '',
          email: distributor.email || '',
          phone: distributor.phone || '',
          barangay: distributor.barangay || distributor.address || '',
          address: distributor.address || distributor.barangay || '',
          role: 'distributor',
          approvalStatus: 'rejected',
          status: 'Rejected',
          rejectionReason: distributor.rejectionReason || null,
          removedAt: serverTimestamp(),
        };

        if (uniqueId) {
          removePayload.unique_id = uniqueId;
        }

        await setDoc(doc(db, 'users', id), removePayload, { merge: true });
      } catch (error) {
        console.log('Distributor Firestore remove error:', error.message);
        Alert.alert(
          'Saved locally',
          'The distributor was removed on this device, but Firestore did not accept the change.'
        );
      }
    } catch (error) {
      console.log('Distributor remove error:', error.message);
      Alert.alert('Remove failed', error.message);
    } finally {
      setRemovingId(null);
    }
  };

  const confirmRemoveDistributor = (distributor, fullName) => {
    if (globalThis.confirm) {
      if (globalThis.confirm(`Remove ${fullName}?`)) {
        removeDistributor(distributor);
      }
      return;
    }

    Alert.alert('Remove distributor', `Remove ${fullName}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => removeDistributor(distributor),
      },
    ]);
  };

  return (
    <AdminShell
      active="distributors"
      title="Distributors"
      subtitle="All approved distributor accounts"
      searchValue={search}
      onSearchChange={setSearch}
    >
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Text style={styles.cardTitle}>
            Registered distributors ({registeredDistributors.length})
          </Text>
        </View>

        <View style={[styles.tableRow, styles.tableHeadRow]}>
          <Text style={[styles.th, styles.nameCol]}>NAME</Text>
          <Text style={[styles.th, styles.idCol]}>UNIQUE ID</Text>
          <Text style={[styles.th, styles.contactCol]}>CONTACT</Text>
          <Text style={[styles.th, styles.emailCol]}>EMAIL</Text>
          <Text style={[styles.th, styles.barangayCol]}>BARANGAY</Text>
          <Text style={[styles.th, styles.joinedCol]}>JOINED</Text>
          <Text style={[styles.th, styles.statusCol]}>STATUS</Text>
          <Text style={[styles.th, styles.actionsCol]}>ACTIONS</Text>
        </View>

        {loading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color={ADMIN_COLORS.blue} size="small" />
          </View>
        ) : filteredDistributors.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>No registered distributors yet.</Text>
            {!!loadError && <Text style={styles.errorText}>Firestore: {loadError}</Text>}
          </View>
        ) : (
          filteredDistributors.map((distributor) => {
            const fullName = getFullName(distributor);
            const distributorId = distributor.uid || distributor.id;
            const isRemoving = removingId === distributorId;

            return (
              <View key={distributorId || distributor.email} style={styles.tableRow}>
                <Text style={[styles.tdName, styles.nameCol]} numberOfLines={1}>
                  {fullName}
                </Text>
                <Text style={[styles.td, styles.idCol]} numberOfLines={1}>
                  {getProfileUniqueId(distributor) || 'Not set'}
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
                <Text style={[styles.td, styles.joinedCol]} numberOfLines={1}>
                  {getJoinedLabel(distributor)}
                </Text>
                <View style={[styles.statusCell, styles.statusCol]}>
                  <AdminPill tone="green">Active</AdminPill>
                </View>
                <View style={[styles.actionsCell, styles.actionsCol]}>
                  <TouchableOpacity
                    activeOpacity={0.82}
                    style={[styles.removeButton, isRemoving && styles.actionDisabled]}
                    onPress={() => confirmRemoveDistributor(distributor, fullName)}
                    disabled={isRemoving}
                  >
                    <Text style={styles.removeButtonText}>
                      {isRemoving ? 'Removing...' : 'Remove'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </View>
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
    flex: 1.25,
  },
  idCol: {
    flex: 1,
  },
  contactCol: {
    flex: 1,
  },
  emailCol: {
    flex: 1.55,
  },
  barangayCol: {
    flex: 0.95,
  },
  joinedCol: {
    flex: 0.82,
  },
  statusCol: {
    flex: 0.75,
  },
  actionsCol: {
    flex: 0.75,
    textAlign: 'right',
  },
  statusCell: {
    alignItems: 'flex-start',
  },
  actionsCell: {
    alignItems: 'flex-end',
  },
  removeButton: {
    borderRadius: 999,
    backgroundColor: '#FFE9E9',
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  removeButtonText: {
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
});
