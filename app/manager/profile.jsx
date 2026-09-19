import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import ManagerShell, { MANAGER_COLORS, ManagerPill, ManagerWaterDrop } from '../../components/ManagerShell';

export default function ManagerProfilePage() {
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
            <ManagerWaterDrop color={MANAGER_COLORS.cyan} size={30} />
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

const styles = StyleSheet.create({
  card: {
    backgroundColor: MANAGER_COLORS.card,
    borderWidth: 1,
    borderColor: MANAGER_COLORS.border,
    borderRadius: 16,
    padding: 22,
  },
  avatarRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: MANAGER_COLORS.border,
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
    color: MANAGER_COLORS.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  profileMeta: {
    color: MANAGER_COLORS.muted,
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
    borderColor: MANAGER_COLORS.border,
    borderRadius: 12,
    padding: 16,
    backgroundColor: '#FAFDFF',
  },
  detailLabel: {
    color: MANAGER_COLORS.muted,
    fontSize: 11,
    fontWeight: 'bold',
  },
  detailValue: {
    color: MANAGER_COLORS.text,
    fontSize: 15,
    fontWeight: 'bold',
    marginTop: 8,
  },
});
