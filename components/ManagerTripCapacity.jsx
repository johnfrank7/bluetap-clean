import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import DropdownChevron from './DropdownChevron';
import { describeOrderCargo } from '../services/managerTripCapacity';

export default function ManagerTripCapacity({
  currentContainers = 0,
  orderContainers = 0,
  orderCargo = null,
  existingTripCargo = null,
  hasOtherCargo = false,
  otherCargoCount = 0,
  otherCargoSummary = '',
  isPhysicalLoadVerified = true,
  maxCapacity = 60,
  colors = {},
  isDark = false,
  conflict = false,
  conflictMessage = '',
  isExistingTrip = false,
  tripNumber = 1,
  slotLabel = '',
  assignedOrders = [],
  explanation = '',
  distributorName = '',
  scheduledDateLabel = '',
}) {
  const [showOrders, setShowOrders] = useState(false);
  const projected = currentContainers + orderContainers;
  const isOverCapacity = projected > maxCapacity;
  const remaining5Gal = Math.max(0, maxCapacity - projected);
  const fillPercent = Math.min(100, Math.round((projected / maxCapacity) * 100));

  const hasUnknownLoad = Boolean(orderCargo?.hasUnknownCargo || existingTripCargo?.hasUnknownCargo);

  // Compute other cargo counts strictly according to trip and candidate order:
  // If this is a NEW trip (!isExistingTrip), other cargo ONLY comes from the candidate order!
  const candidateOtherCount = orderCargo?.otherCargoCount || 0;
  const existingOtherCount = isExistingTrip ? (existingTripCargo?.otherCargoCount || 0) : 0;
  const totalOtherCargoCount = (otherCargoCount && isExistingTrip ? otherCargoCount : 0) ||
    (existingOtherCount + candidateOtherCount);

  const hasOther = Boolean(
    (isExistingTrip && (hasOtherCargo || existingOtherCount > 0 || existingTripCargo?.hasOtherCargo)) ||
    candidateOtherCount > 0 ||
    orderCargo?.hasOtherCargo
  );

  // Determine badge label and status tone
  let badgeLabel = '';
  let badgeIsError = false;
  let badgeIsWarning = false;

  if (hasUnknownLoad) {
    badgeLabel = '⚠️ Catalog Review Required';
    badgeIsError = true;
  } else if (isOverCapacity) {
    badgeLabel = `Over Capacity (+${projected - maxCapacity})`;
    badgeIsError = true;
  } else if (hasOther) {
    badgeLabel = `${remaining5Gal} remaining (Other Cargo Loaded)`;
  } else {
    badgeLabel = `${remaining5Gal} remaining`;
  }

  const barColor = isOverCapacity || hasUnknownLoad
    ? (colors.error || '#ef4444')
    : fillPercent >= 90
    ? (colors.warning || '#f59e0b')
    : (colors.primary || '#187BCD');

  // Assigned orders count
  const ordersCount = Array.isArray(assignedOrders) ? assignedOrders.length : 0;

  const cardBg = isDark ? '#0f172a' : '#ffffff';
  const cardBorder = isDark ? '#334155' : colors.border || '#e2e8f0';
  const statBg = isDark ? 'rgba(30, 41, 59, 0.7)' : '#f8fafc';
  const statBorder = isDark ? '#334155' : '#e2e8f0';

  return (
    <View style={[styles.container, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      {/* 1. Header Card with Trip Title, Distributor, Schedule & Status Chip */}
      <View style={styles.headerBlock}>
        <View style={styles.headerTopRow}>
          <View style={styles.headerTitleWrap}>
            <Text style={[styles.title, { color: colors.textPrimary || '#0f172a' }]}>
              {isExistingTrip
                ? `Co-Loading: Trip #${tripNumber} (${slotLabel || 'Selected Slot'})`
                : `New Trip #${tripNumber} (${slotLabel || 'Selected Slot'})`}
            </Text>
            {(distributorName || scheduledDateLabel) ? (
              <View style={styles.headerMetaRow}>
                {distributorName ? (
                  <Text numberOfLines={1} style={[styles.headerMetaText, { color: colors.textSecondary || '#64748b' }]}>
                    🚚 {distributorName}
                  </Text>
                ) : null}
                {scheduledDateLabel ? (
                  <Text numberOfLines={1} style={[styles.headerMetaText, { color: colors.textSecondary || '#64748b' }]}>
                    📅 {scheduledDateLabel}
                  </Text>
                ) : null}
              </View>
            ) : null}
          </View>

          <View style={styles.badgeWrap}>
            <View
              style={[
                styles.statusChip,
                {
                  backgroundColor: isExistingTrip
                    ? (isDark ? 'rgba(56, 189, 248, 0.16)' : 'rgba(24, 123, 205, 0.12)')
                    : (isDark ? 'rgba(34, 197, 94, 0.16)' : 'rgba(16, 185, 129, 0.12)'),
                  borderColor: isExistingTrip
                    ? (isDark ? '#38bdf8' : '#187BCD')
                    : (isDark ? '#4ade80' : '#10b981'),
                },
              ]}
            >
              <Text
                style={[
                  styles.statusChipText,
                  {
                    color: isExistingTrip
                      ? (isDark ? '#38bdf8' : '#187BCD')
                      : (isDark ? '#4ade80' : '#059669'),
                  },
                ]}
              >
                {isExistingTrip ? 'Co-Loading' : 'New Trip'}
              </Text>
            </View>

            <Text
              style={[
                styles.badge,
                (badgeIsError || badgeIsWarning) && styles.badgeBold,
                {
                  color: badgeIsError
                    ? (colors.error || '#ef4444')
                    : badgeIsWarning
                    ? (colors.warning || '#f59e0b')
                    : (colors.primary || '#187BCD'),
                },
              ]}
            >
              {badgeLabel}
            </Text>
          </View>
        </View>
      </View>

      {/* 2. Four Compact Visual Stat Chips */}
      <View style={styles.statsGrid}>
        {/* Chip 1: Assigned Orders */}
        <View style={[styles.statTile, { backgroundColor: statBg, borderColor: statBorder }]}>
          <Text style={[styles.statTileLabel, { color: colors.textSecondary || '#64748b' }]}>
            Assigned Orders
          </Text>
          <Text style={[styles.statTileValue, { color: colors.textPrimary || '#0f172a' }]}>
            {isExistingTrip
              ? `${ordersCount} order${ordersCount === 1 ? '' : 's'} assigned`
              : '0 existing (1 pending)'}
          </Text>
        </View>

        {/* Chip 2: 5-Gal Used */}
        <View style={[styles.statTile, { backgroundColor: statBg, borderColor: statBorder }]}>
          <Text style={[styles.statTileLabel, { color: colors.textSecondary || '#64748b' }]}>
            5-Gal Used
          </Text>
          <Text style={[styles.statTileValue, { color: barColor }]}>
            {`${projected} / ${maxCapacity}`}
          </Text>
        </View>

        {/* Chip 3: Other Cargo */}
        <View style={[styles.statTile, { backgroundColor: statBg, borderColor: statBorder }]}>
          <Text style={[styles.statTileLabel, { color: colors.textSecondary || '#64748b' }]}>
            Other Cargo
          </Text>
          <Text
            style={[
              styles.statTileValue,
              {
                color: hasOther
                  ? (isDark ? '#f472b6' : '#9333ea')
                  : (colors.textSecondary || '#64748b'),
              },
            ]}
          >
            {hasOther ? `${totalOtherCargoCount} items` : '0 items'}
          </Text>
        </View>

        {/* Chip 4: Remaining 5-Gal Capacity */}
        <View style={[styles.statTile, { backgroundColor: statBg, borderColor: statBorder }]}>
          <Text style={[styles.statTileLabel, { color: colors.textSecondary || '#64748b' }]}>
            Remaining 5-Gal
          </Text>
          <Text
            style={[
              styles.statTileValue,
              {
                color: isOverCapacity
                  ? (colors.error || '#ef4444')
                  : (colors.primary || '#187BCD'),
              },
            ]}
          >
            {`${remaining5Gal} left`}
          </Text>
        </View>
      </View>

      {/* 3. Small 5-Gallon Utilization Progress Bar */}
      <View style={[styles.progressSection, { backgroundColor: statBg, borderColor: statBorder }]}>
        <View style={styles.barHeaderRow}>
          <Text style={[styles.barLabel, { color: colors.textPrimary || '#0f172a' }]}>
            5-Gallon Container Utilization
          </Text>
          <Text style={[styles.barMetric, { color: barColor }]}>
            {`${projected} / ${maxCapacity} containers (${fillPercent}% 5-gal)`}
          </Text>
        </View>

        <View
          accessibilityRole="progressbar"
          accessibilityLabel="5-Gallon Container Utilization"
          accessibilityValue={{ min: 0, max: maxCapacity, now: Math.min(projected, maxCapacity) }}
          style={[styles.track, { backgroundColor: isDark ? 'rgba(255, 255, 255, 0.12)' : '#e2e8f0' }]}
        >
          <View style={[styles.fill, { width: `${fillPercent}%`, backgroundColor: barColor }]} />
        </View>
      </View>

      {/* 4. Expandable Assigned Orders in this Trip */}
      {isExistingTrip && Array.isArray(assignedOrders) && assignedOrders.length > 0 && (
        <View style={styles.assignedOrdersWrap}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityState={{ expanded: showOrders }}
            onPress={() => setShowOrders((prev) => !prev)}
            style={[
              styles.toggleOrdersBtn,
              {
                borderColor: isDark ? '#334155' : colors.border || '#cbd5e1',
                backgroundColor: isDark ? 'rgba(30, 41, 59, 0.5)' : '#ffffff',
              },
            ]}
          >
            <Text style={[styles.toggleOrdersText, { color: colors.primary || '#187BCD' }]}>
              {showOrders
                ? `Hide ${assignedOrders.length} Assigned Order${assignedOrders.length === 1 ? '' : 's'} in this Trip`
                : `View ${assignedOrders.length} Assigned Order${assignedOrders.length === 1 ? '' : 's'} in this Trip`}
            </Text>
            <DropdownChevron expanded={showOrders} size={15} color={colors.primary || '#187BCD'} />
          </TouchableOpacity>

          {showOrders && (
            <View style={styles.ordersList}>
              {assignedOrders.map((ord) => {
                const cargo = describeOrderCargo(ord);
                const statusStr = String(ord.status || 'scheduled').replace(/_/g, ' ');
                const statusCap = statusStr.charAt(0).toUpperCase() + statusStr.slice(1);
                return (
                  <View
                    key={ord.id || ord.requestId}
                    style={[
                      styles.orderItemCard,
                      {
                        backgroundColor: isDark ? 'rgba(15, 23, 42, 0.85)' : '#ffffff',
                        borderColor: isDark ? '#334155' : colors.border || '#e2e8f0',
                      },
                    ]}
                  >
                    <View style={styles.orderItemTop}>
                      <Text style={[styles.orderItemId, { color: colors.textPrimary || '#0f172a' }]}>
                        #{ord.requestId || ord.id}
                      </Text>
                      <View
                        style={[
                          styles.orderItemStatus,
                          {
                            backgroundColor: isDark
                              ? 'rgba(56, 189, 248, 0.15)'
                              : 'rgba(24, 123, 205, 0.10)',
                          },
                        ]}
                      >
                        <Text style={[styles.orderItemStatusText, { color: colors.primary || '#187BCD' }]}>
                          {statusCap}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.orderItemDetails, { color: colors.textSecondary || '#64748b' }]}>
                      {ord.requesterName || 'Requester'} · {cargo.summary}
                    </Text>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      )}

      {/* 5. Action Area Blocker Alert: Only genuine blockers shown */}
      {conflict ? (
        <View accessibilityRole="alert" style={styles.warningBox}>
          <Text style={[styles.warningText, { color: colors.error || '#ef4444' }]}>
            ⚠️ {conflictMessage || 'Distributor has another trip scheduled within 30 minutes turnaround.'}
          </Text>
        </View>
      ) : isOverCapacity ? (
        <View accessibilityRole="alert" style={styles.warningBox}>
          <Text style={[styles.warningText, { color: colors.error || '#ef4444' }]}>
            ⚠️ Exceeds maximum 60-container trip capacity by {projected - maxCapacity} container{projected - maxCapacity === 1 ? '' : 's'}. Choose a different trip slot or distributor.
          </Text>
        </View>
      ) : hasUnknownLoad ? (
        <View accessibilityRole="alert" style={styles.warningBox}>
          <Text style={[styles.warningText, { color: colors.error || '#ef4444' }]}>
            ⚠️ Physical trip load for one or more items is unknown. Review product catalog specifications before assigning.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderWidth: 1.5,
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    marginBottom: 6,
    gap: 8,
  },
  headerBlock: {
    gap: 3,
  },
  headerTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 8,
  },
  headerTitleWrap: {
    flex: 1,
    gap: 2,
  },
  title: {
    fontSize: 12,
    fontWeight: '800',
    lineHeight: 16,
  },
  headerMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 2,
  },
  headerMetaText: {
    fontSize: 11,
    fontWeight: '600',
  },
  badgeWrap: {
    alignItems: 'flex-end',
    gap: 3,
  },
  statusChip: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 5,
    borderWidth: 1,
  },
  statusChipText: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },
  badge: {
    fontSize: 11,
    fontWeight: '700',
  },
  badgeBold: {
    fontWeight: '800',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  statTile: {
    flex: 1,
    minWidth: 80,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    gap: 2,
  },
  statTileLabel: {
    fontSize: 9,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.2,
  },
  statTileValue: {
    fontSize: 11,
    fontWeight: '800',
  },
  progressSection: {
    borderWidth: 1,
    borderRadius: 8,
    padding: 8,
    gap: 5,
  },
  barHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 6,
  },
  barLabel: {
    fontSize: 11,
    fontWeight: '800',
  },
  barMetric: {
    fontSize: 11,
    fontWeight: '800',
  },
  track: {
    height: 6,
    borderRadius: 3,
    overflow: 'hidden',
    width: '100%',
  },
  fill: {
    height: '100%',
    borderRadius: 3,
  },
  assignedOrdersWrap: {
    gap: 5,
  },
  toggleOrdersBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  toggleOrdersText: {
    fontSize: 11,
    fontWeight: '700',
  },
  toggleOrdersArrow: {
    fontSize: 11,
    fontWeight: '800',
  },
  ordersList: {
    gap: 5,
    marginTop: 2,
  },
  orderItemCard: {
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    gap: 3,
  },
  orderItemTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  orderItemId: {
    fontSize: 11,
    fontWeight: '800',
  },
  orderItemStatus: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  orderItemStatusText: {
    fontSize: 9,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  orderItemDetails: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500',
  },
  warningBox: {
    padding: 8,
    borderRadius: 6,
    borderWidth: 1,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderColor: 'rgba(239, 68, 68, 0.25)',
  },
  warningText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '700',
  },
});
