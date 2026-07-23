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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useRouter } from 'expo-router';
import { db } from '../../firebase';
import { collection, doc, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { getLocalUsers, subscribeLocalUsers, updateLocalUserStatus } from '../../localUsers';
import { getLocalRequests } from '../../services/requests';
import { signOutAndClearSessions } from '../../services/authSession';
import { getProfileUniqueId } from '../../services/uniqueIds';
import { createShadow } from '../../components/shadowStyles';

const normalizeApplicationStatus = (status) =>
  (status || 'pending').toString().trim().toLowerCase();

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
        user.role === 'distributor' &&
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

const defaultStations = ['aquabea', 'bluetap'];

const getRequestQuantity = (request) => {
  if (Array.isArray(request.items) && request.items.length > 0) {
    return request.items.reduce(
      (sum, item) => sum + Number(item.quantity || 0),
      0
    );
  }

  return Number(request.quantity || 0);
};

const mergeByIdentity = (items) => {
  const itemMap = new Map();

  items.forEach((item) => {
    const key = item.uid || item.id || item.email;
    if (key) {
      itemMap.set(key, item);
    }
  });

  return Array.from(itemMap.values());
};

export default function AdminDashboard() {
  const router = useRouter();
  const [registeredDistributors, setRegisteredDistributors] = useState([]);
  const [dashboardStats, setDashboardStats] = useState({
    registeredUsers: 0,
    productSales: 0,
    stations: defaultStations.length,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
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

  useEffect(() => {
    let firestoreUsers = [];
    let firestoreRequests = [];

    const refreshDashboardStats = () => {
      const allUsers = mergeByIdentity([
        ...firestoreUsers,
        ...getLocalUsers(),
      ]);
      const localRequests = getLocalRequests();
      const requestIds = new Set(firestoreRequests.map((item) => item.id));
      const allRequests = [
        ...firestoreRequests,
        ...localRequests.filter((item) => !requestIds.has(item.id)),
      ];
      const stationNames = new Set(defaultStations);

      allRequests.forEach((request) => {
        if (request.water_station) {
          stationNames.add(String(request.water_station).trim().toLowerCase());
        }
      });

      setDashboardStats({
        registeredUsers: allUsers.length,
        productSales: allRequests.reduce(
          (sum, request) => sum + getRequestQuantity(request),
          0
        ),
        stations: stationNames.size,
      });
    };

    refreshDashboardStats();
    const unsubscribeLocalUsers = subscribeLocalUsers(refreshDashboardStats);

    const unsubscribeUsers = onSnapshot(
      collection(db, 'users'),
      (snapshot) => {
        firestoreUsers = snapshot.docs.map((item) => ({
          id: item.id,
          uid: item.id,
          ...item.data(),
        }));
        refreshDashboardStats();
      },
      (error) => {
        console.log('Dashboard users metric error:', error.message);
        refreshDashboardStats();
      }
    );

    const unsubscribeRequests = onSnapshot(
      collection(db, 'requests'),
      (snapshot) => {
        firestoreRequests = snapshot.docs.map((item) => ({
          id: item.id,
          ...item.data(),
        }));
        refreshDashboardStats();
      },
      (error) => {
        console.log('Dashboard requests metric error:', error.message);
        refreshDashboardStats();
      }
    );

    return () => {
      unsubscribeUsers();
      unsubscribeRequests();
      unsubscribeLocalUsers();
    };
  }, []);

  const handleLogout = async () => {
    await signOutAndClearSessions();
    router.replace('/login');
  };

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

        await setDoc(
          doc(db, 'users', id),
          removePayload,
          { merge: true }
        );
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
//hi
    Alert.alert(
      'Remove distributor',
      `Remove ${fullName}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => removeDistributor(distributor),
        },
      ]
    );
  };

  const diagramItems = [
    {
      label: 'Registered Users',
      value: dashboardStats.registeredUsers,
      helper: 'Active app accounts',
    },
    {
      label: 'Product Sales',
      value: dashboardStats.productSales,
      helper: 'Total gallons ordered',
    },
    {
      label: 'Stations',
      value: dashboardStats.stations,
      helper: 'Available stations',
    },
  ];
  const maxDiagramValue = Math.max(
    ...diagramItems.map((item) => item.value),
    1
  );

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
            <Text style={styles.stationName}>BlueTap</Text>
          </View>

          <TouchableOpacity
            style={[styles.navItem, styles.navItemActive]}
            onPress={() => router.replace('/admin/dashboard')}
          >
            <Text style={[styles.navItemText, styles.navItemTextActive]}>Dashboard</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navItem}
            onPress={() => router.replace('/admin/products')}
          >
            <Text style={styles.navItemText}>Products</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.navItem}
            onPress={() => router.replace('/admin/request')}
          >
            <Text style={styles.navItemText}>Request</Text>
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

          {/* Registered distributors table */}
          <ScrollView contentContainerStyle={styles.cardScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.diagramCard}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Data Overview</Text>
              </View>

              <View style={styles.diagramGrid}>
                {diagramItems.map((item, index) => {
                  const barWidth = `${Math.max(
                    10,
                    (item.value / maxDiagramValue) * 100
                  )}%`;

                  return (
                    <View
                      key={item.label}
                      style={[
                        styles.diagramItem,
                        index === diagramItems.length - 1 && styles.diagramItemLast,
                      ]}
                    >
                      <Text style={styles.diagramLabel}>{item.label}</Text>
                      <Text style={styles.diagramValue}>{item.value}</Text>
                      <View style={styles.diagramBarTrack}>
                        <View style={[styles.diagramBarFill, { width: barWidth }]} />
                      </View>
                      <Text style={styles.diagramHelper}>{item.helper}</Text>
                    </View>
                  );
                })}
              </View>
            </View>

            <View style={styles.card}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>Registered Distributors</Text>
              </View>

              {/* Table header */}
              <View style={[styles.row, styles.tableHeaderRow]}>
                <Text style={[styles.cell, styles.cellNameHeader]}>Name</Text>
                <Text style={[styles.cell, styles.cellIdHeader]}>Unique ID</Text>
                <Text style={[styles.cell, styles.cellPhoneHeader]}>Contact Number</Text>
                <Text style={[styles.cell, styles.cellEmailHeader]}>Email Address</Text>
                <Text style={[styles.cell, styles.cellActionsHeader]}>Actions</Text>
              </View>

              {loading ? (
                <View style={styles.emptyState}>
                  <ActivityIndicator size="small" color="#187BCD" />
                </View>
              ) : registeredDistributors.length === 0 ? (
                <View style={styles.emptyState}>
                  <Text style={styles.emptyText}>No registered distributors yet.</Text>
                  {!!loadError && (
                    <Text style={styles.errorText}>Firestore: {loadError}</Text>
                  )}
                </View>
              ) : (
                registeredDistributors.map((d, idx) => {
                  const fullName = `${d.firstName || ''} ${d.lastName || ''}`.trim() || 'Unnamed distributor';
                  const distributorId = d.uid || d.id;
                  const isRemoving = removingId === distributorId;

                  return (
                    <View
                      key={d.id}
                      style={[styles.row, idx % 2 === 1 && styles.rowStriped]}
                    >
                      <Text style={[styles.cell, styles.cellName]}>{fullName}</Text>
                      <Text style={[styles.cell, styles.cellId]}>
                        {getProfileUniqueId(d) || 'Not set'}
                      </Text>
                      <Text style={[styles.cell, styles.cellPhone]}>{d.phone || 'Not set'}</Text>
                      <Text style={[styles.cell, styles.cellEmail]}>{d.email || 'Not set'}</Text>
                      <View style={[styles.cell, styles.cellActions]}>
                        <TouchableOpacity
                          style={[styles.removeButton, isRemoving && styles.actionDisabled]}
                          onPress={() => confirmRemoveDistributor(d, fullName)}
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
          </ScrollView>
        </View>
      </View>
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
    ...createShadow({
      color: '#000',
      elevation: 3,
      opacity: 0.08,
      radius: 8,
      offset: { width: 0, height: 2 },
    }),
  },
  diagramCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 20,
    marginBottom: 16,
    ...createShadow({
      color: '#000',
      elevation: 3,
      opacity: 0.08,
      radius: 8,
      offset: { width: 0, height: 2 },
    }),
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
  diagramGrid: {
    flexDirection: 'row',
  },
  diagramItem: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E3F2FD',
    borderRadius: 8,
    padding: 14,
    marginRight: 12,
    backgroundColor: '#FAFDFF',
  },
  diagramItemLast: {
    marginRight: 0,
  },
  diagramLabel: {
    color: '#455A64',
    fontSize: 13,
    fontWeight: '600',
  },
  diagramValue: {
    color: '#187BCD',
    fontSize: 26,
    fontWeight: 'bold',
    marginTop: 8,
  },
  diagramBarTrack: {
    height: 8,
    borderRadius: 8,
    backgroundColor: '#E3F2FD',
    marginTop: 12,
    overflow: 'hidden',
  },
  diagramBarFill: {
    height: '100%',
    borderRadius: 8,
    backgroundColor: '#187BCD',
  },
  diagramHelper: {
    color: '#78909C',
    fontSize: 12,
    marginTop: 8,
  },
  removeButton: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1.5,
    borderColor: '#FCA5A5',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  removeButtonText: {
    color: '#EF4444',
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
  cellIdHeader: { flex: 1.1, fontWeight: 'bold' },
  cellPhoneHeader: { flex: 1.4, fontWeight: 'bold' },
  cellEmailHeader: { flex: 2, fontWeight: 'bold' },
  cellActionsHeader: { flex: 1, fontWeight: 'bold', textAlign: 'right' },
  cellName: { flex: 1.7 },
  cellId: { flex: 1.1 },
  cellPhone: { flex: 1.4 },
  cellEmail: { flex: 2 },
  cellActions: {
    flex: 1,
    alignItems: 'flex-end',
  },
  actionDisabled: {
    opacity: 0.6,
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
});
