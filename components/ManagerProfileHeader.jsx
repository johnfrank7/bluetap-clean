import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import BlueTapIcon from './BlueTapIcon';
import { ManagerPill } from './ManagerShell';
import ProfileAvatar from './ProfileAvatar';

const CAMERA = require('../assets/icons/sidebar/camera.svg');
const TRASH = require('../assets/icons/sidebar/trash-2.svg');

export default function ManagerProfileHeader({
  colors, name, email, photoUri, loading, editing, saving, canRemovePhoto,
  onChoosePhoto, onRemovePhoto, onEdit, editDisabled,
}) {
  return (
    <View style={[styles.header, { borderBottomColor: colors.border }]}>
      <View style={styles.identityRow}>
        <View style={[styles.avatar, { backgroundColor: colors.primarySoft, borderColor: colors.border }]}>
          <ProfileAvatar uri={photoUri} name={name || 'Manager'} initialsStyle={[styles.initials, { color: colors.textPrimary }]} />
        </View>
        <View style={styles.identity}>
          {loading && !name ? <ActivityIndicator color={colors.primary} size="small" style={styles.loader} /> : (
            <Text style={[styles.name, { color: colors.textPrimary }]} numberOfLines={2}>{name || email || 'Manager'}</Text>
          )}
          <Text style={[styles.role, { color: colors.textSecondary }]}>Branch manager</Text>
          <View style={styles.badge}><ManagerPill tone="blue">Manager</ManagerPill></View>
        </View>
        {!editing && (
          <Pressable accessibilityRole="button" accessibilityLabel="Edit Profile" accessibilityHint="Opens the profile edit form" disabled={editDisabled} onPress={onEdit}
            style={({ hovered, focused, pressed }) => [styles.edit, { backgroundColor: colors.surface, borderColor: focused ? colors.primary : colors.border }, (hovered || pressed) && { backgroundColor: colors.primarySoft }, editDisabled && styles.disabled]}>
            <BlueTapIcon color={colors.iconInteractive || colors.primary} name="edit" size={18} />
          </Pressable>
        )}
      </View>
      {editing && (
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" accessibilityLabel="Change photo" accessibilityState={{ disabled: saving }} disabled={saving} onPress={onChoosePhoto}
            style={({ hovered, focused, pressed }) => [styles.action, { backgroundColor: colors.primarySoft, borderColor: focused ? colors.primary : colors.border }, (hovered || pressed) && { borderColor: colors.primary }, saving && styles.disabled]}>
            <Image source={CAMERA} contentFit="contain" tintColor={colors.iconInteractive || colors.primary} transition={0} accessible={false} style={styles.icon} />
            <Text style={[styles.actionText, { color: colors.iconInteractive || colors.primary }]}>Change photo</Text>
          </Pressable>
          {canRemovePhoto && (
            <Pressable accessibilityRole="button" accessibilityLabel="Remove photo" accessibilityState={{ disabled: saving }} disabled={saving} onPress={onRemovePhoto}
              style={({ hovered, focused, pressed }) => [styles.action, { backgroundColor: colors.surface, borderColor: colors.danger }, (hovered || focused || pressed) && { backgroundColor: colors.dangerSoft }, saving && styles.disabled]}>
              <Image source={TRASH} contentFit="contain" tintColor={colors.danger} transition={0} accessible={false} style={styles.icon} />
              <Text style={[styles.actionText, { color: colors.danger }]}>Remove photo</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { borderBottomWidth: 1, paddingBottom: 16 },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 14, minWidth: 0 },
  avatar: { width: 80, height: 80, borderRadius: 40, borderWidth: 2, alignItems: 'center', justifyContent: 'center', overflow: 'hidden', flexShrink: 0 },
  initials: { fontSize: 22, fontWeight: '800' },
  identity: { flex: 1, minWidth: 0 },
  loader: { alignSelf: 'flex-start', marginBottom: 4 },
  name: { fontSize: 20, lineHeight: 25, fontWeight: '800', flexShrink: 1 },
  role: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  badge: { alignSelf: 'flex-start', marginTop: 6 },
  edit: { width: 44, height: 44, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  action: { minHeight: 44, paddingHorizontal: 12, borderWidth: 1, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, flexShrink: 1 },
  icon: { width: 16, height: 16, flexShrink: 0 },
  actionText: { fontSize: 12, fontWeight: '800', flexShrink: 1 },
  disabled: { opacity: 0.7 },
});
