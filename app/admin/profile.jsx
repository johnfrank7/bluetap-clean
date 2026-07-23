import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import AdminShell, { ADMIN_COLORS, AdminPill, AdminWaterDrop } from '../../components/AdminShell';

export default function AdminProfilePage() {
  return (
    <AdminShell
      active="profile"
      title="Profile"
      subtitle="BlueTap administrator workspace"
      searchPlaceholder="Search users, barangay..."
    >
      <View style={styles.card}>
        <View style={styles.avatarRow}>
          <View style={styles.avatar}>
            <AdminWaterDrop color={ADMIN_COLORS.cyan} size={30} />
          </View>
          <View style={styles.profileText}>
            <Text style={styles.profileName}>BlueTap Admin</Text>
            <Text style={styles.profileMeta}>System administrator</Text>
          </View>
          <AdminPill tone="blue">Admin</AdminPill>
        </View>

        <View style={styles.detailGrid}>
          <View style={styles.detailBox}>
            <Text style={styles.detailLabel}>Workspace</Text>
            <Text style={styles.detailValue}>BlueTap</Text>
          </View>
          <View style={styles.detailBox}>
            <Text style={styles.detailLabel}>Access</Text>
            <Text style={styles.detailValue}>Admin panel</Text>
          </View>
          <View style={styles.detailBox}>
            <Text style={styles.detailLabel}>Theme</Text>
            <Text style={styles.detailValue}>BlueTap blue</Text>
          </View>
        </View>
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
    padding: 22,
  },
  avatarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: ADMIN_COLORS.border,
    paddingBottom: 18,
  },
  avatar: {
    width: 58,
    height: 58,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E1F8F6',
    marginRight: 14,
  },
  profileText: {
    flex: 1,
  },
  profileName: {
    color: ADMIN_COLORS.text,
    fontSize: 18,
    fontWeight: 'bold',
  },
  profileMeta: {
    color: ADMIN_COLORS.muted,
    fontSize: 13,
    marginTop: 4,
  },
  detailGrid: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  detailBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: ADMIN_COLORS.border,
    borderRadius: 8,
    padding: 16,
    backgroundColor: '#FAFDFF',
  },
  detailLabel: {
    color: ADMIN_COLORS.muted,
    fontSize: 11,
    fontWeight: 'bold',
  },
  detailValue: {
    color: ADMIN_COLORS.text,
    fontSize: 15,
    fontWeight: 'bold',
    marginTop: 8,
  },
});
