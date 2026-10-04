import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, useWindowDimensions } from 'react-native';
import { useBlueTapTheme } from '../BlueTapTheme';
import { createShadow } from '../shadowStyles';

export function OrderCard({ card = {}, onAction }) {
  const { colors, isDark } = useBlueTapTheme();
  const { width } = useWindowDimensions();
  const isNarrow = width < 350;
  const {
    publicOrderId,
    statusLabel,
    status,
    branchName,
    schedule,
    productSummary,
    total,
    safeFailureReason,
    isFailed,
    isOutsideRadius,
    id,
    branchId,
  } = card;

  const isTerminalSuccess = status === 'delivered';
  const badgeBg = isFailed
    ? (isDark ? '#48262A' : '#FCE9E8')
    : isOutsideRadius
      ? (isDark ? '#493814' : '#FFF7E5')
      : isTerminalSuccess
        ? (isDark ? '#103B2A' : '#E3F7EC')
        : (isDark ? '#163B59' : '#EAF6FF');

  const badgeColor = isFailed
    ? (isDark ? '#EF4444' : '#B52F2F')
    : isOutsideRadius
      ? (isDark ? '#F59E0B' : '#A96800')
      : isTerminalSuccess
        ? (isDark ? '#22C55E' : '#167347')
        : (isDark ? '#70BDF2' : '#187BCD');

  return (
    <View style={[styles.card, { backgroundColor: isDark ? colors.surface : '#FFFFFF', borderColor: isDark ? colors.border : '#D7ECFF' }]}>
      <View style={styles.cardHeader}>
        <View style={styles.orderIdGroup}>
          <Text style={[styles.orderLabel, { color: colors.textSecondary }]}>ACTIVE WATER REQUEST</Text>
          <Text style={[styles.orderId, { color: colors.textPrimary }]}>{publicOrderId || 'Active Order'}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: badgeBg }]}>
          <Text style={[styles.statusBadgeText, { color: badgeColor }]}>{statusLabel || 'Pending'}</Text>
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: isDark ? colors.border : '#E5F1FA' }]} />

      <View style={styles.gridContainer}>
        <View style={[styles.gridCell, isNarrow && styles.gridCellNarrow, { backgroundColor: isDark ? colors.surfaceAlt : '#F8FAFD', borderColor: isDark ? colors.border : '#E6F0F9' }]}>
          <Text style={[styles.gridCellLabel, { color: colors.textSecondary }]}>STATION</Text>
          <Text style={[styles.gridCellValue, { color: colors.textPrimary }]} numberOfLines={1}>
            📍 {branchName || 'BlueTap Station'}
          </Text>
        </View>

        <View style={[styles.gridCell, isNarrow && styles.gridCellNarrow, { backgroundColor: isDark ? colors.surfaceAlt : '#F8FAFD', borderColor: isDark ? colors.border : '#E6F0F9' }]}>
          <Text style={[styles.gridCellLabel, { color: colors.textSecondary }]}>CONTAINER / ITEM</Text>
          <Text style={[styles.gridCellValue, { color: colors.textPrimary }]} numberOfLines={1}>
            🪣 {productSummary || 'Standard 5-Gal'}
          </Text>
        </View>

        <View style={[styles.gridCell, isNarrow && styles.gridCellNarrow, { backgroundColor: isDark ? colors.surfaceAlt : '#F8FAFD', borderColor: isDark ? colors.border : '#E6F0F9' }]}>
          <Text style={[styles.gridCellLabel, { color: colors.textSecondary }]}>SCHEDULE</Text>
          <Text style={[styles.gridCellValue, { color: colors.textPrimary }]} numberOfLines={1}>
            🕒 {schedule || 'Pending schedule'}
          </Text>
        </View>

        <View style={[styles.gridCell, isNarrow && styles.gridCellNarrow, { backgroundColor: isDark ? colors.surfaceAlt : '#F8FAFD', borderColor: isDark ? colors.border : '#E6F0F9' }]}>
          <Text style={[styles.gridCellLabel, { color: colors.textSecondary }]}>TOTAL</Text>
          <Text style={[styles.gridCellValue, { color: colors.primary, fontWeight: '700' }]} numberOfLines={1}>
            💵 {total || '—'}
          </Text>
        </View>
      </View>

      {Boolean(isOutsideRadius) && (
        <View style={[styles.noticeBox, { backgroundColor: isDark ? '#3D2A00' : '#FFF9E6', borderColor: isDark ? '#705300' : '#FFE082' }]}>
          <Text style={[styles.noticeText, { color: isDark ? '#FFD54F' : '#8D6E00' }]}>
            📍 Outside regular delivery radius — pending branch review.
          </Text>
        </View>
      )}

      {Boolean(isFailed && safeFailureReason) && (
        <View style={[styles.noticeBox, { backgroundColor: isDark ? '#3E181B' : '#FEECEC', borderColor: isDark ? '#7F2327' : '#FCA5A5' }]}>
          <Text style={[styles.noticeText, { color: isDark ? '#FCA5A5' : '#B91C1C' }]}>
            ⚠️ Delivery unsuccessful: {safeFailureReason}
          </Text>
        </View>
      )}

      {(Boolean(id) || Boolean(branchId)) && onAction && (
        <View style={styles.cardActions}>
          {Boolean(id) && (
            <TouchableOpacity
              activeOpacity={0.8}
              style={[styles.primaryActionBtn, { backgroundColor: colors.primary }]}
              onPress={() => onAction({ type: 'VIEW_ORDER', orderId: id })}
              accessibilityRole="button"
              accessibilityLabel="View Order Details"
            >
              <Text style={styles.primaryActionText}>View Details</Text>
            </TouchableOpacity>
          )}

          {Boolean(branchId) && (
            <TouchableOpacity
              activeOpacity={0.8}
              style={[
                styles.secondaryActionBtn,
                {
                  borderColor: isDark ? colors.border : colors.primary,
                  backgroundColor: isDark ? 'transparent' : 'rgba(24, 123, 205, 0.05)',
                },
              ]}
              onPress={() => onAction({ type: 'CONTACT_STATION', branchId, branchName })}
              accessibilityRole="button"
              accessibilityLabel="Contact Station"
            >
              <Text style={[styles.secondaryActionText, { color: isDark ? colors.primaryLight : colors.primary }]}>
                Contact Station
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

export function ProviderCard({ card = {}, onAction }) {
  const { colors, isDark } = useBlueTapTheme();
  const { name, address, coverageRadius, id } = card;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.orderLabel, { color: colors.primary }]}>WATER STATION</Text>
          <Text style={[styles.orderId, { color: colors.textPrimary }]}>{name || 'BlueTap Station'}</Text>
        </View>
      </View>

      {Boolean(address) && (
        <Text style={[styles.providerAddress, { color: colors.textSecondary }]}>📍 {address}</Text>
      )}

      {Boolean(coverageRadius) && (
        <Text style={[styles.providerRadius, { color: colors.textSecondary }]}>
          Coverage radius: ~{coverageRadius} km
        </Text>
      )}

      {onAction && (
        <View style={[styles.cardActions, { marginTop: 10 }]}>
          <TouchableOpacity
            activeOpacity={0.8}
            style={[styles.primaryActionBtn, { backgroundColor: colors.primary }]}
            onPress={() => onAction({ type: 'START_ORDER', branchId: id })}
          >
            <Text style={styles.primaryActionText}>Order from Station</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export function RestrictionCard({ card = {}, onAction }) {
  const { colors, isDark } = useBlueTapTheme();
  const { scope, branchName, category, endsAt, title, branchId } = card;

  const isOrdering = scope?.includes('ordering');
  const isBranchOnly = Boolean(branchName);

  return (
    <View style={[styles.card, {
      backgroundColor: isDark ? '#2D1B06' : '#FFFBF0',
      borderColor: isDark ? '#704205' : '#F59E0B',
      borderLeftWidth: 4,
      borderLeftColor: colors.warning,
    }]}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.orderLabel, { color: colors.warning }]}>SAFETY NOTICE</Text>
          <Text style={[styles.orderId, { color: colors.textPrimary }]}>
            {title || (isOrdering ? 'Ordering Restriction' : 'Chat Restriction')}
          </Text>
        </View>
      </View>

      <View style={styles.cardBody}>
        <Text style={[styles.restrictionBody, { color: colors.textPrimary }]}>
          {isBranchOnly
            ? `Applies to ${branchName}. You may still order from other active BlueTap stations.`
            : `Applies platform-wide across BlueTap.`}
        </Text>

        <View style={styles.infoRow}>
          <Text style={[styles.infoKey, { color: colors.textSecondary }]}>Category:</Text>
          <Text style={[styles.infoVal, { color: colors.textPrimary }]}>{category}</Text>
        </View>

        {Boolean(endsAt) && (
          <View style={styles.infoRow}>
            <Text style={[styles.infoKey, { color: colors.textSecondary }]}>Active Until:</Text>
            <Text style={[styles.infoVal, { color: colors.textPrimary }]}>{endsAt}</Text>
          </View>
        )}

        <Text style={[styles.restrictionPrivacyNote, { color: colors.textSecondary }]}>
          🔒 Reporter identity and private moderator notes are never disclosed.
        </Text>
      </View>

      {Boolean(branchId) && onAction && (
        <View style={[styles.cardActions, { marginTop: 10 }]}>
          <TouchableOpacity
            activeOpacity={0.8}
            style={[styles.secondaryActionBtn, { borderColor: colors.warning }]}
            onPress={() => onAction({ type: 'CONTACT_STATION', branchId, branchName })}
          >
            <Text style={[styles.secondaryActionText, { color: colors.warning }]}>Contact Station</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

export function NotificationCard({ card = {} }) {
  const { colors } = useBlueTapTheme();
  const { message, time } = card;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border, padding: 12 }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={[styles.orderLabel, { color: colors.primary }]}>NOTIFICATION</Text>
        {Boolean(time) && (
          <Text style={{ fontSize: 11, color: colors.textSecondary }}>{time}</Text>
        )}
      </View>
      <Text style={[styles.notificationMessage, { color: colors.textPrimary }]}>{message}</Text>
    </View>
  );
}

export function HelpCard({ card = {}, onAction }) {
  const { colors } = useBlueTapTheme();
  const { title, steps = [] } = card;

  return (
    <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <Text style={[styles.helpTitle, { color: colors.primary }]}>{title || 'How It Works'}</Text>
      <View style={[styles.divider, { backgroundColor: colors.border }]} />
      {steps.map((s, idx) => (
        <View key={idx} style={styles.stepRow}>
          <View style={[styles.stepBadge, { backgroundColor: colors.primarySoft }]}>
            <Text style={[styles.stepBadgeText, { color: colors.primary }]}>{s.step}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.stepItemTitle, { color: colors.textPrimary }]}>{s.title}</Text>
            <Text style={[styles.stepItemDetail, { color: colors.textSecondary }]}>{s.detail}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function DeliveryCard({ card = {}, onAction }) {
  const { colors, isDark } = useBlueTapTheme();
  const { width } = useWindowDimensions();
  const isNarrow = width < 350;
  const {
    publicOrderId,
    statusLabel,
    status,
    branchName,
    schedule,
    productSummary,
    requesterName,
    safeAddressLabel,
    safeFailureReason,
    isFailed,
    chatAllowed,
    id,
    branchId,
  } = card;

  const isTerminalSuccess = status === 'delivered';
  const badgeBg = isFailed
    ? (isDark ? '#48262A' : '#FCE9E8')
    : isTerminalSuccess
      ? (isDark ? '#103B2A' : '#E3F7EC')
      : (isDark ? '#163B59' : '#EAF6FF');

  const badgeColor = isFailed
    ? (isDark ? '#EF4444' : '#B52F2F')
    : isTerminalSuccess
      ? (isDark ? '#22C55E' : '#167347')
      : (isDark ? '#70BDF2' : '#187BCD');

  return (
    <View style={[styles.card, { backgroundColor: isDark ? colors.surface : '#FFFFFF', borderColor: isDark ? colors.border : '#D7ECFF' }]}>
      <View style={styles.cardHeader}>
        <View style={styles.orderIdGroup}>
          <Text style={[styles.orderLabel, { color: colors.textSecondary }]}>ASSIGNED DELIVERY</Text>
          <Text style={[styles.orderId, { color: colors.textPrimary }]}>{publicOrderId || 'Delivery'}</Text>
        </View>
        <View style={[styles.statusBadge, { backgroundColor: badgeBg }]}>
          <Text style={[styles.statusBadgeText, { color: badgeColor }]}>{statusLabel || 'Assigned'}</Text>
        </View>
      </View>

      <View style={[styles.divider, { backgroundColor: isDark ? colors.border : '#E5F1FA' }]} />

      <View style={styles.gridContainer}>
        <View style={[styles.gridCell, isNarrow && styles.gridCellNarrow, { backgroundColor: isDark ? colors.surfaceAlt : '#F8FAFD', borderColor: isDark ? colors.border : '#E6F0F9' }]}>
          <Text style={[styles.gridCellLabel, { color: colors.textSecondary }]}>CUSTOMER</Text>
          <Text style={[styles.gridCellValue, { color: colors.textPrimary }]} numberOfLines={1}>
            👤 {requesterName || 'Requester'}
          </Text>
        </View>

        <View style={[styles.gridCell, isNarrow && styles.gridCellNarrow, { backgroundColor: isDark ? colors.surfaceAlt : '#F8FAFD', borderColor: isDark ? colors.border : '#E6F0F9' }]}>
          <Text style={[styles.gridCellLabel, { color: colors.textSecondary }]}>SCHEDULE</Text>
          <Text style={[styles.gridCellValue, { color: colors.textPrimary }]} numberOfLines={1}>
            🕒 {schedule || 'Pending'}
          </Text>
        </View>

        <View style={[styles.gridCell, isNarrow && styles.gridCellNarrow, { backgroundColor: isDark ? colors.surfaceAlt : '#F8FAFD', borderColor: isDark ? colors.border : '#E6F0F9' }]}>
          <Text style={[styles.gridCellLabel, { color: colors.textSecondary }]}>ITEMS</Text>
          <Text style={[styles.gridCellValue, { color: colors.textPrimary }]} numberOfLines={1}>
            🪣 {productSummary || 'Mineral Water'}
          </Text>
        </View>

        <View style={[styles.gridCell, isNarrow && styles.gridCellNarrow, { backgroundColor: isDark ? colors.surfaceAlt : '#F8FAFD', borderColor: isDark ? colors.border : '#E6F0F9' }]}>
          <Text style={[styles.gridCellLabel, { color: colors.textSecondary }]}>STATION / AREA</Text>
          <Text style={[styles.gridCellValue, { color: colors.textPrimary }]} numberOfLines={1}>
            📍 {safeAddressLabel || branchName || 'BlueTap Station'}
          </Text>
        </View>
      </View>

      {Boolean(isFailed && safeFailureReason) && (
        <View style={[styles.noticeBox, { backgroundColor: isDark ? '#3E181B' : '#FEECEC', borderColor: isDark ? '#7F2327' : '#FCA5A5' }]}>
          <Text style={[styles.noticeText, { color: isDark ? '#FCA5A5' : '#B91C1C' }]}>
            ⚠️ Delivery unsuccessful: {safeFailureReason}
          </Text>
        </View>
      )}

      {onAction && (
        <View style={styles.cardActions}>
          {Boolean(id) && (
            <TouchableOpacity
              activeOpacity={0.8}
              style={[styles.primaryActionBtn, { backgroundColor: colors.primary }]}
              onPress={() => onAction({ type: 'VIEW_DELIVERY', orderId: id })}
              accessibilityRole="button"
              accessibilityLabel="View Delivery Details"
            >
              <Text style={styles.primaryActionText}>View Details</Text>
            </TouchableOpacity>
          )}

          {Boolean(chatAllowed && id) && (
            <TouchableOpacity
              activeOpacity={0.8}
              style={[
                styles.secondaryActionBtn,
                {
                  borderColor: isDark ? colors.border : colors.primary,
                  backgroundColor: isDark ? 'transparent' : 'rgba(24, 123, 205, 0.05)',
                },
              ]}
              onPress={() => onAction({ type: 'CONTACT_REQUESTER', orderId: id })}
              accessibilityRole="button"
              accessibilityLabel="Contact Requester"
            >
              <Text style={[styles.secondaryActionText, { color: isDark ? colors.primaryLight : colors.primary }]}>
                Contact Customer
              </Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

export default function AssistantCardRenderer({ card, onAction }) {
  if (!card || !card.type) return null;
  switch (card.type) {
    case 'order':
      return <OrderCard card={card} onAction={onAction} />;
    case 'delivery':
      return <DeliveryCard card={card} onAction={onAction} />;
    case 'provider':
      return <ProviderCard card={card} onAction={onAction} />;
    case 'restriction':
      return <RestrictionCard card={card} onAction={onAction} />;
    case 'notification':
      return <NotificationCard card={card} />;
    case 'help':
      return <HelpCard card={card} onAction={onAction} />;
    default:
      return null;
  }
}

export { AssistantCardRenderer };

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginTop: 8,
    width: '100%',
    ...createShadow({
      color: '#0D47A1',
      elevation: 3,
      opacity: 0.08,
      radius: 8,
      offset: { width: 0, height: 3 },
    }),
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  orderIdGroup: {
    flex: 1,
  },
  orderLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  orderId: {
    fontSize: 14,
    fontWeight: '800',
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginLeft: 8,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  divider: {
    height: 1,
    marginVertical: 8,
  },
  gridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  gridCell: {
    flexGrow: 1,
    flexBasis: '47%',
    minWidth: 110,
    paddingHorizontal: 8,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  gridCellNarrow: {
    flexBasis: '100%',
    width: '100%',
  },
  gridCellLabel: {
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  gridCellValue: {
    fontSize: 12,
    fontWeight: '600',
  },
  cardBody: {
    gap: 6,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  infoKey: {
    fontSize: 12,
  },
  infoVal: {
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
    flex: 1,
  },
  noticeBox: {
    marginTop: 6,
    padding: 8,
    borderRadius: 8,
    borderWidth: 1,
  },
  noticeText: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
  },
  cardActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 10,
    paddingTop: 6,
  },
  primaryActionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  secondaryActionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    fontSize: 12,
    fontWeight: '700',
  },
  providerAddress: {
    fontSize: 12,
    marginTop: 6,
  },
  providerRadius: {
    fontSize: 11,
    marginTop: 4,
  },
  restrictionBody: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  restrictionPrivacyNote: {
    fontSize: 11,
    fontStyle: 'italic',
    marginTop: 4,
  },
  notificationMessage: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 6,
  },
  helpTitle: {
    fontSize: 14,
    fontWeight: '800',
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    marginTop: 8,
  },
  stepBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBadgeText: {
    fontSize: 12,
    fontWeight: '800',
  },
  stepItemTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  stepItemDetail: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 2,
  },
});
