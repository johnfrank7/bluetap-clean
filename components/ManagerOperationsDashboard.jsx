import React from 'react';
import { Animated, Easing, Image, useWindowDimensions, ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import ManagerShell from './ManagerShell';
import { useAdminTheme } from './AdminTheme';
import { useManagerRealtimeData } from './ManagerRealtimeData';
import { useManagerOngoingRequests } from './ManagerOngoingRequestsMonitor';
import SidebarIcon from './SidebarIcon';
import OngoingRequestFieldIcon from './OngoingRequestFieldIcon';
import SoftStatusBadge from './SoftStatusBadge';
import SalesOverviewContent from './SalesOverviewContent';
import useSingleFlightNavigation from './useSingleFlightNavigation';
import { useReducedMotionPreference } from './BlueTapThemeTransition';
import { useModerationActivitySignal } from './useModerationActivityBadge';
import { getManagerOrderAnalytics } from '../services/managerAnalytics';
import { loadModerationCases } from '../services/moderationApi';

const { getManagerWorkspace } = require('../services/managerWorkspace');
const {
  getManagerDashboardOperations,
  getOngoingDeliveryProgress,
  buildPriorityActions,
  buildDeliverySchedule,
  buildDistributorWorkload,
  buildBranchReviewsSummary,
  buildProductDeliveryRulesPreview,
  trustedScheduleMillis,
} = require('../services/managerDashboardOperations');
const {
  hasCompletedDashboardEntrance,
  markDashboardEntranceCompleted,
  getDashboardEntranceMotion,
  buildManagerOrderTargetRoute,
} = require('../services/managerOrderTargetNavigation');

function DashboardSectionEntrance({ sectionIndex, shouldAnimateEntrance, reduceMotion, style, children }) {
  const motion = React.useMemo(
    () =>
      getDashboardEntranceMotion({
        sectionIndex,
        reduceMotion,
        alreadyCompleted: !shouldAnimateEntrance,
      }),
    [sectionIndex, reduceMotion, shouldAnimateEntrance]
  );
  const opacity = React.useRef(new Animated.Value(motion.initialOpacity)).current;
  const translateY = React.useRef(new Animated.Value(motion.initialTranslateY)).current;

  React.useEffect(() => {
    if (!motion.shouldAnimate) {
      opacity.setValue(1);
      translateY.setValue(0);
      return undefined;
    }
    const animation = Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration: motion.durationMs,
        delay: motion.delayMs,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration: motion.durationMs,
        delay: motion.delayMs,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
    ]);
    animation.start();
    return () => animation.stop();
  }, [motion.shouldAnimate, motion.durationMs, motion.delayMs, opacity, translateY]);

  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY }] }]}>
      {children}
    </Animated.View>
  );
}

const SPACING = Object.freeze({
  pagePaddingDesktop: 24,
  sectionGap: 18,
  cardPadding: 20,
  cardPaddingCompact: 18,
  cardRadius: 16,
  itemGap: 8,
});

const count = (value) => Number(value || 0).toLocaleString('en-PH');

function scheduleLabel(order) {
  const at = trustedScheduleMillis(order?.scheduledAt || order?.scheduled_at || order?.scheduledDeliveryAt);
  if (at) {
    return new Intl.DateTimeFormat('en-PH', {
      timeZone: 'Asia/Manila', month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit',
    }).format(new Date(at));
  }
  const date = String(order?.scheduledDate || '').trim();
  const window = String(order?.scheduledWindow || '').trim();
  return date ? `${date}${window ? ` · ${window}` : ''}` : 'Not scheduled';
}

function ActionLink({ label, accessibilityLabel = label, onPress, colors, compact = false, chevron = false, inverse = false, onBanner = false }) {
  const foreground = onBanner ? colors.primaryAction : inverse ? colors.onPrimary : colors.iconInteractive || colors.primary;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} onPress={onPress}
      style={({ hovered, pressed }) => [styles.actionLink, compact && styles.compactAction,
        onBanner && { backgroundColor: colors.onPrimary },
        (hovered || pressed) && { backgroundColor: onBanner ? '#E3F2FD' : inverse ? colors.primaryHover : colors.primarySoft }]}
    >
      <Text style={[styles.actionText, { color: foreground }]}>{label}</Text>
      {chevron ? <Text accessibilityElementsHidden style={[styles.actionChevron, { color: foreground }]}>›</Text> : null}
    </Pressable>
  );
}

