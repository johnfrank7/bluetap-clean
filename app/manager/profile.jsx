import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useAdminTheme } from '../../components/AdminTheme';
import ManagerShell, { MANAGER_COLORS, ManagerPill, ManagerWaterDrop } from '../../components/ManagerShell';

export default function ManagerProfilePage() {
  const { colors } = useAdminTheme(); const styles = createStyles(colors);
  return (
    <ManagerShell
      active="profile"
      title="Profile"
      subtitle="BlueTap manager workspace"
      searchPlaceholder="Search users, barangay..."
    >
      <View style={styles.card}>
        <View style={styles.avatarRow}>
          <View style={styles.avatar}>
            <ManagerWaterDrop color={colors.primaryLight} size={30} />
          </View>
          <View style={styles.profileText}>
            <Text style={styles.profileName}>BlueTap Manager</Text>
            <Text style={styles.profileMeta}>System manager</Text>
          </View>
          <ManagerPill tone="blue">Manager</ManagerPill>
        </View>

        <View style={styles.detailGrid}>
          <View style={styles.detailBox}>
            <Text style={styles.detailLabel}>Workspace</Text>
            <Text style={styles.detailValue}>BlueTap</Text>
          </View>
          <View style={styles.detailBox}>
            <Text style={styles.detailLabel}>Access</Text>
            <Text style={styles.detailValue}>Manager panel</Text>
          </View>
          <View style={styles.detailBox}>
            <Text style={styles.detailLabel}>Theme</Text>
            <Text style={styles.detailValue}>BlueTap blue</Text>
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
