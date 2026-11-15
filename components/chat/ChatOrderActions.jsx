import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import { useBlueTapTheme } from '../BlueTapTheme';
import { useAdminTheme } from '../AdminTheme';
import { useChat } from './ChatContext';

const clean = (value) => String(value || '').trim();
const normalizedStatus = (value) => clean(value).toLowerCase().replace(/[_-]+/g, ' ');
const DISTRIBUTOR_CHAT_ACTION_LABEL = 'Message';
const TERMINAL = new Set(['delivered', 'completed', 'cancelled', 'canceled', 'rejected', 'declined', 'declined outside service area']);
import { mapResolveError, orderIdOf } from './chatModel';

export { orderIdOf };

const CHAT_ICON = require('../../assets/icons/chat/message-circle.svg');

function ActionButton({
  busy,
  colors,
  disabled = false,
  label,
  icon,
  iconOnly = false,
  tooltip,
  accessibilityLabel,
  onPress,
  secondary = false,
  softPrimary = false,
  style,
  hitSlop,
}) {
  const foreground = secondary || softPrimary ? colors.primary : colors.onPrimary;
  const accessibleName = accessibilityLabel || tooltip || label;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibleName}
      title={tooltip || accessibleName}
      accessibilityState={{ busy, disabled: busy || disabled }}
      disabled={busy || disabled}
      onPress={onPress}
      hitSlop={hitSlop || (iconOnly ? { top: 3, bottom: 3, left: 3, right: 3 } : undefined)}
      style={({ focused, hovered, pressed }) => [
        styles.button,
        secondary
          ? {
              backgroundColor: colors.surface,
              borderColor: colors.primary,
              borderWidth: 1,
            }
          : softPrimary
            ? {
                backgroundColor: colors.primarySoft,
                borderColor: colors.primary,
                borderWidth: 1,
              }
            : {
                backgroundColor: colors.primaryAction,
                borderColor: colors.primaryAction,
                borderWidth: 1,
              },
        iconOnly && styles.iconOnlyButton,
        style,
        hovered && !disabled && !busy && styles.hovered,
        pressed && !disabled && !busy && styles.pressed,
        focused && {
          borderColor: colors.primaryLight || colors.primary,
          borderWidth: 2,
        },
        (busy || disabled) && styles.disabled,
      ]}
    >
      {busy ? (
        <ActivityIndicator size="small" color={foreground} />
      ) : iconOnly && icon ? (
        <Image
          source={icon}
          contentFit="contain"
          tintColor={foreground}
          transition={0}
          accessible={false}
          style={{ width: 18, height: 18 }}
        />
      ) : (
        <Text style={[styles.label, { color: foreground }]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function RequesterOrderChatActions({ order, compact = false, disabled = false }) {
  const { colors } = useBlueTapTheme();
  const { openBlueTapConversation } = useChat();
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
      await openBlueTapConversation(
        kind === 'branch'
          ? { type: 'requester_branch', intent: 'order_followup', orderId, order }
          : { type: 'requester_distributor', orderId, order }
      );
    } catch (openError) {
      setError(mapResolveError(openError) || 'Unable to open conversation. Please try again.');
    } finally {
      setBusy('');
    }
  };

  return (
    <View style={[styles.wrap, compact && styles.compact]}>
      <ActionButton busy={busy === 'branch'} disabled={disabled || Boolean(busy)} colors={colors} label="Follow Up" onPress={() => open('branch')} secondary />
      {Boolean(hasDistributor) ? <ActionButton busy={busy === 'distributor'} disabled={disabled || Boolean(busy)} colors={colors} label="Message Distributor" onPress={() => open('distributor')} /> : null}
      {!!error && <Text accessibilityRole="alert" style={[styles.error, { color: colors.danger }]}>{error}</Text>}
    </View>
  );
}

export function DistributorOrderChatAction({ order, style, disabled = false }) {
  const { colors } = useBlueTapTheme();
  const { openBlueTapConversation } = useChat();
  const [busy, setBusy] = React.useState(false);
  const active = orderIdOf(order) && !TERMINAL.has(normalizedStatus(order?.status)) && Boolean(clean(order?.requesterUid || order?.requester_id || order?.userId || order?.user_id));
  if (!active) return null;
  const open = async () => {
    setBusy(true);
    try {
      await openBlueTapConversation({ type: 'requester_distributor', orderId: orderIdOf(order), order });
    } catch {} finally {
      setBusy(false);
    }
  };
  return <ActionButton busy={busy} disabled={disabled} colors={colors} label={DISTRIBUTOR_CHAT_ACTION_LABEL} onPress={open} softPrimary style={style} />;
}

export function ManagerOrderChatAction({
  order,
  style,
  disabled = false,
  iconOnly = true,
  accessibilityLabel = 'Message requester',
  tooltip = 'Message requester',
}) {
  const { colors } = useAdminTheme();
  const { openBlueTapConversation } = useChat();
  const [busy, setBusy] = React.useState(false);
  const orderId = orderIdOf(order);
  if (!orderId || !clean(order?.requesterUid || order?.requester_id || order?.userId || order?.user_id)) return null;
  const open = async () => {
    setBusy(true);
    try {
      await openBlueTapConversation({ type: 'requester_branch', intent: 'order_followup', orderId, order });
    } catch {} finally {
      setBusy(false);
    }
  };
  return (
    <ActionButton
      busy={busy}
      disabled={disabled}
      colors={colors}
      label="Message"
      icon={CHAT_ICON}
      iconOnly={iconOnly}
      accessibilityLabel={accessibilityLabel}
      tooltip={tooltip}
      onPress={open}
      secondary
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 10 },
  compact: { marginTop: 8 },
  button: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 124,
    minWidth: 0,
    minHeight: 44,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconOnlyButton: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 'auto',
    minWidth: 0,
    paddingHorizontal: 0,
  },
  label: { fontSize: 12, fontWeight: '900' },
  hovered: { opacity: 0.9 },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.6 },
  error: { width: '100%', fontSize: 11, lineHeight: 16 },
});