function KpiCard({ title, value, hint, icon, tone, colors, onPress, widthStyle, unavailable }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}: ${unavailable ? 'unavailable' : value}. ${hint}`}
      accessibilityState={{ disabled: unavailable }} disabled={unavailable} onPress={onPress}
      style={({ hovered, pressed }) => [
        styles.kpi,
        widthStyle,
        {
          backgroundColor: colors.surface,
          borderColor: hovered || pressed ? colors.primary : colors.border,
          borderLeftWidth: 4,
          borderLeftColor: tone.icon,
        },
        (hovered || pressed) && styles.kpiHover,
      ]}
    >
      <View style={styles.kpiTop}>
        <View style={styles.kpiMetric}>
          <View style={[styles.kpiIcon, { backgroundColor: tone.soft }]}>
            <SidebarIcon name={icon} size={22} tintColor={tone.icon} />
          </View>
          <Text style={[styles.kpiValue, { color: colors.textPrimary }]}>{unavailable ? '—' : count(value)}</Text>
        </View>
        <View style={[styles.kpiArrowBadge, { backgroundColor: colors.surfaceAlt }]}>
          <Text style={[styles.kpiArrow, { color: colors.iconInteractive || colors.primary }]}>↗</Text>
        </View>
      </View>
      <View style={styles.kpiCopy}>
        <View style={styles.kpiTitleRow}>
          <View style={[styles.kpiStatusDot, { backgroundColor: tone.icon }]} />
          <Text numberOfLines={1} style={[styles.kpiTitle, { color: colors.textPrimary }]}>{title}</Text>
        </View>
        <Text numberOfLines={1} style={[styles.kpiHint, { color: colors.textSecondary }]}>{hint}</Text>
      </View>
    </Pressable>
  );
}

function PriorityActionIcon({ iconName, tintColor }) {
  if (iconName === 'ClockHistory' || iconName === 'CalendarClock') {
    return <OngoingRequestFieldIcon name={iconName} size={17} color={tintColor} />;
  }
  return <SidebarIcon name={iconName} size={17} tintColor={tintColor} />;
}

function PriorityActionRow({ item, tones, colors, onAction, isLast = false }) {
  const tone = tones[item.toneKey] || tones.primary;
  const referencePrefix = item.orderId ? `#${item.reference}` : item.reference;
  return (
    <View style={[styles.attentionRow, !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
      <View style={[styles.attentionAccentBar, { backgroundColor: tone.icon }]} />
      <View style={[styles.rowIcon, { backgroundColor: tone.soft }]}>
        <PriorityActionIcon iconName={item.icon} tintColor={tone.icon} />
      </View>
      <View style={styles.attentionCopy}>
        <View style={styles.attentionTitleRow}>
          <Text numberOfLines={1} ellipsizeMode="tail" title={item.title} style={[styles.rowTitle, { color: colors.textPrimary }]}>{item.title}</Text>
          <View style={[styles.referencePill, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
            <Text numberOfLines={1} ellipsizeMode="tail" title={referencePrefix} style={[styles.referencePillText, { color: colors.textSecondary }]}>{referencePrefix}</Text>
          </View>
        </View>
        <Text numberOfLines={2} ellipsizeMode="tail" title={item.reason} style={[styles.rowMeta, { color: colors.textSecondary }]}>
          {item.reason}
        </Text>
      </View>
      <View style={styles.attentionRight}>
        <SoftStatusBadge status={item.badgeStatus} label={item.badgeLabel || undefined} compact />
        <View style={styles.attentionActionWrap}>
          <ActionLink
            label={item.actionLabel}
            accessibilityLabel={`${item.actionLabel} ${item.title} ${referencePrefix}`}
            onPress={() => onAction(item)}
            colors={colors}
            compact
            chevron
          />
        </View>
      </View>
    </View>
  );
}

function DeliveryStageTrack({ order, colors }) {
  const progress = getOngoingDeliveryProgress(order);
  if (progress.isException) {
    return (
      <View
        accessibilityLabel="Delivery stage: Delivery issue reported, requires recovery"
        style={[styles.deliveryExceptionBar, { backgroundColor: colors.dangerSoft, borderColor: colors.danger }]}
      >
        <SidebarIcon name="ShieldAlert" size={13} tintColor={colors.iconDanger || colors.danger} />
        <Text numberOfLines={1} style={[styles.deliveryExceptionText, { color: colors.iconDanger || colors.danger }]}>
          Delivery Exception · Failed attempt requires Manager recovery
        </Text>
      </View>
    );
  }

  return (
    <View
      accessibilityLabel={`Delivery progress: ${progress.statusLabel}`}
      style={styles.deliveryStageContainer}
    >
      <View style={styles.deliveryStageSegments}>
        {progress.steps.map((step) => {
          const segmentColor = step.completed
            ? colors.success
            : step.current
              ? colors.primary
              : colors.border;
          return (
            <View
              key={step.key}
              style={[
                styles.deliveryStageSegment,
                { backgroundColor: segmentColor, opacity: step.upcoming ? 0.55 : 1 },
              ]}
            />
          );
        })}
      </View>
      <View style={styles.deliveryStageLabels}>
        {progress.steps.map((step) => {
          const dotColor = step.completed
            ? colors.success
            : step.current
              ? colors.primary
              : colors.border;
          const labelColor = step.completed
            ? colors.iconSuccess || colors.success
            : step.current
              ? colors.iconPrimary || colors.primary
              : colors.textSecondary;
          return (
            <View key={step.key} style={styles.deliveryStageLabelItem}>
              <View style={[styles.deliveryStageDot, { backgroundColor: dotColor }]} />
              <Text
                numberOfLines={1}
                style={[
                  styles.deliveryStageLabelText,
                  { color: labelColor, fontWeight: step.current ? '900' : '700' },
                ]}
              >
                {step.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function DeliveryRow({ order, colors, onView, isLast = false }) {
  const reference = String(order.requestId || order.id || 'Order');
  const requesterLabel = order.requesterName || order.requesterNameSnapshot || 'Requester';
  const detailLabel = `${order.assignedDistributorName || 'Assigned distributor'} · ${scheduleLabel(order)}`;
  return (
    <View style={[styles.deliveryRow, !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
      <View style={styles.deliveryIdentity}>
        <Text numberOfLines={1} ellipsizeMode="tail" title={requesterLabel} style={[styles.rowTitle, { color: colors.textPrimary }]}>{requesterLabel}</Text>
        <Text numberOfLines={1} ellipsizeMode="tail" title={`#${reference}`} style={[styles.rowMeta, { color: colors.textSecondary }]}>#{reference}</Text>
      </View>
      <View style={styles.deliveryDetail}>
        <SoftStatusBadge status={order.status} compact />
        <Text numberOfLines={1} ellipsizeMode="tail" title={detailLabel} style={[styles.rowMeta, { color: colors.textSecondary }]}>
          {detailLabel}
        </Text>
      </View>
      <View style={styles.deliveryAction}>
        <ActionLink label="View Details" accessibilityLabel={`View details for order ${reference}`} onPress={() => onView(order)} colors={colors} compact chevron />
      </View>
      <DeliveryStageTrack order={order} colors={colors} />
    </View>
  );
}

function ScheduleTimelineRow({ entry, showDateDivider, colors, tones, onView, isLast = false }) {
  const nodeTone = entry.isOverdue
    ? tones.warning
    : entry.status === 'out_for_delivery'
      ? tones.primary
      : tones.scheduled;
  const subLabel = `#${entry.requestId} · ${entry.assignedDistributorName}`;

  return (
    <View style={styles.scheduleGroupItem}>
      <View style={styles.scheduleTimelineItem}>
        <View style={styles.scheduleTimeColumn}>
          <Text numberOfLines={1} style={[styles.scheduleTimeText, { color: entry.isOverdue ? tones.warning.icon : colors.textPrimary }]}>
            {entry.timeLabel}
          </Text>
          {showDateDivider ? (
            <View style={[styles.scheduleDateHeader, { backgroundColor: nodeTone.soft, borderColor: nodeTone.icon }]}>
              <Text numberOfLines={1} style={[styles.scheduleDateText, { color: nodeTone.icon }]}>
                {entry.dayHeader}
              </Text>
            </View>
          ) : (
            <Text numberOfLines={1} style={[styles.scheduleDateMuted, { color: colors.textSecondary }]}>
              {entry.dayHeader}
            </Text>
          )}
        </View>

        <View style={styles.scheduleAxisColumn}>
          <View style={[styles.scheduleTimelineNodeOuter, { backgroundColor: nodeTone.soft, borderColor: nodeTone.icon }]}>
            <View style={[styles.scheduleTimelineNodeInner, { backgroundColor: nodeTone.icon }]} />
          </View>
          {!isLast ? (
            <View style={[styles.scheduleTimelineConnector, { backgroundColor: colors.border }]} />
          ) : null}
        </View>

        <View style={[styles.scheduleRow, !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
          <View style={styles.scheduleCopy}>
            <Text numberOfLines={1} ellipsizeMode="tail" title={entry.requesterName} style={[styles.rowTitle, { color: colors.textPrimary }]}>
              {entry.requesterName}
            </Text>
            <Text numberOfLines={1} ellipsizeMode="tail" title={subLabel} style={[styles.rowMeta, { color: colors.textSecondary }]}>
              {subLabel}
            </Text>
          </View>
          <View style={styles.scheduleRight}>
            {entry.isOverdue ? <SoftStatusBadge status="warning" label="Overdue" compact /> : null}
            <SoftStatusBadge status={entry.status} compact />
            <ActionLink
              label="View"
              accessibilityLabel={`View scheduled order ${entry.requestId}`}
              onPress={() => onView(entry.order)}
              colors={colors}
              compact
              chevron
            />
          </View>
        </View>
      </View>
    </View>
  );
}

function DistributorWorkloadRow({ distributor, colors, tones, onManage, isLast = false }) {
  const summaryParts = [
    `${count(distributor.scheduledCount)} Scheduled`,
    `${count(distributor.deliveringCount)} Delivering`,
  ];
  if (distributor.exceptionCount > 0) {
    summaryParts.push(`${count(distributor.exceptionCount)} Issue${distributor.exceptionCount === 1 ? '' : 's'}`);
  }
  const hasActiveWorkload = distributor.totalWorkload > 0;
  const distributorTitle = `${distributor.name}${distributor.publicUid ? ` · ${distributor.publicUid}` : ''}`;
  const summaryText = summaryParts.join(' · ');
  const badgeTone = distributor.exceptionCount > 0
    ? tones.danger
    : distributor.deliveringCount > 0
      ? tones.primary
      : hasActiveWorkload
        ? tones.scheduled
        : { icon: colors.textSecondary, soft: colors.surfaceAlt };

  const segmentColorFor = (toneKey) => {
    if (toneKey === 'danger') return colors.danger;
    if (toneKey === 'primary') return colors.primary;
    return colors.statusScheduledText || colors.warning;
  };

  return (
    <View style={[styles.workloadRow, !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
      <View style={[styles.avatarBadge, { backgroundColor: tones.primary.soft }]}>
        <Text style={[styles.avatarInitials, { color: tones.primary.icon }]}>{distributor.initials}</Text>
      </View>
      <View style={styles.workloadCopy}>
        <Text numberOfLines={1} ellipsizeMode="tail" title={distributorTitle} style={[styles.rowTitle, { color: colors.textPrimary }]}>
          {distributorTitle}
        </Text>
        <Text numberOfLines={1} ellipsizeMode="tail" title={summaryText} style={[styles.rowMeta, { color: colors.textSecondary }]}>
          {summaryText}
        </Text>
      </View>
      <View style={styles.workloadRight}>
        <View style={[styles.workloadCountPill, { backgroundColor: badgeTone.soft }]}>
          <Text style={[styles.workloadCountText, { color: badgeTone.icon }]}>
            {count(distributor.totalWorkload)} assigned
          </Text>
        </View>
        <ActionLink
          label="Dispatch"
          accessibilityLabel={`Open dispatch for ${distributor.name}`}
          onPress={onManage}
          colors={colors}
          compact
          chevron
        />
      </View>
      <View style={styles.workloadBarContainer}>
        <View
          accessibilityLabel={
            hasActiveWorkload
              ? `${distributor.name} workload distribution: ${summaryParts.join(', ')}`
              : `${distributor.name}: No active assignments`
          }
          style={[styles.workloadBarTrack, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
        >
          {hasActiveWorkload ? (
            (distributor.barSegments || []).map((segment) => (
              <View
                key={segment.key}
                style={[
                  styles.workloadBarSegment,
                  {
                    flex: segment.flex,
                    backgroundColor: segmentColorFor(segment.toneKey),
                  },
                ]}
              />
            ))
          ) : (
            <View style={[styles.workloadBarEmptyFill, { backgroundColor: colors.border }]} />
          )}
        </View>
        {hasActiveWorkload ? (
          <View style={styles.workloadLegendRow}>
            {(distributor.barSegments || []).map((segment) => {
              const segColor = segmentColorFor(segment.toneKey);
              return (
                <View key={segment.key} style={styles.workloadLegendItem}>
                  <View style={[styles.workloadLegendDot, { backgroundColor: segColor }]} />
                  <Text style={[styles.workloadLegendText, { color: colors.textSecondary }]}>
                    {count(segment.count)} {segment.label}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={[styles.workloadIdleCaption, { color: colors.textSecondary }]}>
            No active assignments
          </Text>
        )}
      </View>
    </View>
  );
}

function BranchReviewRow({ item, tones, colors, onAction, isLast = false }) {
  const tone = tones[item.toneKey] || tones.primary;
  const countText = item.ready ? count(item.count) : '—';
  return (
    <View style={[styles.reviewRow, !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
      <View style={[styles.attentionAccentBar, { backgroundColor: tone.icon }]} />
      <View style={[styles.rowIcon, { backgroundColor: tone.soft }]}>
        <SidebarIcon name={item.icon} size={17} tintColor={tone.icon} />
      </View>
      <View style={styles.reviewCopy}>
        <View style={styles.reviewTitleRow}>
          <Text numberOfLines={1} ellipsizeMode="tail" title={item.title} style={[styles.rowTitle, { color: colors.textPrimary }]}>
            {item.title}
          </Text>
          <View style={[styles.reviewCountPill, { backgroundColor: tone.soft, borderColor: tone.icon }]}>
            <Text numberOfLines={1} style={[styles.reviewCountText, { color: tone.icon }]}>
              {countText}
            </Text>
          </View>
        </View>
        <Text numberOfLines={2} ellipsizeMode="tail" title={item.description} style={[styles.rowMeta, { color: colors.textSecondary }]}>
          {item.description}
        </Text>
      </View>
      <View style={styles.reviewRight}>
        <SoftStatusBadge status={item.badgeStatus} label={item.badgeLabel} compact />
        <ActionLink
          label={item.actionLabel}
          accessibilityLabel={`${item.actionLabel} ${item.title}`}
          onPress={() => onAction(item.targetPath)}
          colors={colors}
          compact
          chevron
        />
      </View>
    </View>
  );
}

function ProductDeliveryRuleRow({ item, colors, tones, onManage, isLast = false }) {
  const [imageError, setImageError] = React.useState(false);
  React.useEffect(() => {
    setImageError(false);
  }, [item.imageUrl]);

  const showImage = Boolean(item.imageUrl) && !imageError;
  const daysColor = item.hasDeliveryDaysConfigured
    ? colors.textSecondary
    : colors.iconWarning || colors.warning;
  const daysIconColor = item.hasDeliveryDaysConfigured
    ? colors.iconPrimary || colors.primary
    : colors.iconWarning || colors.warning;

  return (
    <View style={[styles.productRuleRow, !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border }]}>
      <View style={[styles.productThumbFrame, { backgroundColor: showImage ? colors.surfaceAlt : tones.primary.soft, borderColor: colors.border }]}>
        {showImage ? (
          <Image
            source={{ uri: item.imageUrl }}
            resizeMode="contain"
            onError={() => setImageError(true)}
            accessibilityLabel={item.name}
            style={styles.productThumbImage}
          />
        ) : (
          <SidebarIcon name="Package" size={19} tintColor={tones.primary.icon} />
        )}
      </View>

      <View style={styles.productRuleCopy}>
        <View style={styles.productRuleTitleRow}>
          <Text numberOfLines={1} ellipsizeMode="tail" title={item.name} style={[styles.rowTitle, { color: colors.textPrimary }]}>
            {item.name}
          </Text>
          {item.priceLabel ? (
            <View style={[styles.referencePill, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
              <Text numberOfLines={1} ellipsizeMode="tail" title={item.priceLabel} style={[styles.referencePillText, { color: colors.textPrimary }]}>
                {item.priceLabel}
              </Text>
            </View>
          ) : null}
        </View>

        <View style={styles.productRuleMetaStack}>
          <View style={styles.productRuleMetaItem}>
            <OngoingRequestFieldIcon name="CalendarClock" size={13} color={daysIconColor} />
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              title={item.deliveryDaysLabel}
              style={[
                styles.productRuleMetaText,
                { color: daysColor, fontWeight: item.hasDeliveryDaysConfigured ? '600' : '800' },
              ]}
            >
              {item.deliveryDaysLabel}
            </Text>
          </View>
          <View style={styles.productRuleMetaItem}>
            <OngoingRequestFieldIcon name="Layers" size={13} color={colors.textSecondary} />
            <Text
              numberOfLines={1}
              ellipsizeMode="tail"
              title={item.limitLabel}
              style={[styles.productRuleMetaText, { color: colors.textSecondary }]}
            >
              {item.limitLabel}
            </Text>
          </View>
        </View>
      </View>

      <View style={styles.productRuleRight}>
        <SoftStatusBadge status={item.statusBadge} label={item.statusLabel} compact />
        <ActionLink
          label="Rules"
          accessibilityLabel={`Configure delivery rules for ${item.name}`}
          onPress={() => onManage(item.targetPath)}
          colors={colors}
          compact
          chevron
        />
      </View>
    </View>
  );
}

export default function ManagerOperationsDashboard() {
  const { width } = useWindowDimensions();
  const { colors } = useAdminTheme();
  const { navigateOnce } = useSingleFlightNavigation();
  const { openPanel } = useManagerOngoingRequests();
  const realtime = useManagerRealtimeData();
  const {
    branchId,
    branch,
    users = [],
    requests = [],
    incomingTransfers = [],
    pendingApplications = [],
    loading,
    errors = {},
    retry,
  } = realtime;
  const reduceMotion = useReducedMotionPreference();
  const shouldAnimateEntrance = React.useRef(!hasCompletedDashboardEntrance('manager_dashboard')).current;
  React.useEffect(() => {
    markDashboardEntranceCompleted('manager_dashboard');
  }, []);
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const operations = React.useMemo(() => getManagerDashboardOperations(requests, branchId, now), [requests, branchId, now]);
  const analytics = React.useMemo(() => getManagerOrderAnalytics(operations.branchOrders), [operations.branchOrders]);
  const [deliveryFilter, setDeliveryFilter] = React.useState('all');
  const requestsUnavailable = !branchId || Boolean(errors.requests);
  const usersUnavailable = !branchId || Boolean(errors.users);
  const firstLoad = loading && requests.length === 0;
  const ready = !firstLoad && !requestsUnavailable;
  const distributorReady = !firstLoad && !requestsUnavailable && !usersUnavailable;
  const applicationReady = !realtime.applicationsLoading && !errors.applicants;

  const priorityActions = React.useMemo(
    () => (ready
      ? buildPriorityActions({
          operations,
          incomingTransfers,
          pendingApplications,
          applicationReady,
          branchId,
        })
      : []),
    [ready, operations, incomingTransfers, pendingApplications, applicationReady, branchId]
  );

  const scheduleData = React.useMemo(
    () => (ready ? buildDeliverySchedule(requests, branchId, now) : { entries: [], overdueCount: 0, upcomingCount: 0 }),
    [ready, requests, branchId, now]
  );

  const distributorWorkload = React.useMemo(
    () => (distributorReady ? buildDistributorWorkload(requests, users, branchId) : []),
    [distributorReady, requests, users, branchId]
  );

  const moderationSignal = useModerationActivitySignal('manager');
  const [moderationRefreshTick, setModerationRefreshTick] = React.useState(0);
  const [moderationState, setModerationState] = React.useState({
    cases: null,
    loading: true,
    error: null,
  });
  const retryModeration = React.useCallback(() => {
    setModerationRefreshTick((tick) => tick + 1);
  }, []);

  React.useEffect(() => {
    let active = true;
    if (!branchId) {
      setModerationState({ cases: null, loading: false, error: null });
      return undefined;
    }
    setModerationState((prev) => ({ ...prev, loading: prev.cases === null, error: null }));
    loadModerationCases('manager', { status: 'active', limit: 50 })
      .then((result) => {
        if (!active) return;
        setModerationState({
          cases: Array.isArray(result?.reports) ? result.reports : [],
          loading: false,
          error: null,
        });
      })
      .catch((error) => {
        if (!active) return;
        setModerationState({
          cases: null,
          loading: false,
          error: error || new Error('Reports & Safety unavailable'),
        });
      });
    return () => {
      active = false;
    };
  }, [branchId, moderationSignal, moderationRefreshTick]);

  const [productRefreshTick, setProductRefreshTick] = React.useState(0);
  const [workspaceProductsState, setWorkspaceProductsState] = React.useState({
    products: [],
    branchSnapshot: null,
    loading: true,
    error: null,
  });
  const retryProducts = React.useCallback(() => {
    setProductRefreshTick((tick) => tick + 1);
  }, []);

  React.useEffect(() => {
    let active = true;
    if (!branchId) {
      setWorkspaceProductsState({ products: [], branchSnapshot: null, loading: false, error: null });
      return undefined;
    }
    setWorkspaceProductsState((prev) => ({
      ...prev,
      loading: prev.products.length === 0,
      error: null,
    }));
    getManagerWorkspace()
      .then((data) => {
        if (!active) return;
        setWorkspaceProductsState({
          products: Array.isArray(data?.products) ? data.products : [],
          branchSnapshot: data?.branch || null,
          loading: false,
          error: null,
        });
      })
      .catch((error) => {
        if (!active) return;
        setWorkspaceProductsState({
          products: [],
          branchSnapshot: null,
          loading: false,
          error: error || new Error('Branch product catalog unavailable'),
        });
      });
    return () => {
      active = false;
    };
  }, [branchId, productRefreshTick]);

  const branchReviews = React.useMemo(
    () =>
      buildBranchReviewsSummary({
        branchId,
        pendingApplications,
        applicationsLoading: Boolean(realtime.applicationsLoading),
        applicationsError: errors.applicants || null,
        moderationCases: moderationState.cases,
        moderationLoading: moderationState.loading,
        moderationError: moderationState.error,
      }),
    [
      branchId,
      pendingApplications,
      realtime.applicationsLoading,
      errors.applicants,
      moderationState.cases,
      moderationState.loading,
      moderationState.error,
    ]
  );

  const productRulesPreview = React.useMemo(
    () =>
      buildProductDeliveryRulesPreview(
        workspaceProductsState.products,
        branchId,
        3,
        workspaceProductsState.branchSnapshot || branch
      ),
    [workspaceProductsState.products, workspaceProductsState.branchSnapshot, branchId, branch]
  );

  const cardsPerRow = width >= 1120 ? 4 : width >= 620 ? 2 : 1;
  const cardWidth = cardsPerRow === 4 ? '23.5%' : cardsPerRow === 2 ? '48.5%' : '100%';
  const compact = width < 1100;
  const branchName = branch?.name || branch?.branchName || 'Assigned branch';
  const branchContext = [branch?.code, branch?.city || branch?.municipality].filter(Boolean).join(' · ') || 'Branch-scoped dispatch and fulfillment queue';
  const go = (path) => navigateOnce(path);
  const viewOrder = (order) => {
    const target = buildManagerOrderTargetRoute(order);
    navigateOnce(typeof target === 'object' ? target : { pathname: '/manager/request', params: { orderId: order?.id } });
  };
  const handlePriorityAction = (item) => {
    if (item.targetType === 'monitor') {
      openPanel(item.targetSegment || 'exceptions');
      return;
    }
    if ((item.targetType === 'order' || item.type === 'review_request') && (item.order || item.orderId)) {
      viewOrder(item.order || item.orderId);
      return;
    }
    go(item.targetPath || '/manager/request?filter=pending');
  };

  const tones = {
    primary: { icon: colors.iconPrimary || colors.primary, soft: colors.primarySoft },
    warning: { icon: colors.iconWarning || colors.warning, soft: colors.warningSoft },
    scheduled: {
      icon: colors.statusScheduledText || colors.iconWarning || colors.warning,
      soft: colors.statusScheduledBg || colors.warningSoft,
    },
    danger: { icon: colors.iconDanger || colors.danger, soft: colors.dangerSoft },
  };

  const deliveryGroups = {
    all: operations.deliveryOverview,
    active: operations.activeDeliveries,
    scheduled: operations.scheduledOrders,
    exceptions: operations.failedDeliveries,
  };
  const visiblePriorityActions = priorityActions.slice(0, 4);
  const visibleDeliveries = (deliveryGroups[deliveryFilter] || []).slice(0, 3);
  const visibleScheduleEntries = scheduleData.entries.slice(0, 4);
  const visibleDistributors = distributorWorkload.slice(0, 4);

  const kpiWidthStyle = cardsPerRow === 4
    ? styles.kpiDesktopCol
    : cardsPerRow === 2
      ? styles.kpiTabletCol
      : styles.fullWidth;
  const kpis = [
    { title: 'Needs Assignment', value: operations.needsAssignment.length, hint: 'Ready for dispatch', icon: 'UsersRound', tone: tones.primary, onPress: () => go('/manager/distributors') },
    { title: 'Scheduled Deliveries', value: operations.scheduledOrders.length, hint: 'Assigned or scheduled', icon: 'ClipboardList', tone: tones.warning, onPress: () => openPanel('scheduled') },
    { title: 'Out for Delivery', value: operations.activeDeliveries.length, hint: 'Currently in progress', icon: 'Truck', tone: tones.primary, onPress: () => openPanel('active') },
    { title: 'Delivery Issues', value: operations.failedDeliveries.length, hint: 'Require follow-up', icon: 'ShieldAlert', tone: tones.danger, onPress: () => openPanel('exceptions') },
  ];

  return (
    <ManagerShell active="dashboard" title="Branch Operations" subtitle="Delivery, dispatch, and request overview">
      <View style={styles.dashboardContainer}>
        <DashboardSectionEntrance sectionIndex={0} shouldAnimateEntrance={shouldAnimateEntrance} reduceMotion={reduceMotion}>
          <View style={[styles.scope, { backgroundColor: colors.primaryAction, borderColor: colors.primaryAction }]}>
            <View style={styles.scopeIdentity}>
              <View style={[styles.scopeIcon, styles.scopeIconOnPrimary]}>
                <SidebarIcon name="Building2" size={18} tintColor={colors.onPrimary} />
              </View>
              <View style={styles.scopeCopy}>
                <Text style={[styles.eyebrow, { color: colors.onPrimary }]}>ASSIGNED BRANCH</Text>
                <View style={styles.scopeTitleRow}>
                  <Text numberOfLines={1} ellipsizeMode="tail" title={branchName} style={[styles.scopeName, { color: colors.onPrimary }]}>{branchName}</Text>
                  <Text numberOfLines={1} ellipsizeMode="tail" title={branchContext} style={[styles.scopeSubtitle, { color: colors.onPrimary }]}>{branchContext}</Text>
                </View>
              </View>
            </View>
            <ActionLink label="View all requests" onPress={() => go('/manager/request')} colors={colors} compact chevron onBanner />
          </View>
        </DashboardSectionEntrance>

        {firstLoad ? <View style={styles.state}><ActivityIndicator color={colors.primary} /><Text style={{ color: colors.textSecondary }}>Loading branch operations…</Text></View> : null}
        {loading && requests.length > 0 && !errors.requests ? (
          <Text style={[styles.refreshing, { color: colors.textSecondary }]}>Refreshing branch operations · Showing the last branch snapshot</Text>
        ) : null}
        {requestsUnavailable && !firstLoad ? (
          <View style={[styles.notice, { backgroundColor: colors.warningSoft, borderColor: colors.warning }]}>
            <Text style={[styles.rowTitle, { color: colors.textPrimary }]}>Branch requests are unavailable. Operational counts cannot be confirmed.</Text>
            <ActionLink label="Retry branch data" onPress={retry} colors={colors} />
          </View>
        ) : null}

        {/* Row 1 — Operational KPIs */}
        <DashboardSectionEntrance sectionIndex={1} shouldAnimateEntrance={shouldAnimateEntrance} reduceMotion={reduceMotion}>
          <View style={styles.kpiGrid}>
            {kpis.map((item) => <KpiCard key={item.title} {...item} colors={colors} widthStyle={kpiWidthStyle} unavailable={!ready} />)}
          </View>
        </DashboardSectionEntrance>

        {/* Row 2 — Daily Operations: Priority Actions & Live Deliveries */}
        <DashboardSectionEntrance sectionIndex={2} shouldAnimateEntrance={shouldAnimateEntrance} reduceMotion={reduceMotion}>
          <View style={[styles.operationsGrid, compact && styles.stacked]}>
            <View style={[styles.panel, !compact && styles.attentionPanel, compact && styles.fullWidth, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.panelHeading}>
                <View style={styles.headingCopy}>
                  <Text style={[styles.panelTitle, { color: colors.textPrimary }]}>Priority Actions</Text>
                  <Text style={[styles.panelSubtitle, { color: colors.textSecondary }]}>Requests and exceptions needing Manager action</Text>
                </View>
                <ActionLink label="View requests" onPress={() => go('/manager/request?filter=pending')} colors={colors} compact chevron />
              </View>
              <View style={styles.panelBody}>
                {!ready ? (
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Waiting for branch requests.</Text>
                ) : visiblePriorityActions.length ? (
                  visiblePriorityActions.map((item, idx) => (
                    <PriorityActionRow
                      key={item.key}
                      item={item}
                      tones={tones}
                      colors={colors}
                      onAction={handlePriorityAction}
                      isLast={idx === visiblePriorityActions.length - 1}
                    />
                  ))
                ) : (
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    {applicationReady ? 'No items requiring attention.' : 'No items requiring attention. Application status unavailable.'}
                  </Text>
                )}
                {errors.applicants ? <Text style={[styles.helper, { color: colors.warning }]}>Distributor applications could not be checked.</Text> : null}
              </View>
              <View style={[styles.panelFooter, { borderTopColor: colors.border }]}>
                <ActionLink label="Open dispatch" onPress={() => go('/manager/distributors')} colors={colors} compact chevron />
              </View>
            </View>

            <View style={[styles.panel, !compact && styles.deliveryPanel, compact && styles.fullWidth, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.panelHeading}>
                <View style={styles.headingCopy}>
                  <Text style={[styles.panelTitle, { color: colors.textPrimary }]}>Live Deliveries</Text>
                  <Text style={[styles.panelSubtitle, { color: colors.textSecondary }]}>Current delivery activity and upcoming assignments.</Text>
                </View>
                <ActionLink label="Open monitor" onPress={() => openPanel(deliveryFilter === 'all' ? 'active' : deliveryFilter)} colors={colors} compact chevron />
              </View>
              <View style={styles.filterRow} accessibilityRole="tablist">
                {[
                  ['all', 'All', operations.deliveryOverview.length],
                  ['active', 'Active', operations.activeDeliveries.length],
                  ['scheduled', 'Scheduled', operations.scheduledOrders.length],
                  ['exceptions', 'Exceptions', operations.failedDeliveries.length],
                ].map(([key, label, value]) => (
                  <Pressable key={key} accessibilityRole="tab" accessibilityLabel={`${label} deliveries, ${value}`}
                    accessibilityState={{ selected: deliveryFilter === key }} onPress={() => setDeliveryFilter(key)}
                    style={[styles.filterTab, { borderColor: deliveryFilter === key ? colors.primary : colors.border,
                      backgroundColor: deliveryFilter === key ? colors.primarySoft : colors.surfaceAlt }]}
                  >
                    <Text style={[styles.filterText, { color: deliveryFilter === key ? colors.iconPrimary || colors.primary : colors.textSecondary }]}>{label} {ready ? count(value) : '—'}</Text>
                  </Pressable>
                ))}
              </View>
              <View style={styles.panelBody}>
                {!ready ? <Text style={[styles.emptyText, { color: colors.textSecondary }]}>Waiting for delivery records.</Text>
                  : visibleDeliveries.length ? visibleDeliveries.map((order, idx) => <DeliveryRow key={order.id} order={order} colors={colors} onView={viewOrder} isLast={idx === visibleDeliveries.length - 1} />)
                    : <Text style={[styles.emptyText, { color: colors.textSecondary }]}>{deliveryFilter === 'all' ? 'No active branch deliveries.' : `No ${deliveryFilter} deliveries.`}</Text>}
              </View>
              <View style={[styles.panelFooter, { borderTopColor: colors.border }]}>
                <ActionLink label="View all requests" onPress={() => go('/manager/request?filter=ongoing')} colors={colors} compact chevron />
              </View>
            </View>
          </View>
        </DashboardSectionEntrance>

        {/* Row 3 — Operational Planning: Delivery Schedule & Distributor Workload */}
        <DashboardSectionEntrance sectionIndex={3} shouldAnimateEntrance={shouldAnimateEntrance} reduceMotion={reduceMotion}>
          <View style={[styles.operationsGrid, compact && styles.stacked]}>
            <View style={[styles.panel, !compact && styles.schedulePanel, compact && styles.fullWidth, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.panelHeading}>
                <View style={styles.headingCopy}>
                  <Text style={[styles.panelTitle, { color: colors.textPrimary }]}>Delivery Schedule</Text>
                  <Text style={[styles.panelSubtitle, { color: colors.textSecondary }]}>Upcoming scheduled deliveries and overdue checks (Asia/Manila)</Text>
                </View>
                <ActionLink label="View schedule" onPress={() => go('/manager/request?filter=ongoing')} colors={colors} compact chevron />
              </View>
              <View style={styles.panelBody}>
                {!ready ? (
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    {firstLoad ? 'Loading delivery schedule…' : 'Schedule unavailable until branch requests load.'}
                  </Text>
                ) : visibleScheduleEntries.length ? (
                  visibleScheduleEntries.map((entry, idx) => (
                    <ScheduleTimelineRow
                      key={entry.id}
                      entry={entry}
                      showDateDivider={Boolean(entry.showDateBadge)}
                      colors={colors}
                      tones={tones}
                      onView={viewOrder}
                      isLast={idx === visibleScheduleEntries.length - 1}
                    />
                  ))
                ) : (
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No upcoming deliveries.</Text>
                )}
              </View>
              <View style={[styles.panelFooter, { borderTopColor: colors.border }]}>
                <ActionLink label="Open scheduled monitor" onPress={() => openPanel('scheduled')} colors={colors} compact chevron />
              </View>
            </View>

            <View style={[styles.panel, !compact && styles.workloadPanel, compact && styles.fullWidth, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.panelHeading}>
                <View style={styles.headingCopy}>
                  <Text style={[styles.panelTitle, { color: colors.textPrimary }]}>Distributor Workload</Text>
                  <Text style={[styles.panelSubtitle, { color: colors.textSecondary }]}>Assigned branch distributor order distribution</Text>
                </View>
                <ActionLink label="Manage distributors" onPress={() => go('/manager/distributors')} colors={colors} compact chevron />
              </View>
              <View style={styles.panelBody}>
                {!distributorReady ? (
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    {firstLoad ? 'Loading distributor workload…' : 'Distributor workload unavailable.'}
                  </Text>
                ) : visibleDistributors.length ? (
                  visibleDistributors.map((distributor, idx) => (
                    <DistributorWorkloadRow
                      key={distributor.uid}
                      distributor={distributor}
                      colors={colors}
                      tones={tones}
                      onManage={() => go('/manager/distributors')}
                      isLast={idx === visibleDistributors.length - 1}
                    />
                  ))
                ) : (
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>No approved distributors assigned to this branch.</Text>
                )}
              </View>
              <View style={[styles.panelFooter, { borderTopColor: colors.border }]}>
                <ActionLink label="Open dispatch" onPress={() => go('/manager/distributors')} colors={colors} compact chevron />
              </View>
            </View>
          </View>
        </DashboardSectionEntrance>

        {/* Row 4 — Sales Overview */}
        <DashboardSectionEntrance sectionIndex={4} shouldAnimateEntrance={shouldAnimateEntrance} reduceMotion={reduceMotion}>
          <View style={[styles.panel, styles.performance, { backgroundColor: colors.surface, borderColor: colors.border }]}>
            <View style={styles.panelHeading}>
              <View style={styles.headingCopy}>
                <Text style={[styles.panelTitle, { color: colors.textPrimary }]}>Sales Overview</Text>
                <Text style={[styles.panelSubtitle, { color: colors.textSecondary }]}>All available branch orders · Delivered transactions only</Text>
              </View>
              <ActionLink label="View Analytics" onPress={() => go('/manager/analytics')} colors={colors} compact chevron />
            </View>
            {ready ? (
              <SalesOverviewContent
                sales={{ totalOrders: analytics.total, deliveredOrders: analytics.delivered, revenue: analytics.revenue, units: analytics.units }}
                compact={width < 760}
                stacked={width < 520}
                horizontalMetrics={width >= 760}
              />
            ) : (
              <View style={styles.salesUnavailable}>
                {firstLoad ? <ActivityIndicator color={colors.primary} /> : null}
                <Text style={[styles.rowMeta, { color: colors.textSecondary }]}>{firstLoad ? 'Loading branch sales…' : 'Sales overview unavailable until branch requests are confirmed.'}</Text>
              </View>
            )}
          </View>
        </DashboardSectionEntrance>

        {/* Row 5 — Branch Reviews & Product Delivery Rules */}
        <DashboardSectionEntrance sectionIndex={5} shouldAnimateEntrance={shouldAnimateEntrance} reduceMotion={reduceMotion}>
          <View style={[styles.operationsGrid, styles.lowerManagementRow, compact && styles.stacked]}>
            <View style={[styles.panel, !compact && styles.reviewsPanel, compact && styles.fullWidth, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.panelHeading}>
                <View style={styles.headingCopy}>
                  <Text style={[styles.panelTitle, { color: colors.textPrimary }]}>Branch Reviews</Text>
                  <Text style={[styles.panelSubtitle, { color: colors.textSecondary }]}>Applications and safety matters</Text>
                </View>
                <ActionLink label="View Applications" onPress={() => go('/manager/distributors')} colors={colors} compact chevron />
              </View>
              <View style={styles.panelBody}>
                {branchReviews.items.map((item, idx) => (
                  <BranchReviewRow
                    key={item.key}
                    item={item}
                    tones={tones}
                    colors={colors}
                    onAction={go}
                    isLast={idx === branchReviews.items.length - 1}
                  />
                ))}
                {branchReviews.allClear ? (
                  <View style={[styles.reviewClearBanner, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}>
                    <SidebarIcon name="ShieldCheck" size={14} tintColor={colors.iconPrimary || colors.primary} />
                    <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.reviewClearText, { color: colors.textSecondary }]}>
                      All clear · No pending branch applications or active safety reports.
                    </Text>
                  </View>
                ) : null}
                {moderationState.error ? (
                  <View style={styles.inlineRetryRow}>
                    <Text style={[styles.helper, { color: colors.warning, marginTop: 0 }]}>Safety report count could not be verified.</Text>
                    <ActionLink label="Retry" onPress={retryModeration} colors={colors} compact />
                  </View>
                ) : null}
              </View>
              <View style={[styles.panelFooter, { borderTopColor: colors.border }]}>
                <ActionLink label="Review Reports" onPress={() => go('/manager/reports-safety')} colors={colors} compact chevron />
              </View>
            </View>

            <View style={[styles.panel, !compact && styles.productRulesPanel, compact && styles.fullWidth, { backgroundColor: colors.surface, borderColor: colors.border }]}>
              <View style={styles.panelHeading}>
                <View style={styles.headingCopy}>
                  <Text style={[styles.panelTitle, { color: colors.textPrimary }]}>Product Delivery Rules</Text>
                  <Text style={[styles.panelSubtitle, { color: colors.textSecondary }]}>Branch catalog and delivery availability</Text>
                </View>
                <ActionLink label="Manage Products" onPress={() => go('/manager/products')} colors={colors} compact chevron />
              </View>
              <View style={styles.panelBody}>
                {!branchId || workspaceProductsState.loading ? (
                  <View style={styles.inlineLoadingState}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={[styles.emptyText, { color: colors.textSecondary, paddingVertical: 8 }]}>
                      Loading branch product delivery rules…
                    </Text>
                  </View>
                ) : workspaceProductsState.error ? (
                  <View style={styles.inlineErrorState}>
                    <Text style={[styles.emptyText, { color: colors.textSecondary, paddingVertical: 8 }]}>
                      Branch product delivery rules are temporarily unavailable.
                    </Text>
                    <ActionLink label="Retry products" onPress={retryProducts} colors={colors} compact />
                  </View>
                ) : productRulesPreview.length ? (
                  productRulesPreview.map((item, idx) => (
                    <ProductDeliveryRuleRow
                      key={item.id}
                      item={item}
                      colors={colors}
                      tones={tones}
                      onManage={go}
                      isLast={idx === productRulesPreview.length - 1}
                    />
                  ))
                ) : (
                  <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
                    No branch products configured yet.
                  </Text>
                )}
              </View>
              <View style={[styles.panelFooter, { borderTopColor: colors.border }]}>
                <ActionLink label="View Products" onPress={() => go('/manager/products')} colors={colors} compact chevron />
              </View>
            </View>
          </View>
        </DashboardSectionEntrance>
      </View>
    </ManagerShell>
  );
}

const styles = StyleSheet.create({
  dashboardContainer: { width: '100%', paddingBottom: 24 },
  scope: { borderWidth: 1, borderRadius: SPACING.cardRadius, paddingVertical: 12, paddingHorizontal: SPACING.cardPadding, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: SPACING.sectionGap },
  scopeIdentity: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1, minWidth: 220 },
  scopeIcon: { width: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  scopeIconOnPrimary: { backgroundColor: 'rgba(255,255,255,0.16)' },
  scopeCopy: { flex: 1, minWidth: 160 },
  eyebrow: { fontSize: 10, fontWeight: '900', letterSpacing: 0.8 },
  scopeTitleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: 8, marginTop: 2, minWidth: 0 },
  scopeName: { fontSize: 15, fontWeight: '900', flexShrink: 1, minWidth: 0 },
  scopeSubtitle: { fontSize: 12, flexShrink: 1, minWidth: 0 },
  state: { alignItems: 'center', justifyContent: 'center', padding: 16, flexDirection: 'row', gap: 10, marginBottom: SPACING.sectionGap },
  refreshing: { fontSize: 11, marginBottom: 10 },
  notice: { borderWidth: 1, borderRadius: 12, padding: 12, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: SPACING.sectionGap },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', justifyContent: 'space-between', gap: 16, marginBottom: SPACING.sectionGap },
  kpiDesktopCol: { flex: 1, minWidth: 0, width: '23.5%' },
  kpiTabletCol: { flexGrow: 1, flexBasis: '48%', width: '48.5%', minWidth: 220 },
  kpi: { borderWidth: 1, borderRadius: SPACING.cardRadius, padding: 18, gap: 12, justifyContent: 'space-between', alignSelf: 'stretch', minWidth: 0 },
  kpiHover: { transform: [{ translateY: -1 }] },
  kpiTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  kpiMetric: { flexDirection: 'row', alignItems: 'center', flexShrink: 1, gap: 12 },
  kpiIcon: { width: 42, height: 42, flexShrink: 0, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  kpiArrowBadge: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  kpiArrow: { fontSize: 14, fontWeight: '800', lineHeight: 16 },
  kpiValue: { fontSize: 28, lineHeight: 32, fontWeight: '900' },
  kpiCopy: { minWidth: 0 },
  kpiTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kpiStatusDot: { width: 6, height: 6, borderRadius: 3, flexShrink: 0 },
  kpiTitle: { fontSize: 13, fontWeight: '800', lineHeight: 17, flexShrink: 1 },
  kpiHint: { fontSize: 11, lineHeight: 15, marginTop: 2 },
  operationsGrid: { flexDirection: 'row', alignItems: 'stretch', gap: SPACING.sectionGap, marginBottom: SPACING.sectionGap },
  stacked: { flexDirection: 'column', alignItems: 'stretch' },
  fullWidth: { width: '100%' },
  panel: { borderWidth: 1, borderRadius: SPACING.cardRadius, padding: SPACING.cardPadding, minWidth: 0, flexDirection: 'column', justifyContent: 'flex-start' },
  attentionPanel: { flexGrow: 41, flexShrink: 1, flexBasis: 0, alignSelf: 'stretch' },
  deliveryPanel: { flexGrow: 59, flexShrink: 1, flexBasis: 0, alignSelf: 'stretch' },
  schedulePanel: { flexGrow: 50, flexShrink: 1, flexBasis: 0, alignSelf: 'stretch' },
  workloadPanel: { flexGrow: 50, flexShrink: 1, flexBasis: 0, alignSelf: 'stretch' },
  panelHeading: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, minHeight: 40, marginBottom: 12 },
  headingCopy: { flex: 1, minWidth: 140 },
  panelTitle: { fontSize: 16, fontWeight: '900', lineHeight: 20 },
  panelSubtitle: { fontSize: 11, lineHeight: 15, marginTop: 3 },
  panelBody: { flexGrow: 1, justifyContent: 'flex-start', minWidth: 0 },
  emptyText: { paddingVertical: 20, fontSize: 13, textAlign: 'center' },
  helper: { fontSize: 11, marginTop: 10 },
  actionLink: { minHeight: 38, paddingHorizontal: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', alignSelf: 'flex-start' },
  compactAction: { minHeight: 36, paddingHorizontal: 6 },
  actionText: { fontSize: 12, fontWeight: '800' },
  actionChevron: { fontSize: 17, fontWeight: '700', marginLeft: 4, lineHeight: 19 },
  attentionRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, paddingVertical: 10, minWidth: 0 },
  attentionAccentBar: { width: 4, height: 34, borderRadius: 999, flexShrink: 0 },
  rowIcon: { width: 32, height: 32, borderRadius: 9, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  attentionCopy: { flex: 1, minWidth: 0 },
  attentionTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap', gap: 6, minWidth: 0 },
  referencePill: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6, borderWidth: 1, flexShrink: 0, maxWidth: 150 },
  referencePillText: { fontSize: 10, fontWeight: '800' },
  attentionRight: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginLeft: 'auto', flexShrink: 0 },
  attentionActionWrap: { minWidth: 74, alignItems: 'flex-end' },
  rowTitle: { fontSize: 12, fontWeight: '800', lineHeight: 16, flexShrink: 1, minWidth: 0 },
  rowMeta: { fontSize: 11, lineHeight: 15, marginTop: 2, flexShrink: 1, minWidth: 0 },
  filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.itemGap, marginBottom: 8 },
  filterTab: { minHeight: 36, paddingHorizontal: 10, borderWidth: 1, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  filterText: { fontSize: 11, fontWeight: '800' },
  deliveryRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 10, minWidth: 0 },
  deliveryIdentity: { flexGrow: 1, flexShrink: 1, flexBasis: 125, maxWidth: 190, minWidth: 100 },
  deliveryDetail: { flexGrow: 1.5, flexShrink: 1, flexBasis: 185, minWidth: 145, alignItems: 'flex-start', gap: 4 },
  deliveryAction: { marginLeft: 'auto', flexShrink: 0, alignItems: 'flex-end', justifyContent: 'center' },
  deliveryStageContainer: { width: '100%', marginTop: 4, gap: 5 },
  deliveryStageSegments: { flexDirection: 'row', alignItems: 'center', gap: 5, width: '100%' },
  deliveryStageSegment: { flex: 1, height: 5, borderRadius: 999 },
  deliveryStageLabels: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap' },
  deliveryStageLabelItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  deliveryStageDot: { width: 6, height: 6, borderRadius: 3 },
  deliveryStageLabelText: { fontSize: 10, lineHeight: 13 },
  deliveryExceptionBar: { width: '100%', marginTop: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  deliveryExceptionText: { fontSize: 10, fontWeight: '800', flexShrink: 1 },
  scheduleGroupItem: { minWidth: 0 },
  scheduleTimelineItem: { flexDirection: 'row', alignItems: 'stretch', gap: 10, minWidth: 0 },
  scheduleTimeColumn: { width: 70, paddingTop: 9, alignItems: 'flex-end', flexShrink: 0, gap: 3 },
  scheduleTimeText: { fontSize: 11, fontWeight: '900', lineHeight: 15 },
  scheduleDateHeader: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1 },
  scheduleDateText: { fontSize: 9, fontWeight: '900', letterSpacing: 0.5 },
  scheduleDateMuted: { fontSize: 9, fontWeight: '700', letterSpacing: 0.4 },
  scheduleAxisColumn: { width: 16, alignItems: 'center', paddingTop: 10, flexShrink: 0 },
  scheduleTimelineNodeOuter: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  scheduleTimelineNodeInner: { width: 6, height: 6, borderRadius: 3 },
  scheduleTimelineConnector: { width: 2, flexGrow: 1, marginTop: 4, borderRadius: 1 },
  scheduleRow: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 9, minWidth: 0 },
  scheduleCopy: { flex: 1, minWidth: 0 },
  scheduleRight: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6, marginLeft: 'auto', flexShrink: 0 },
  workloadRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 10, minWidth: 0 },
  avatarBadge: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  avatarInitials: { fontSize: 12, fontWeight: '900', letterSpacing: 0.4 },
  workloadCopy: { flex: 1, minWidth: 0 },
  workloadRight: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginLeft: 'auto', flexShrink: 0 },
  workloadCountPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  workloadCountText: { fontSize: 11, fontWeight: '800' },
  workloadBarContainer: { width: '100%', paddingLeft: 42, marginTop: 2, gap: 4 },
  workloadBarTrack: { width: '100%', height: 7, borderRadius: 999, borderWidth: 1, overflow: 'hidden', flexDirection: 'row', gap: 2 },
  workloadBarSegment: { height: '100%', borderRadius: 999 },
  workloadBarEmptyFill: { width: '100%', height: '100%', opacity: 0.25 },
  workloadLegendRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 10 },
  workloadLegendItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  workloadLegendDot: { width: 6, height: 6, borderRadius: 3 },
  workloadLegendText: { fontSize: 10, fontWeight: '700' },
  workloadIdleCaption: { fontSize: 10, fontWeight: '700' },
  panelFooter: { marginTop: 'auto', paddingTop: 10, borderTopWidth: 1, alignItems: 'flex-end' },
  performance: { marginBottom: SPACING.sectionGap },
  salesUnavailable: { minHeight: 110, alignItems: 'center', justifyContent: 'center', gap: 8 },
  lowerManagementRow: { marginBottom: 0 },
  reviewsPanel: { flexGrow: 41, flexShrink: 1, flexBasis: 0, alignSelf: 'stretch' },
  productRulesPanel: { flexGrow: 59, flexShrink: 1, flexBasis: 0, alignSelf: 'stretch' },
  reviewRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, paddingVertical: 12, minWidth: 0 },
  reviewCopy: { flex: 1, minWidth: 0 },
  reviewTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap', gap: 8, minWidth: 0 },
  reviewCountPill: { minWidth: 24, paddingHorizontal: 7, paddingVertical: 1, borderRadius: 999, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  reviewCountText: { fontSize: 10, fontWeight: '900' },
  reviewRight: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginLeft: 'auto', flexShrink: 0 },
  reviewClearBanner: { marginTop: 10, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 },
  reviewClearText: { fontSize: 11, fontWeight: '700', flexShrink: 1, minWidth: 0 },
  inlineRetryRow: { marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' },
  inlineLoadingState: { minHeight: 110, alignItems: 'center', justifyContent: 'center', gap: 6 },
  inlineErrorState: { minHeight: 110, alignItems: 'center', justifyContent: 'center', gap: 8 },
  productRuleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 10, paddingVertical: 10, minWidth: 0 },
  productThumbFrame: { width: 42, height: 42, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center', flexShrink: 0, overflow: 'hidden' },
  productThumbImage: { width: 36, height: 36 },
  productRuleCopy: { flex: 1, minWidth: 0 },
  productRuleTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'nowrap', gap: 6, minWidth: 0 },
  productRuleMetaStack: { marginTop: 4, gap: 3, minWidth: 0 },
  productRuleMetaItem: { flexDirection: 'row', alignItems: 'center', gap: 5, minWidth: 0 },
  productRuleMetaText: { fontSize: 11, lineHeight: 14, flexShrink: 1, minWidth: 0 },
  productRuleRight: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8, marginLeft: 'auto', flexShrink: 0 },
});
