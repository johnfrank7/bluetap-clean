const { getManagerQueues, getOngoingDeliveryProgress, lastStatusUpdateOf, statusOf } = require('./managerOperational');
const { formatDeliveryFailureReason } = require('../constants/deliveryFailureReasons');
const { WEEKDAYS, productDeliveryDays, productLimit } = require('./productOrderPolicy');

const ZONED_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;
const INACTIVE_ACCOUNT_STATUSES = new Set([
  'suspended',
  'terminated',
  'deactivated',
  'inactive',
  'disabled',
  'rejected',
  'declined',
  'pending',
]);

function trustedScheduleMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  if (typeof value !== 'string' || !ZONED_INSTANT.test(value.trim())) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function anyTimestampMillis(value) {
  if (!value) return 0;
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatManilaScheduleParts(millis) {
  const numeric = Number(millis);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return { dateKey: '', dayHeader: '', timeLabel: '', fullLabel: 'Not scheduled' };
  }
  const date = new Date(numeric);
  const dateParts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const partMap = {};
  for (const part of dateParts) {
    if (part.type !== 'literal') partMap[part.type] = part.value;
  }
  const dateKey = `${partMap.year || '0000'}-${partMap.month || '00'}-${partMap.day || '00'}`;
  const dayHeader = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
  }).format(date).toUpperCase();
  const timeLabel = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  const fullLabel = new Intl.DateTimeFormat('en-PH', {
    timeZone: 'Asia/Manila',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  return { dateKey, dayHeader, timeLabel, fullLabel };
}

function uniqueOrders(orders = []) {
  const seen = new Set();
  return orders.filter((order) => {
    const id = String(order?.id || order?.requestId || '').trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function initialsForName(name = '') {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return 'BT';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
}

function isEligibleBranchDistributor(user = {}, branchId = '') {
  if (!branchId) return false;
  if (String(user?.role || '').trim().toLowerCase() !== 'distributor') return false;
  if (String(user?.branchId || '').trim() !== String(branchId)) return false;
  if (user?.branchSuspended === true || user?.mustChangePassword === true) return false;
  const distStatus = String(user?.distributorStatus || user?.approvalStatus || user?.status || '').trim().toLowerCase();
  if (!['active', 'approved'].includes(distStatus)) return false;
  const acctStatus = String(user?.accountStatus || '').trim().toLowerCase();
  if (acctStatus && INACTIVE_ACCOUNT_STATUSES.has(acctStatus)) return false;
  return true;
}

function reviewReasonForOrder(order = {}) {
  const status = statusOf(order?.status);
  if (status === 'branch_transfer_pending') {
    const fromBranch = String(order?.transferFromBranchName || '').trim();
    return fromBranch ? `Incoming transfer from ${fromBranch}` : 'Incoming branch transfer requires review';
  }
  if (status === 'outside_radius_pending_approval') {
    return 'Outside service radius · Approval required';
  }
  if (status === 'manager_approval_pending') {
    const reasons = Array.isArray(order?.approvalReasons) ? order.approvalReasons : [];
    if (reasons.includes('NON_STANDARD_DELIVERY_DAY')) return 'Non-standard delivery day · Approval required';
    if (reasons.includes('PRODUCT_LIMIT_EXCEEDED')) return 'Order quantity limit exceeded · Approval required';
    return 'Special order policy · Approval required';
  }
  return 'New branch order · Approval required';
}

function buildPriorityActions({
  operations,
  incomingTransfers = [],
  pendingApplications = [],
  applicationReady = false,
  branchId = '',
} = {}) {
  if (!branchId || !operations) return [];
  const items = [];
  const seenOrderIds = new Set();

  const failedSorted = [...(operations.failedDeliveries || [])].sort((left, right) => {
    const diff = anyTimestampMillis(lastStatusUpdateOf?.(right) || right?.updatedAt || right?.deliveryFailedAt) -
      anyTimestampMillis(lastStatusUpdateOf?.(left) || left?.updatedAt || left?.deliveryFailedAt);
    return diff !== 0 ? diff : String(left?.id || '').localeCompare(String(right?.id || ''));
  });

  for (const order of failedSorted) {
    const id = String(order?.id || order?.requestId || '').trim();
    if (!id || seenOrderIds.has(id)) continue;
    seenOrderIds.add(id);
    items.push({
      key: `failed:${id}`,
      id,
      orderId: id,
      type: 'failed_delivery',
      priorityRank: 1,
      icon: 'ShieldAlert',
      toneKey: 'danger',
      title: order.requesterName || order.requesterNameSnapshot || 'Requester',
      reference: String(order.requestId || id),
      reason: formatDeliveryFailureReason(order, 'Delivery failed · Follow-up required'),
      badgeStatus: 'delivery_failed',
      badgeLabel: 'Delivery Failed',
      actionLabel: 'Recover',
      targetType: 'monitor',
      targetSegment: 'exceptions',
      targetPath: '/manager/distributors',
      order,
    });
  }

  const overdueSorted = [...(operations.overdue || [])].sort((left, right) => {
    const leftAt = trustedScheduleMillis(left?.scheduledAt || left?.scheduled_at || left?.scheduledDeliveryAt);
    const rightAt = trustedScheduleMillis(right?.scheduledAt || right?.scheduled_at || right?.scheduledDeliveryAt);
    return (leftAt - rightAt) || String(left?.id || '').localeCompare(String(right?.id || ''));
  });

  for (const order of overdueSorted) {
    const id = String(order?.id || order?.requestId || '').trim();
    if (!id || seenOrderIds.has(id)) continue;
    seenOrderIds.add(id);
    const schedAt = trustedScheduleMillis(order?.scheduledAt || order?.scheduled_at || order?.scheduledDeliveryAt);
    const parts = formatManilaScheduleParts(schedAt);
    items.push({
      key: `overdue:${id}`,
      id,
      orderId: id,
      type: 'overdue_delivery',
      priorityRank: 2,
      icon: 'ClockHistory',
      toneKey: 'warning',
      title: order.requesterName || order.requesterNameSnapshot || 'Requester',
      reference: String(order.requestId || id),
      reason: parts.dayHeader ? `Delivery overdue · ${parts.dayHeader}, ${parts.timeLabel}` : 'Delivery overdue · Scheduled time passed',
      badgeStatus: 'warning',
      badgeLabel: 'Overdue',
      actionLabel: 'View',
      targetType: 'order',
      targetPath: '/manager/request?filter=ongoing',
      order,
    });
  }

  const validTransfers = (Array.isArray(incomingTransfers) ? incomingTransfers : []).filter(
    (order) => statusOf(order?.status) === 'branch_transfer_pending' && String(order?.transferToBranchId || '').trim() === String(branchId)
  );
  const reviewCombined = uniqueOrders([...(operations.reviewRequests || []), ...validTransfers]).sort((left, right) => {
    const leftAt = anyTimestampMillis(left?.transferRequestedAt || left?.createdAt || left?.created_at);
    const rightAt = anyTimestampMillis(right?.transferRequestedAt || right?.createdAt || right?.created_at);
    return (leftAt - rightAt) || String(left?.id || '').localeCompare(String(right?.id || ''));
  });

  for (const order of reviewCombined) {
    const id = String(order?.id || order?.requestId || '').trim();
    if (!id || seenOrderIds.has(id)) continue;
    seenOrderIds.add(id);
    items.push({
      key: `review:${id}`,
      id,
      orderId: id,
      type: 'review_request',
      priorityRank: 3,
      icon: 'ClipboardList',
      toneKey: 'warning',
      title: order.requesterName || order.requesterNameSnapshot || 'Requester',
      reference: String(order.requestId || id),
      reason: reviewReasonForOrder(order),
      badgeStatus: order.status || 'pending',
      badgeLabel: null,
      actionLabel: 'Review',
      targetType: 'route',
      targetPath: '/manager/request?filter=pending',
      order,
    });
  }

  for (const order of (operations.needsAssignment || [])) {
    const id = String(order?.id || order?.requestId || '').trim();
    if (!id || seenOrderIds.has(id)) continue;
    seenOrderIds.add(id);
    items.push({
      key: `assign:${id}`,
      id,
      orderId: id,
      type: 'unassigned_dispatch',
      priorityRank: 4,
      icon: 'UsersRound',
      toneKey: 'primary',
      title: order.requesterName || order.requesterNameSnapshot || 'Requester',
      reference: String(order.requestId || id),
      reason: 'Ready for distributor assignment',
      badgeStatus: 'awaiting_distributor_assignment',
      badgeLabel: 'Needs Assignment',
      actionLabel: 'Assign',
      targetType: 'route',
      targetPath: '/manager/distributors',
      order,
    });
  }

  if (applicationReady && Array.isArray(pendingApplications)) {
    const seenApplicants = new Set();
    for (const applicant of pendingApplications) {
      const appBranch = String(applicant?.requestedBranchId || applicant?.branchId || '').trim();
      if (appBranch && appBranch !== String(branchId)) continue;
      const uid = String(applicant?.uid || applicant?.id || '').trim();
      if (!uid || seenApplicants.has(uid)) continue;
      seenApplicants.add(uid);
      items.push({
        key: `applicant:${uid}`,
        id: uid,
        orderId: '',
        type: 'distributor_application',
        priorityRank: 5,
        icon: 'UsersRound',
        toneKey: 'primary',
        title: applicant.fullName || applicant.full_name || applicant.name || 'Distributor Applicant',
        reference: String(applicant.publicUid || applicant.displayUid || applicant.unique_id || 'Applicant'),
        reason: 'Pending branch distributor application',
        badgeStatus: 'pending',
        badgeLabel: 'Applicant',
        actionLabel: 'Review',
        targetType: 'route',
        targetPath: '/manager/distributors',
      });
    }
  }

  return items;
}

function buildDeliverySchedule(orders = [], branchId = '', now = Date.now()) {
  if (!branchId) return { entries: [], overdueCount: 0, upcomingCount: 0 };
  const ops = getManagerDashboardOperations(orders, branchId, now);
  const candidates = uniqueOrders([...ops.activeDeliveries, ...ops.scheduledOrders]);
  const entries = [];

  for (const order of candidates) {
    const scheduledAtMillis = trustedScheduleMillis(order?.scheduledAt || order?.scheduled_at || order?.scheduledDeliveryAt);
    if (scheduledAtMillis <= 0) continue;
    const isOverdue = scheduledAtMillis < now;
    const normalizedStatus = statusOf(order.status);
    const parts = formatManilaScheduleParts(scheduledAtMillis);
    const nodeToneKey = isOverdue
      ? 'warning'
      : normalizedStatus === 'out_for_delivery'
        ? 'primary'
        : 'scheduled';
    entries.push({
      id: String(order.id || order.requestId || '').trim(),
      requestId: String(order.requestId || order.id || '').trim(),
      requesterName: order.requesterName || order.requesterNameSnapshot || 'Requester',
      assignedDistributorName: order.assignedDistributorName || order.assignedDistributorNameSnapshot || 'Assigned distributor',
      status: normalizedStatus,
      nodeToneKey,
      scheduledAtMillis,
      isOverdue,
      dateKey: parts.dateKey,
      dayHeader: parts.dayHeader,
      timeLabel: parts.timeLabel,
      fullLabel: parts.fullLabel,
      showDateBadge: true,
      order,
    });
  }

  entries.sort((left, right) => {
    if (left.isOverdue !== right.isOverdue) return left.isOverdue ? -1 : 1;
    if (left.scheduledAtMillis !== right.scheduledAtMillis) return left.scheduledAtMillis - right.scheduledAtMillis;
    return left.id.localeCompare(right.id);
  });

  for (let idx = 0; idx < entries.length; idx += 1) {
    entries[idx].showDateBadge = idx === 0 || entries[idx - 1].dateKey !== entries[idx].dateKey;
  }

  const overdueCount = entries.filter((item) => item.isOverdue).length;
  const upcomingCount = entries.length - overdueCount;
  return { entries, overdueCount, upcomingCount };
}

function finalizeWorkloadEntry(entry) {
  const total = entry.totalWorkload;
  const hasActiveAssignments = total > 0;
  const scheduledRatio = hasActiveAssignments ? entry.scheduledCount / total : 0;
  const deliveringRatio = hasActiveAssignments ? entry.deliveringCount / total : 0;
  const exceptionRatio = hasActiveAssignments ? entry.exceptionCount / total : 0;
  const barSegments = [];
  if (entry.scheduledCount > 0) {
    barSegments.push({
      key: 'scheduled',
      label: 'Scheduled',
      count: entry.scheduledCount,
      flex: entry.scheduledCount,
      ratio: scheduledRatio,
      toneKey: 'scheduled',
    });
  }
  if (entry.deliveringCount > 0) {
    barSegments.push({
      key: 'delivering',
      label: 'Out for Delivery',
      count: entry.deliveringCount,
      flex: entry.deliveringCount,
      ratio: deliveringRatio,
      toneKey: 'primary',
    });
  }
  if (entry.exceptionCount > 0) {
    barSegments.push({
      key: 'exception',
      label: 'Delivery Issue',
      count: entry.exceptionCount,
      flex: entry.exceptionCount,
      ratio: exceptionRatio,
      toneKey: 'danger',
    });
  }
  return {
    ...entry,
    hasActiveAssignments,
    scheduledRatio,
    deliveringRatio,
    exceptionRatio,
    barSegments,
  };
}

function buildDistributorWorkload(orders = [], users = [], branchId = '') {
  if (!branchId) return [];
  const ops = getManagerDashboardOperations(orders, branchId);
  const hasUsersDirectory = Array.isArray(users) && users.length > 0;
  const knownUsersByUid = new Map();
  const workloadByUid = new Map();

  if (Array.isArray(users)) {
    for (const user of users) {
      const uid = String(user?.uid || user?.id || '').trim();
      if (!uid) continue;
      knownUsersByUid.set(uid, user);
      if (!isEligibleBranchDistributor(user, branchId)) continue;
      const name =
        String(user.fullName || user.full_name || `${user.firstName || ''} ${user.lastName || ''}`.trim() || user.name || 'Distributor').trim();
      workloadByUid.set(uid, {
        uid,
        name,
        publicUid: String(user.publicUid || user.displayUid || user.unique_id || '').trim(),
        photoUrl: String(user.profilePhotoUrl || user.photoURL || '').trim(),
        initials: initialsForName(name),
        scheduledCount: 0,
        deliveringCount: 0,
        exceptionCount: 0,
        totalWorkload: 0,
      });
    }
  }

  const ensureDistributorEntry = (order) => {
    const uid = String(order?.assignedDistributorUid || order?.distributor_id || '').trim();
    if (!uid) return null;
    if (workloadByUid.has(uid)) return workloadByUid.get(uid);
    if (knownUsersByUid.has(uid)) {
      return null;
    }
    if (hasUsersDirectory) {
      return null;
    }
    const name = String(
      order?.assignedDistributorName ||
      order?.assignedDistributorNameSnapshot ||
      order?.distributor_name ||
      'Assigned Distributor'
    ).trim();
    const created = {
      uid,
      name,
      publicUid: String(order?.assignedDistributorUniqueId || order?.distributorUniqueId || '').trim(),
      photoUrl: '',
      initials: initialsForName(name),
      scheduledCount: 0,
      deliveringCount: 0,
      exceptionCount: 0,
      totalWorkload: 0,
    };
    workloadByUid.set(uid, created);
    return created;
  };

  for (const order of ops.scheduledOrders) {
    const entry = ensureDistributorEntry(order);
    if (!entry) continue;
    entry.scheduledCount += 1;
    entry.totalWorkload += 1;
  }

  for (const order of ops.activeDeliveries) {
    const entry = ensureDistributorEntry(order);
    if (!entry) continue;
    entry.deliveringCount += 1;
    entry.totalWorkload += 1;
  }

  for (const order of ops.failedDeliveries) {
    const entry = ensureDistributorEntry(order);
    if (!entry) continue;
    entry.exceptionCount += 1;
    entry.totalWorkload += 1;
  }

  return Array.from(workloadByUid.values())
    .map(finalizeWorkloadEntry)
    .sort((left, right) => {
      if (right.totalWorkload !== left.totalWorkload) return right.totalWorkload - left.totalWorkload;
      if (right.deliveringCount !== left.deliveringCount) return right.deliveringCount - left.deliveringCount;
      if (right.scheduledCount !== left.scheduledCount) return right.scheduledCount - left.scheduledCount;
      const nameCmp = left.name.localeCompare(right.name);
      if (nameCmp !== 0) return nameCmp;
      return left.uid.localeCompare(right.uid);
    });
}

function getManagerDashboardOperations(orders = [], branchId = '', now = Date.now(), options = {}) {
  const branchOrders = uniqueOrders((Array.isArray(orders) ? orders : []).filter((order) =>
    branchId && String(order?.currentBranchId || order?.branchId || '').trim() === String(branchId)));
  const queues = getManagerQueues(branchOrders, options.incomingTransfers || [], branchId);
  const needsAssignment = uniqueOrders(queues.dispatch.filter((order) =>
    statusOf(order.status) === 'awaiting_distributor_assignment' &&
    !String(order.assignedDistributorUid || order.distributor_id || '').trim()));
  const failedDeliveries = uniqueOrders(queues.failedDeliveries);
  const activeDeliveries = uniqueOrders(queues.activeDeliveries);
  const scheduledOrders = uniqueOrders(queues.scheduledOrders);
  const overdue = [...activeDeliveries, ...scheduledOrders].filter((order) => {
    const scheduledAt = trustedScheduleMillis(order.scheduledAt || order.scheduled_at || order.scheduledDeliveryAt);
    return scheduledAt > 0 && scheduledAt < now;
  });
  return {
    branchOrders,
    reviewRequests: uniqueOrders([...queues.review, ...queues.exceptions]),
    needsAssignment,
    activeDeliveries,
    scheduledOrders,
    failedDeliveries,
    overdue,
    deliveryOverview: [...activeDeliveries, ...failedDeliveries, ...scheduledOrders],
  };
}

function buildBranchReviewsSummary(options = {}) {
  const {
    branchId = '',
    pendingApplications = [],
    applicationsLoading = false,
    applicationsError = null,
    moderationCases = null,
    moderationCount = null,
    moderationLoading = false,
    moderationError = null,
  } = options || {};

  const normalizedBranchId = String(branchId || '').trim();
  const applicationsReady = Boolean(normalizedBranchId) && !applicationsLoading && !applicationsError;

  const seenApplicantIds = new Set();
  const validPendingApplicants = applicationsReady
    ? (Array.isArray(pendingApplications) ? pendingApplications : []).filter((applicant) => {
        if (!applicant || typeof applicant !== 'object') return false;
        const role = statusOf(applicant.role || 'distributor');
        if (role !== 'distributor') return false;
        const distStatus = statusOf(
          applicant.distributorStatus || applicant.approvalStatus || applicant.status || 'pending'
        );
        if (distStatus !== 'pending') return false;
        const targetBranch = String(applicant.requestedBranchId || applicant.branchId || '').trim();
        if (targetBranch && targetBranch !== normalizedBranchId) return false;
        const id = String(applicant.uid || applicant.id || applicant.email || '').trim();
        if (id) {
          if (seenApplicantIds.has(id)) return false;
          seenApplicantIds.add(id);
        }
        return true;
      })
    : [];

  const pendingCount = applicationsReady ? validPendingApplicants.length : null;
  const applicantNames = validPendingApplicants
    .map((item) =>
      String(
        item.fullName ||
          item.full_name ||
          item.name ||
          `${item.firstName || ''} ${item.lastName || ''}`.trim() ||
          item.email ||
          ''
      ).trim()
    )
    .filter(Boolean);

  let appDescription = 'Checking pending branch distributor applications…';
  if (normalizedBranchId && !applicationsLoading) {
    if (applicationsError) {
      appDescription = 'Pending distributor applications could not be verified.';
    } else if (pendingCount === 0) {
      appDescription = 'No pending distributor applications awaiting branch review.';
    } else if (applicantNames.length > 0) {
      const previewNames = applicantNames.slice(0, 2).join(', ');
      const extra = applicantNames.length > 2 ? ` +${applicantNames.length - 2} more` : '';
      appDescription = `${pendingCount === 1 ? '1 applicant' : `${pendingCount} applicants`} awaiting approval · ${previewNames}${extra}`;
    } else {
      appDescription = `${pendingCount === 1 ? '1 distributor application' : `${pendingCount} distributor applications`} awaiting branch review.`;
    }
  }

  const appToneKey = !applicationsReady ? 'warning' : pendingCount > 0 ? 'warning' : 'primary';
  const appBadgeStatus = !applicationsReady ? 'pending' : pendingCount > 0 ? 'pending' : 'completed';
  const appBadgeLabel = !applicationsReady
    ? applicationsLoading
      ? 'Loading'
      : 'Unavailable'
    : pendingCount > 0
      ? `${pendingCount} Pending`
      : 'Clear';

  const distributorApplications = {
    key: 'distributor_applications',
    icon: 'UsersRound',
    title: 'Distributor Applications',
    ready: applicationsReady,
    loading: Boolean(applicationsLoading),
    error: Boolean(applicationsError),
    count: pendingCount,
    description: appDescription,
    toneKey: appToneKey,
    badgeStatus: appBadgeStatus,
    badgeLabel: appBadgeLabel,
    actionLabel: pendingCount > 0 ? 'Review' : 'View Applications',
    targetPath: '/manager/distributors',
  };

  const hasModerationData =
    Array.isArray(moderationCases) ||
    (moderationCount !== null && moderationCount !== undefined && moderationCount !== '' && Number.isFinite(Number(moderationCount)));
  const moderationReady =
    Boolean(normalizedBranchId) && !moderationLoading && !moderationError && hasModerationData;

  let activeReportCount = null;
  if (moderationReady) {
    if (Array.isArray(moderationCases)) {
      const seenCaseIds = new Set();
      const actionableCases = moderationCases.filter((report) => {
        if (!report || typeof report !== 'object') return false;
        const reportBranchId = String(report.branchId || report.currentBranchId || '').trim();
        if (reportBranchId && reportBranchId !== normalizedBranchId) return false;
        const scope = statusOf(report.scope || report.visibilityScope || '');
        if (scope === 'admin_only' || report.adminOnly === true) return false;
        const st = statusOf(report.status || 'active');
        if (['resolved', 'dismissed', 'closed', 'archived'].includes(st)) return false;
        const caseId = String(report.id || report.reportId || '').trim();
        if (caseId) {
          if (seenCaseIds.has(caseId)) return false;
          seenCaseIds.add(caseId);
        }
        return true;
      });
      activeReportCount = actionableCases.length;
    } else {
      activeReportCount = Math.max(0, Math.floor(Number(moderationCount)));
    }
  }

  let modDescription = 'Checking branch safety and conduct reports…';
  if (normalizedBranchId && !moderationLoading) {
    if (moderationError || !moderationReady) {
      modDescription = 'Branch safety report status is temporarily unavailable.';
    } else if (activeReportCount === 0) {
      modDescription = 'No active branch safety or conduct reports awaiting review.';
    } else {
      modDescription = `${
        activeReportCount === 1
          ? '1 active branch report requires'
          : `${activeReportCount} active branch reports require`
      } Manager review.`;
    }
  }

  const modToneKey = !moderationReady ? 'warning' : activeReportCount > 0 ? 'danger' : 'primary';
  const modBadgeStatus = !moderationReady ? 'pending' : activeReportCount > 0 ? 'failed' : 'completed';
  const modBadgeLabel = !moderationReady
    ? moderationLoading
      ? 'Loading'
      : 'Unavailable'
    : activeReportCount > 0
      ? `${activeReportCount} Active`
      : 'Clear';

  const reportsAndSafety = {
    key: 'reports_and_safety',
    icon: 'ShieldAlert',
    title: 'Reports & Safety',
    ready: moderationReady,
    loading: Boolean(moderationLoading),
    error: Boolean(moderationError),
    count: activeReportCount,
    description: modDescription,
    toneKey: modToneKey,
    badgeStatus: modBadgeStatus,
    badgeLabel: modBadgeLabel,
    actionLabel: 'Review Reports',
    targetPath: '/manager/reports-safety',
  };

  const allClear =
    applicationsReady &&
    moderationReady &&
    pendingCount === 0 &&
    activeReportCount === 0;

  return {
    distributorApplications,
    reportsAndSafety,
    items: [distributorApplications, reportsAndSafety],
    allClear,
    totalActionableCount:
      (applicationsReady ? pendingCount : 0) + (moderationReady ? activeReportCount : 0),
  };
}

const DAY_LABELS = Object.freeze({
  monday: 'Mon',
  tuesday: 'Tue',
  wednesday: 'Wed',
  thursday: 'Thu',
  friday: 'Fri',
  saturday: 'Sat',
  sunday: 'Sun',
});

const DAY_ALIAS_TO_CANONICAL = Object.freeze({
  monday: 'monday',
  mon: 'monday',
  tuesday: 'tuesday',
  tue: 'tuesday',
  tues: 'tuesday',
  wednesday: 'wednesday',
  wed: 'wednesday',
  thursday: 'thursday',
  thu: 'thursday',
  thur: 'thursday',
  thurs: 'thursday',
  friday: 'friday',
  fri: 'friday',
  saturday: 'saturday',
  sat: 'saturday',
  sunday: 'sunday',
  sun: 'sunday',
});

function normalizeProductWeekdays(value) {
  if (!Array.isArray(value)) return [];
  const mapped = value
    .map((day) => DAY_ALIAS_TO_CANONICAL[String(day || '').trim().toLowerCase()] || '')
    .filter(Boolean);
  return productDeliveryDays(mapped);
}

function resolveProductPolicyForDashboard(product = {}, branch = null) {
  const policy = product?.effectivePolicy && typeof product.effectivePolicy === 'object'
    ? product.effectivePolicy
    : null;

  const branchOverrides =
    branch && branch.productPolicyOverrides && typeof branch.productPolicyOverrides === 'object' && !Array.isArray(branch.productPolicyOverrides)
      ? branch.productPolicyOverrides
      : null;
  const override =
    branchOverrides && product?.id && typeof branchOverrides[String(product.id)] === 'object'
      ? branchOverrides[String(product.id)]
      : null;

  let configuredDays = [];
  if (policy && Array.isArray(policy.configuredDeliveryDays)) {
    configuredDays = normalizeProductWeekdays(policy.configuredDeliveryDays);
  } else if (override && Object.prototype.hasOwnProperty.call(override, 'deliveryDays') && Array.isArray(override.deliveryDays)) {
    configuredDays = normalizeProductWeekdays(override.deliveryDays);
  } else if (Array.isArray(product?.configuredDeliveryDays)) {
    configuredDays = normalizeProductWeekdays(product.configuredDeliveryDays);
  } else if (policy && Array.isArray(policy.deliveryDays)) {
    configuredDays = normalizeProductWeekdays(policy.deliveryDays);
  } else {
    configuredDays = normalizeProductWeekdays(product?.deliveryDays);
  }

  let limitValue = null;
  if (policy && Object.prototype.hasOwnProperty.call(policy, 'maxQuantityPerRequester')) {
    limitValue = productLimit(policy.maxQuantityPerRequester);
  } else if (override && Object.prototype.hasOwnProperty.call(override, 'maxQuantityPerRequester')) {
    limitValue = productLimit(override.maxQuantityPerRequester);
  } else {
    limitValue = productLimit(product?.maxQuantityPerRequester);
  }

  const source = String(
    policy?.source ||
      (override ? 'branch_override' : configuredDays.length || limitValue !== null ? 'admin_default' : 'unconfigured')
  );

  return {
    configuredDeliveryDays: configuredDays,
    maxQuantityPerRequester: limitValue,
    source,
  };
}

function buildProductDeliveryRulesPreview(products = [], branchId = '', limit = 3, branch = null) {
  const normalizedBranchId = String(branchId || '').trim();
  if (!normalizedBranchId || !Array.isArray(products)) return [];

  const maxItems = Math.max(1, Number(limit) || 3);
  const seenIds = new Set();

  const relevantProducts = products.filter((product) => {
    if (!product || typeof product !== 'object') return false;
    const id = String(product.id || '').trim();
    const name = String(product.product_name || product.name || '').trim();
    if (!id || !name || seenIds.has(id)) return false;

    if (Array.isArray(product.branchIds) && product.branchIds.length > 0) {
      const branchList = product.branchIds.map((item) => String(item || '').trim()).filter(Boolean);
      if (branchList.length > 0 && !branchList.includes(normalizedBranchId)) return false;
    } else if (product.branchId && String(product.branchId).trim() !== normalizedBranchId) {
      return false;
    }

    seenIds.add(id);
    return true;
  });

  relevantProducts.sort((left, right) => {
    const leftActive = left.active !== false ? 1 : 0;
    const rightActive = right.active !== false ? 1 : 0;
    if (rightActive !== leftActive) return rightActive - leftActive;
    const leftName = String(left.product_name || left.name || '').trim();
    const rightName = String(right.product_name || right.name || '').trim();
    const nameCmp = leftName.localeCompare(rightName);
    if (nameCmp !== 0) return nameCmp;
    return String(left.id || '').localeCompare(String(right.id || ''));
  });

  return relevantProducts.slice(0, maxItems).map((product) => {
    const id = String(product.id || '').trim();
    const name = String(product.product_name || product.name || 'Unnamed Product').trim();
    const rawPrice = Number(product.price);
    const price =
      product.price !== null &&
      product.price !== undefined &&
      product.price !== '' &&
      Number.isFinite(rawPrice) &&
      rawPrice >= 0
        ? Math.round(rawPrice * 100) / 100
        : null;
    const priceLabel = price !== null ? `₱${price.toFixed(2)}` : '';
    const imageUrl = String(product.imageUrl || product.image || '').trim();
    const containerMeta = [product.containerType || product.capacity, product.size]
      .map((value) => String(value || '').trim())
      .filter(Boolean)
      .join(' · ');
    const active = product.active !== false;
    const resolved = resolveProductPolicyForDashboard(product, branch);
    const configuredDays = resolved.configuredDeliveryDays;
    const hasDeliveryDaysConfigured = configuredDays.length > 0;
    const deliveryDaysLabel = !hasDeliveryDaysConfigured
      ? 'Delivery days not configured'
      : configuredDays.length === WEEKDAYS.length
        ? 'Every day (Mon–Sun)'
        : configuredDays.map((day) => DAY_LABELS[day] || day).join(', ');

    const maxQuantityPerRequester = resolved.maxQuantityPerRequester;
    const hasLimitConfigured = maxQuantityPerRequester !== null;
    const limitLabel = hasLimitConfigured
      ? `Max ${maxQuantityPerRequester} per request`
      : 'No requester limit';

    return {
      id,
      name,
      price,
      priceLabel,
      imageUrl,
      containerMeta,
      active,
      statusBadge: active ? 'completed' : 'cancelled',
      statusLabel: active ? 'Active' : 'Inactive',
      deliveryDays: configuredDays,
      hasDeliveryDaysConfigured,
      deliveryDaysLabel,
      maxQuantityPerRequester,
      hasLimitConfigured,
      limitLabel,
      policySource: resolved.source,
      targetPath: '/manager/products',
    };
  });
}

module.exports = {
  getManagerDashboardOperations,
  getOngoingDeliveryProgress,
  buildPriorityActions,
  buildDeliverySchedule,
  buildDistributorWorkload,
  buildBranchReviewsSummary,
  buildProductDeliveryRulesPreview,
  isEligibleBranchDistributor,
  formatManilaScheduleParts,
  trustedScheduleMillis,
};
