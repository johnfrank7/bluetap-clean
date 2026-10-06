import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { useBlueTapTheme } from '../BlueTapTheme';
import { useAdminTheme } from '../AdminTheme';
import { useChat } from './ChatContext';

const clean = (value) => String(value || '').trim();
const normalizedStatus = (value) => clean(value).toLowerCase().replace(/[_-]+/g, ' ');
const TERMINAL = new Set(['delivered', 'completed', 'cancelled', 'canceled', 'rejected', 'declined', 'declined outside service area']);
const orderIdOf = (order = {}) => {
  const source = clean(order.sourceId);
  if (source && source !== 'Not set') return source;
  return clean(order.id || order.requestId || order.request_id);
};

function ActionButton({ busy, colors, disabled = false, label, onPress, secondary = false, softPrimary = false, style }) {
  const foreground = secondary || softPrimary ? colors.primary : colors.onPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ busy, disabled: busy || disabled }}
      disabled={busy || disabled}
      onPress={onPress}
      style={({ focused, hovered, pressed }) => [
        styles.button,
        style,
        secondary
          ? { backgroundColor: colors.surface, borderColor: colors.primary }
          : softPrimary
            ? { backgroundColor: colors.primarySoft, borderColor: colors.primary }
            : { backgroundColor: colors.primaryAction, borderColor: colors.primaryAction },
        hovered && !disabled && !busy && styles.hovered,
        focused && { borderColor: colors.primaryLight || colors.primary, borderWidth: 2 },
        pressed && styles.pressed,
        (busy || disabled) && styles.disabled,
      ]}
    >
      {busy ? <ActivityIndicator size="small" color={foreground} /> : <Text style={[styles.label, { color: foreground }]}>{label}</Text>}
    </Pressable>
  );
}

export function RequesterOrderChatActions({ order, compact = false, disabled = false }) {
  const { colors } = useBlueTapTheme();
  const { resolveAndOpen } = useChat();
  const [busy, setBusy] = React.useState('');
  const [error, setError] = React.useState('');
  const orderId = orderIdOf(order);
  const active = orderId && !TERMINAL.has(normalizedStatus(order?.status));
  const hasDistributor = active && Boolean(clean(order?.assignedDistributorUid || order?.distributor_id));
  if (!active) return null;

  const open = async (kind) => {
    setBusy(kind);
    setError('');
    try {
      await resolveAndOpen(
        kind === 'branch'
          ? { type: 'requester_branch', intent: 'order_followup', orderId }
          : { type: 'requester_distributor', orderId },
        order
      );
    } catch (openError) {
      setError('Unable to open conversation. Please try again.');
    } finally {
      setBusy('');
    }
  };

  return (
    <View style={[styles.wrap, compact && styles.compact]}>
      <ActionButton busy={busy === 'branch'} disabled={disabled || Boolean(busy)} colors={colors} label="Follow Up" onPress={() => open('branch')} secondary />
      {hasDistributor && <ActionButton busy={busy === 'distributor'} disabled={disabled || Boolean(busy)} colors={colors} label="Message Distributor" onPress={() => open('distributor')} />}
      {!!error && <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>{error}</Text>}
    </View>
  );
}

export function DistributorOrderChatAction({ order, style, disabled = false }) {
  const { colors } = useBlueTapTheme();
  const { resolveAndOpen } = useChat();
  const [busy, setBusy] = React.useState(false);
  const active = orderIdOf(order) && !TERMINAL.has(normalizedStatus(order?.status)) && Boolean(clean(order?.requesterUid || order?.requester_id));
  if (!active) return null;
  const open = async () => {
    setBusy(true);
    try { await resolveAndOpen({ type: 'requester_distributor', orderId: orderIdOf(order) }, order); } catch {} finally { setBusy(false); }
  };
  return <ActionButton busy={busy} disabled={disabled} colors={colors} label="Message Requester" onPress={open} softPrimary style={style} />;
}

export function ManagerOrderChatAction({ order, disabled = false }) {
  const { colors } = useAdminTheme();
  const { resolveAndOpen } = useChat();
  const [busy, setBusy] = React.useState(false);
  const orderId = orderIdOf(order);
  if (!orderId || !clean(order?.requesterUid || order?.requester_id)) return null;
  const open = async () => {
    setBusy(true);
    try { await resolveAndOpen({ type: 'requester_branch', intent: 'order_followup', orderId }, order); } catch {} finally { setBusy(false); }
  };
  return <ActionButton busy={busy} disabled={disabled} colors={colors} label="Message Requester" onPress={open} secondary />;
}

const styles = StyleSheet.create({
  wrap: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10 },
  compact: { marginTop: 8 },
  button: { flexGrow: 1, flexBasis: 124, minWidth: 0, minHeight: 44, paddingHorizontal: 10, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 12, fontWeight: '900' },
  hovered: { opacity: 0.94 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.7 },
  error: { width: '100%', fontSize: 11, lineHeight: 16 },
});
