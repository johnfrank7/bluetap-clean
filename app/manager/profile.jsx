import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { useAdminTheme } from '../../components/AdminTheme';
import ManagerShell, { MANAGER_COLORS, ManagerPill, ManagerWaterDrop } from '../../components/ManagerShell';
import { useManagerRealtimeData } from '../../components/ManagerRealtimeData';
import { getModuleSession } from '../../services/authSession';
import { formatPhilippinePhone } from '../../services/phoneUtils';
import { getProfileUniqueId } from '../../services/uniqueIds';

const clean = (value, fallback = 'Not set') =>
  typeof value === 'string' && value.trim() ? value.trim() : fallback;

export default function ManagerProfilePage() {
  const { colors } = useAdminTheme(); const styles = createStyles(colors);
  const session = getModuleSession('manager');
  const { users, branch: workspaceBranch, loading, error: loadError } = useManagerRealtimeData();
  const workspaceManager = users.find((user) => user.id === session?.uid || user.uid === session?.uid) || null;

  // Authoritative values — workspace API is preferred, session is the fallback for
  // data already persisted at login (branchId, branchName, email).
  const managerFullName = clean(workspaceManager?.fullName, '');
  const managerUid = getProfileUniqueId(workspaceManager || session || {}) || (loading ? '—' : 'Not set');
  const rawContact = clean(workspaceManager?.phone || workspaceManager?.contactNumber || session?.phone || session?.contactNumber, '');
  const managerContact = rawContact ? formatPhilippinePhone(rawContact) : (loading ? '—' : 'Not set');
  const managerEmail = clean(workspaceManager?.email || session?.email, '');
  const branchName = clean(workspaceBranch?.name || session?.branchName, 'Not assigned');
  const branchBarangay = clean(workspaceBranch?.barangay, '');
  const branchCity = clean(workspaceBranch?.city, '');

  const branchLocation = [branchBarangay, branchCity].filter(Boolean).join(', ') || 'Not set';

  return (
    <ManagerShell
      active="profile"
      title="Profile"
      subtitle="Your Manager workspace and branch assignment"
      searchPlaceholder="Search users, barangay..."
    >
      <View style={styles.card}>
        <View style={styles.avatarRow}>
          <View style={styles.avatar}>
            <ManagerWaterDrop color={colors.primaryLight} size={30} />
          </View>
          <View style={styles.profileText}>
            {loading && !managerFullName ? (
              <ActivityIndicator color={colors.primary} size="small" style={styles.nameLoader} />
            ) : (
              <Text style={styles.profileName} numberOfLines={1}>
                {managerFullName || managerEmail || 'Manager'}
              </Text>
            )}
            <Text style={styles.profileMeta}>Branch Manager · {branchName}</Text>
          </View>
          <ManagerPill tone="blue">Manager</ManagerPill>
        </View>

        {!!loadError && (
          <View accessibilityRole="alert" style={styles.errorBanner}>
            <Text style={styles.errorText}>{loadError}</Text>
          </View>
        )}

        <View style={styles.detailGrid}>
          <View style={styles.detailBox}>
            <Text style={styles.detailLabel}>UID</Text>
            <Text style={styles.detailValue} numberOfLines={1}>
              {managerUid}
            </Text>
          </View>
          <View style={styles.detailBox}>
            <Text style={styles.detailLabel}>Full Name</Text>
            <Text style={styles.detailValue} numberOfLines={1}>
              {managerFullName || (loading ? '—' : 'Not set')}
            </Text>
          </View>
          <View style={styles.detailBox}>
            <Text style={styles.detailLabel}>Contact Number</Text>
            <Text style={styles.detailValue} numberOfLines={1}>
              {managerContact}
            </Text>
          </View>
          <View style={styles.detailBox}>
            <Text style={styles.detailLabel}>Email Address</Text>
            <Text style={styles.detailValue} numberOfLines={1}>
              {managerEmail || (loading ? '—' : 'Not set')}
            </Text>
          </View>
          <View style={styles.detailBox}>
            <Text style={styles.detailLabel}>Location</Text>
            <Text style={styles.detailValue} numberOfLines={1}>
              {branchLocation}
            </Text>
          </View>
          <View style={styles.detailBox}>
            <Text style={styles.detailLabel}>Branch</Text>
            <Text style={styles.detailValue} numberOfLines={1}>
              {branchName}
            </Text>
          </View>
          <View style={styles.detailBox}>
            <Text style={styles.detailLabel}>Access level</Text>
            <Text style={styles.detailValue}>Manager panel</Text>
          </View>
        </View>
      </View>
    </ManagerShell>
  );
}

const createStyles = (colors) => StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    padding: 22,
  },
  avatarRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    paddingBottom: 18,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E1F8F6',
    marginRight: 14,
  },
  profileText: {
    flex: 1,
    minWidth: 0,
  },
  nameLoader: {
    alignSelf: 'flex-start',
    marginBottom: 4,
  },
  profileName: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: 'bold',
  },
  profileMeta: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 4,
  },
  errorBanner: {
    backgroundColor: colors.dangerSoft,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: 10,
    padding: 10,
    marginTop: 14,
  },
  errorText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: '700',
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 18,
  },
  detailBox: {
    flex: 1,
    flexBasis: 180,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 16,
    backgroundColor: colors.surfaceAlt,
  },
  detailLabel: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: 'bold',
  },
  detailValue: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: 'bold',
    marginTop: 8,
  },
});
