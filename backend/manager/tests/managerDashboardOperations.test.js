const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');
const {
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
} = require('../../../services/managerDashboardOperations');

const root = resolve(__dirname, '../../..');
const page = readFileSync(resolve(root, 'components/ManagerOperationsDashboard.jsx'), 'utf8');
const monitor = readFileSync(resolve(root, 'components/ManagerOngoingRequestsMonitor.jsx'), 'utf8');
const provider = readFileSync(resolve(root, 'components/ManagerRealtimeData.jsx'), 'utf8');
const salesChart = readFileSync(resolve(root, 'components/SalesOverviewContent.jsx'), 'utf8');
const shell = readFileSync(resolve(root, 'components/ManagerShell.jsx'), 'utf8');

const order = (id, status, extra = {}) => ({ id, branchId: 'north', status, ...extra });

test('dashboard operational counts are scoped, deduplicated, and follow trusted lifecycle statuses', () => {
  const rows = [
    order('assign', 'awaiting_distributor_assignment'),
    order('assign', 'awaiting_distributor_assignment'),
    order('assigned', 'assigned', { assignedDistributorUid: 'driver' }),
    order('accepted', 'accepted', { assignedDistributorUid: 'driver' }),
    order('scheduled', 'scheduled', { assignedDistributorUid: 'driver' }),
    order('rescheduled', 'rescheduled', { assignedDistributorUid: 'driver' }),
    order('active', 'out_for_delivery', { assignedDistributorUid: 'driver' }),
    order('failed', 'delivery_failed', { assignedDistributorUid: 'driver' }),
    order('delivered', 'delivered', { assignedDistributorUid: 'driver' }),
    order('cancelled', 'cancelled'),
    order('other', 'out_for_delivery', { currentBranchId: 'south', assignedDistributorUid: 'driver' }),
  ];
  const result = getManagerDashboardOperations(rows, 'north');
  assert.deepEqual(result.needsAssignment.map((entry) => entry.id), ['assign']);
  assert.equal(result.scheduledOrders.length, 4);
  assert.deepEqual(result.activeDeliveries.map((entry) => entry.id), ['active']);
  assert.deepEqual(result.failedDeliveries.map((entry) => entry.id), ['failed']);
  assert.equal(result.deliveryOverview.length, 6);
  assert.ok(!result.deliveryOverview.some((entry) => ['delivered', 'cancelled', 'other'].includes(entry.id)));
  assert.equal(getManagerDashboardOperations(rows, '').branchOrders.length, 0);
});

test('lifecycle transitions move each order between dashboard groups without duplication', () => {
  const base = order('one', 'scheduled', { assignedDistributorUid: 'driver' });
  const groups = ['scheduled', 'out_for_delivery', 'delivery_failed', 'delivered'].map((status) =>
    getManagerDashboardOperations([{ ...base, status }], 'north'));
  assert.deepEqual(groups.map((item) => [item.scheduledOrders.length, item.activeDeliveries.length, item.failedDeliveries.length]),
    [[1, 0, 0], [0, 1, 0], [0, 0, 1], [0, 0, 0]]);
});

test('overdue requires a zoned instant and a current eligible delivery', () => {
  const now = Date.parse('2026-10-20T05:00:00Z');
  const rows = [
    order('past', 'scheduled', { assignedDistributorUid: 'driver', scheduledAt: '2026-10-20T12:00:00+08:00' }),
    order('future', 'scheduled', { assignedDistributorUid: 'driver', scheduledAt: '2026-10-20T14:00:00+08:00' }),
    order('naive', 'scheduled', { assignedDistributorUid: 'driver', scheduledAt: '2026-10-20T12:00:00' }),
    order('date-only', 'scheduled', { assignedDistributorUid: 'driver', scheduledDate: '2026-10-19' }),
    order('failed', 'delivery_failed', { assignedDistributorUid: 'driver', scheduledAt: '2026-10-19T12:00:00+08:00' }),
    order('delivered', 'delivered', { assignedDistributorUid: 'driver', scheduledAt: '2026-10-19T12:00:00+08:00' }),
  ];
  const result = getManagerDashboardOperations(rows, 'north', now);
  assert.deepEqual(result.overdue.map((entry) => entry.id), ['past']);
  assert.equal(trustedScheduleMillis('2026-10-20T12:00:00'), 0);
  assert.equal(trustedScheduleMillis('2026-10-20'), 0);
  assert.equal(trustedScheduleMillis('2026-10-20T12:00:00+08:00'), Date.parse('2026-10-20T04:00:00Z'));
});

test('Priority Actions classifies, prioritizes, deduplicates, and scopes items to the Manager branch', () => {
  const now = Date.parse('2026-10-21T03:00:00Z'); // 11:00 AM Manila
  const rows = [
    order('assign-1', 'awaiting_distributor_assignment', {
      requestId: 'BT-2026-000104',
      requesterName: 'Assign Customer',
      dispatchReadyAt: '2026-10-21T01:00:00Z',
    }),
    order('review-1', 'outside_radius_pending_approval', {
      requestId: 'BT-2026-000103',
      requesterName: 'Review Customer',
      createdAt: '2026-10-21T00:30:00Z',
    }),
    order('overdue-1', 'scheduled', {
      requestId: 'BT-2026-000102',
      requesterName: 'Overdue Customer',
      assignedDistributorUid: 'dist-1',
      scheduledAt: '2026-10-21T09:00:00+08:00',
    }),
    order('failed-1', 'delivery_failed', {
      requestId: 'BT-2026-000101',
      requesterName: 'Failed Customer',
      assignedDistributorUid: 'dist-1',
      deliveryFailureReason: 'RECIPIENT_UNAVAILABLE',
      updatedAt: '2026-10-21T02:30:00Z',
    }),
    order('failed-1', 'delivery_failed', {
      requestId: 'BT-2026-000101',
      requesterName: 'Failed Customer Duplicate',
      assignedDistributorUid: 'dist-1',
    }),
    order('south-order', 'delivery_failed', {
      currentBranchId: 'south',
      assignedDistributorUid: 'dist-south',
    }),
  ];

  const incomingTransfers = [
    {
      id: 'transfer-1',
      requestId: 'BT-2026-000105',
      status: 'branch_transfer_pending',
      transferToBranchId: 'north',
      transferFromBranchName: 'South Branch',
      requesterName: 'Transfer Customer',
      transferRequestedAt: '2026-10-21T01:15:00Z',
    },
    {
      id: 'transfer-other',
      status: 'branch_transfer_pending',
      transferToBranchId: 'south',
    },
  ];

  const pendingApplications = [
    { uid: 'app-1', fullName: 'Applicant One', publicUid: 'DIST-901', requestedBranchId: 'north', role: 'distributor', distributorStatus: 'pending' },
    { uid: 'app-south', fullName: 'Applicant South', requestedBranchId: 'south', role: 'distributor', distributorStatus: 'pending' },
  ];

  const operations = getManagerDashboardOperations(rows, 'north', now);
  const actions = buildPriorityActions({
    operations,
    incomingTransfers,
    pendingApplications,
    applicationReady: true,
    branchId: 'north',
  });

  // Verify urgency ordering: failed (1) -> overdue (2) -> review/transfer (3) -> unassigned dispatch (4) -> applicant (5)
  assert.deepEqual(
    actions.map((item) => [item.type, item.id]),
    [
      ['failed_delivery', 'failed-1'],
      ['overdue_delivery', 'overdue-1'],
      ['review_request', 'review-1'],
      ['review_request', 'transfer-1'],
      ['unassigned_dispatch', 'assign-1'],
      ['distributor_application', 'app-1'],
    ]
  );

  // Verify action destinations and labels
  assert.equal(actions[0].actionLabel, 'Recover');
  assert.equal(actions[0].targetType, 'monitor');
  assert.equal(actions[0].targetSegment, 'exceptions');
  assert.equal(actions[1].actionLabel, 'View');
  assert.equal(actions[1].badgeLabel, 'Overdue');
  assert.equal(actions[2].actionLabel, 'Review');
  assert.equal(actions[2].targetPath, '/manager/request?filter=pending');
  assert.equal(actions[4].actionLabel, 'Assign');
  assert.equal(actions[4].targetPath, '/manager/distributors');
  assert.equal(actions[5].actionLabel, 'Review');
  assert.equal(actions[5].targetPath, '/manager/distributors');

  // Empty branch returns no priority actions
  assert.deepEqual(buildPriorityActions({ operations, branchId: '' }), []);
});

test('Delivery Schedule sorts overdue first then upcoming chronologically in Asia/Manila and excludes terminal or unscheduled orders', () => {
  const now = Date.parse('2026-10-21T04:00:00Z'); // Oct 21, 12:00 PM Manila
  const rows = [
    order('upcoming-late', 'scheduled', {
      requestId: 'BT-2026-000203',
      requesterName: 'Tomorrow Customer',
      assignedDistributorUid: 'dist-1',
      assignedDistributorName: 'Carlos Reyes',
      scheduledAt: '2026-10-22T13:30:00+08:00',
    }),
    order('upcoming-soon', 'out_for_delivery', {
      requestId: 'BT-2026-000202',
      requesterName: 'Afternoon Customer',
      assignedDistributorUid: 'dist-1',
      assignedDistributorName: 'Carlos Reyes',
      scheduledAt: '2026-10-21T15:00:00+08:00',
    }),
    order('overdue-1', 'scheduled', {
      requestId: 'BT-2026-000201',
      requesterName: 'Morning Customer',
      assignedDistributorUid: 'dist-2',
      assignedDistributorName: 'Elena Santos',
      scheduledAt: '2026-10-21T09:00:00+08:00',
    }),
    order('unscheduled', 'accepted', {
      assignedDistributorUid: 'dist-1',
      scheduledDate: '2026-10-21', // date-only string without zoned instant must not be invented
    }),
    order('naive', 'scheduled', {
      assignedDistributorUid: 'dist-1',
      scheduledAt: '2026-10-21T14:00:00', // naive timestamp rejected
    }),
    order('delivered', 'delivered', {
      assignedDistributorUid: 'dist-1',
      scheduledAt: '2026-10-21T16:00:00+08:00',
    }),
    order('cancelled', 'cancelled', {
      assignedDistributorUid: 'dist-1',
      scheduledAt: '2026-10-21T16:00:00+08:00',
    }),
    order('failed', 'delivery_failed', {
      assignedDistributorUid: 'dist-1',
      scheduledAt: '2026-10-21T10:00:00+08:00',
    }),
    order('other-branch', 'scheduled', {
      currentBranchId: 'south',
      assignedDistributorUid: 'dist-south',
      scheduledAt: '2026-10-21T13:00:00+08:00',
    }),
  ];

  const schedule = buildDeliverySchedule(rows, 'north', now);
  assert.equal(schedule.overdueCount, 1);
  assert.equal(schedule.upcomingCount, 2);
  assert.deepEqual(
    schedule.entries.map((entry) => [entry.id, entry.isOverdue, entry.dateKey, entry.timeLabel]),
    [
      ['overdue-1', true, '2026-10-21', '9:00 AM'],
      ['upcoming-soon', false, '2026-10-21', '3:00 PM'],
      ['upcoming-late', false, '2026-10-22', '1:30 PM'],
    ]
  );

  const manilaMidnightBoundary = formatManilaScheduleParts(Date.parse('2026-10-20T16:30:00Z')); // Oct 21 00:30 AM Manila
  assert.equal(manilaMidnightBoundary.dateKey, '2026-10-21');
});

test('Distributor Workload aggregates distinct current assignments, respects reassignments, and enforces branch eligibility', () => {
  const users = [
    { uid: 'dist-a', role: 'distributor', branchId: 'north', distributorStatus: 'approved', accountStatus: 'active', fullName: 'Daniel Aquino', publicUid: 'DIST-101' },
    { uid: 'dist-b', role: 'distributor', branchId: 'north', distributorStatus: 'active', accountStatus: 'active', fullName: 'Marco Mendoza', publicUid: 'DIST-102' },
    { uid: 'dist-idle', role: 'distributor', branchId: 'north', distributorStatus: 'approved', accountStatus: 'active', fullName: 'lara Bautista', publicUid: 'DIST-103' },
    { uid: 'dist-pending', role: 'distributor', branchId: 'north', distributorStatus: 'pending', accountStatus: 'pending', fullName: 'Pending Applicant' },
    { uid: 'dist-suspended', role: 'distributor', branchId: 'north', distributorStatus: 'approved', accountStatus: 'suspended', fullName: 'Suspended Dist' },
    { uid: 'dist-branch-susp', role: 'distributor', branchId: 'north', distributorStatus: 'approved', accountStatus: 'active', branchSuspended: true, fullName: 'Branch Suspended' },
    { uid: 'dist-south', role: 'distributor', branchId: 'south', distributorStatus: 'approved', accountStatus: 'active', fullName: 'South Dist' },
  ];

  assert.equal(isEligibleBranchDistributor(users[0], 'north'), true);
  assert.equal(isEligibleBranchDistributor(users[3], 'north'), false);
  assert.equal(isEligibleBranchDistributor(users[4], 'north'), false);
  assert.equal(isEligibleBranchDistributor(users[5], 'north'), false);
  assert.equal(isEligibleBranchDistributor(users[6], 'north'), false);

  const orders = [
    // dist-a has 2 scheduled + 1 delivering (and duplicate ID is ignored)
    order('ord-1', 'scheduled', { assignedDistributorUid: 'dist-a' }),
    order('ord-1', 'scheduled', { assignedDistributorUid: 'dist-a' }),
    order('ord-2', 'accepted', { assignedDistributorUid: 'dist-a' }),
    order('ord-3', 'out_for_delivery', { assignedDistributorUid: 'dist-a' }),
    // ord-4 was reassigned from dist-b to dist-a: only current owner dist-a counts
    order('ord-4', 'scheduled', {
      assignedDistributorUid: 'dist-b',
      assignmentHistory: [{ distributorUid: 'dist-a', event: 'ASSIGNED' }],
    }),
    // dist-b also has 1 failed delivery exception
    order('ord-5', 'delivery_failed', { assignedDistributorUid: 'dist-b' }),
    // Terminal orders excluded from current workload
    order('ord-6', 'delivered', { assignedDistributorUid: 'dist-b' }),
    order('ord-7', 'cancelled', { assignedDistributorUid: 'dist-b' }),
    // Cross-branch order excluded
    order('ord-south', 'out_for_delivery', { currentBranchId: 'south', assignedDistributorUid: 'dist-south' }),
  ];

  const workload = buildDistributorWorkload(orders, users, 'north');
  assert.deepEqual(
    workload.map((d) => ({
      uid: d.uid,
      initials: d.initials,
      scheduled: d.scheduledCount,
      delivering: d.deliveringCount,
      exceptions: d.exceptionCount,
      total: d.totalWorkload,
    })),
    [
      { uid: 'dist-a', initials: 'DA', scheduled: 2, delivering: 1, exceptions: 0, total: 3 },
      { uid: 'dist-b', initials: 'MM', scheduled: 1, delivering: 0, exceptions: 1, total: 2 },
      { uid: 'dist-idle', initials: 'LB', scheduled: 0, delivering: 0, exceptions: 0, total: 0 },
    ]
  );

  // Verify reassignment moves order between distributors immediately
  const afterReassign = orders.map((item) =>
    item.id === 'ord-4' ? { ...item, assignedDistributorUid: 'dist-idle' } : item
  );
  const updatedWorkload = buildDistributorWorkload(afterReassign, users, 'north');
  const distB = updatedWorkload.find((d) => d.uid === 'dist-b');
  const distIdle = updatedWorkload.find((d) => d.uid === 'dist-idle');
  assert.equal(distB.scheduledCount, 0);
  assert.equal(distIdle.scheduledCount, 1);
});

test('dashboard actions target existing Manager routes and monitor filters', () => {
  for (const phrase of [
    "'/manager/distributors'",
    "'/manager/request?filter=pending'",
    "'/manager/request?filter=ongoing'",
    "'/manager/analytics'",
    "pathname: '/manager/request'",
    "openPanel('scheduled')",
    "openPanel('active')",
    "openPanel('exceptions')",
  ]) {
    assert.ok(page.includes(phrase), `Missing action ${phrase}`);
  }
  assert.match(monitor, /requestedSegment/);
  assert.match(monitor, /key: 'exceptions'/);
  assert.match(page, /Priority Actions/);
  assert.match(page, /Live Deliveries/);
  assert.match(page, /Delivery Schedule/);
  assert.match(page, /Distributor Workload/);
  assert.match(page, /No items requiring attention\./);
  assert.match(page, /No upcoming deliveries\./);
  assert.match(page, /unavailable \? '—' : count\(value\)/);
  assert.match(page, /ready \? count\(value\) : '—'/);
  assert.match(page, /timeZone: 'Asia\/Manila'/);
  assert.match(page, /!realtime\.applicationsLoading && !errors\.applicants/);
  assert.match(provider, /applicationsLoading: !ready\.applicants/);
  assert.match(page, /Showing the last branch snapshot/);
  // Never invent fake distributor online/availability status
  assert.doesNotMatch(page, /\b(?:Online|Offline|Available now|Busy)\b/);
});

test('delivery preview keeps three compact rows and separate accessible order details', () => {
  assert.match(page, /\.slice\(0, 3\)/);
  for (const key of ["['all', 'All'", "['active', 'Active'", "['scheduled', 'Scheduled'", "['exceptions', 'Exceptions'"]) {
    assert.ok(page.includes(key), `Missing delivery filter ${key}`);
  }
  assert.match(page, /label="View Details" accessibilityLabel=\{`View details for order \$\{reference\}`\}/);
  assert.match(page, /onPress=\{\(\) => onView\(order\)\}/);
  assert.match(page, /numberOfLines=\{1\}/);
  assert.match(page, /deliveryRow: \{[^}]*flexWrap: 'wrap'/);
  assert.match(page, /<SoftStatusBadge status=\{order\.status\} compact/);
  assert.match(page, /label="Open monitor"/);
  assert.match(page, /label="View all requests"/);
});

test('Manager Sales Overview reuses the BlueTap doughnut and live branch analytics', () => {
  assert.match(page, /<SalesOverviewContent/);
  assert.match(page, /totalOrders: analytics\.total, deliveredOrders: analytics\.delivered, revenue: analytics\.revenue, units: analytics\.units/);
  assert.match(page, /getManagerOrderAnalytics\(operations\.branchOrders\)/);
  assert.match(page, /stacked=\{width < 520\}/);
  assert.match(page, /horizontalMetrics=\{width >= 760\}/);
  assert.match(page, /label="View Analytics"/);
  assert.match(salesChart, /conic-gradient/);
  assert.match(salesChart, /BlueTapBrandMark/);
  assert.match(salesChart, /styles\.pieHole/);
  assert.match(salesChart, /No orders in this snapshot/);
  assert.match(salesChart, /Delivered Orders|DELIVERED ORDERS/);
  assert.match(salesChart, /SNAPSHOT REVENUE/);
  assert.match(salesChart, /UNITS SOLD/);
  assert.match(salesChart, /salesFigureVerticalDivider/);
  assert.match(salesChart, /salesFigureHorizontalDivider/);
});

test('Manager Dashboard enforces equal-height rows, compact branch strip, standardized spacing, and floating button clearance', () => {
  assert.match(page, /operationsGrid:\s*\{[^}]*flexDirection:\s*'row'[^}]*alignItems:\s*'stretch'/);
  assert.match(page, /attentionPanel:\s*\{[^}]*flexGrow:\s*41,\s*flexShrink:\s*1,\s*flexBasis:\s*0,\s*alignSelf:\s*'stretch'/);
  assert.match(page, /deliveryPanel:\s*\{[^}]*flexGrow:\s*59,\s*flexShrink:\s*1,\s*flexBasis:\s*0,\s*alignSelf:\s*'stretch'/);
  assert.match(page, /schedulePanel:\s*\{[^}]*flexGrow:\s*50,\s*flexShrink:\s*1,\s*flexBasis:\s*0,\s*alignSelf:\s*'stretch'/);
  assert.match(page, /workloadPanel:\s*\{[^}]*flexGrow:\s*50,\s*flexShrink:\s*1,\s*flexBasis:\s*0,\s*alignSelf:\s*'stretch'/);
  assert.match(page, /kpiGrid:\s*\{[^}]*alignItems:\s*'stretch'/);
  assert.match(page, /kpi:\s*\{[^}]*alignSelf:\s*'stretch'/);
  assert.doesNotMatch(page, /kpi:\s*\{[^}]*minHeight:\s*160/);
  assert.match(page, /panelFooter:\s*\{[^}]*marginTop:\s*'auto'/);
  assert.match(page, /ASSIGNED BRANCH/);
  assert.match(page, /SidebarIcon name="Building2"/);
  assert.match(page, /deliveryAction:\s*\{[^}]*marginLeft:\s*'auto'/);
  assert.match(page, /attentionRight:\s*\{[^}]*marginLeft:\s*'auto'/);
  assert.match(page, /scheduleRight:\s*\{[^}]*marginLeft:\s*'auto'/);
  assert.match(page, /workloadRight:\s*\{[^}]*marginLeft:\s*'auto'/);
  assert.match(page, /dashboardContainer:\s*\{[^}]*paddingBottom:\s*24/);
  assert.match(shell, /content:\s*\{[^}]*paddingHorizontal:\s*24,\s*paddingBottom:\s*164/);
});

test('Live Deliveries stage progress maps Assigned -> Scheduled -> Out for Delivery -> Delivered and isolates delivery_failed exceptions', () => {
  for (const assignedStatus of ['assigned', 'accepted']) {
    const assignedStage = getOngoingDeliveryProgress(order('o1', assignedStatus));
    assert.equal(assignedStage.isException, false);
    assert.equal(assignedStage.activeStepIndex, 0);
    assert.deepEqual(
      assignedStage.steps.map((s) => [s.label, s.completed, s.current, s.upcoming]),
      [
        ['Assigned', false, true, false],
        ['Scheduled', false, false, true],
        ['Out for Delivery', false, false, true],
        ['Delivered', false, false, true],
      ]
    );
  }

  for (const schedStatus of ['scheduled', 'rescheduled']) {
    const schedStage = getOngoingDeliveryProgress(order('o2', schedStatus));
    assert.equal(schedStage.isException, false);
    assert.equal(schedStage.activeStepIndex, 1);
    assert.deepEqual(
      schedStage.steps.map((s) => [s.completed, s.current, s.upcoming]),
      [
        [true, false, false],
        [false, true, false],
        [false, false, true],
        [false, false, true],
      ]
    );
  }

  const activeStage = getOngoingDeliveryProgress(order('o3', 'out_for_delivery'));
  assert.equal(activeStage.isException, false);
  assert.equal(activeStage.activeStepIndex, 2);
  assert.deepEqual(
    activeStage.steps.map((s) => [s.completed, s.current, s.upcoming]),
    [
      [true, false, false],
      [true, false, false],
      [false, true, false],
      [false, false, true],
    ]
  );

  const failedStage = getOngoingDeliveryProgress(order('o4', 'delivery_failed'));
  assert.equal(failedStage.isException, true);
  assert.equal(failedStage.linearSupported, false);
  assert.equal(failedStage.activeStepIndex, -1);

  assert.match(page, /function DeliveryStageTrack/);
  assert.match(page, /deliveryStageSegments/);
  assert.match(page, /deliveryStageLabels/);
  assert.match(page, /deliveryExceptionBar/);
});

test('Delivery Schedule timeline computes semantic node tones and avoids repeating date badges on the same Manila date', () => {
  const now = Date.parse('2026-10-21T04:00:00Z'); // Oct 21, 12:00 PM Manila
  const rows = [
    order('overdue-1', 'scheduled', {
      assignedDistributorUid: 'dist-1',
      scheduledAt: '2026-10-21T09:00:00+08:00',
    }),
    order('active-same-day', 'out_for_delivery', {
      assignedDistributorUid: 'dist-1',
      scheduledAt: '2026-10-21T14:00:00+08:00',
    }),
    order('scheduled-next-day', 'scheduled', {
      assignedDistributorUid: 'dist-2',
      scheduledAt: '2026-10-22T10:30:00+08:00',
    }),
  ];

  const schedule = buildDeliverySchedule(rows, 'north', now);
  assert.deepEqual(
    schedule.entries.map((entry) => ({
      id: entry.id,
      nodeToneKey: entry.nodeToneKey,
      showDateBadge: entry.showDateBadge,
    })),
    [
      { id: 'overdue-1', nodeToneKey: 'warning', showDateBadge: true },
      { id: 'active-same-day', nodeToneKey: 'primary', showDateBadge: false },
      { id: 'scheduled-next-day', nodeToneKey: 'scheduled', showDateBadge: true },
    ]
  );

  assert.match(page, /scheduleTimelineItem/);
  assert.match(page, /scheduleTimelineNodeOuter/);
  assert.match(page, /scheduleTimelineConnector:\s*\{[^}]*width:\s*2/);
});

test('Distributor Workload computes exact proportional bar segments and renders empty track for zero assignments', () => {
  const users = [
    { uid: 'dist-active', role: 'distributor', branchId: 'north', distributorStatus: 'approved', accountStatus: 'active', fullName: 'Active Driver', publicUid: 'DIST-201' },
    { uid: 'dist-idle', role: 'distributor', branchId: 'north', distributorStatus: 'approved', accountStatus: 'active', fullName: 'Idle Driver', publicUid: 'DIST-202' },
  ];
  const orders = [
    order('s1', 'scheduled', { assignedDistributorUid: 'dist-active' }),
    order('s2', 'accepted', { assignedDistributorUid: 'dist-active' }),
    order('d1', 'out_for_delivery', { assignedDistributorUid: 'dist-active' }),
  ];

  const workload = buildDistributorWorkload(orders, users, 'north');
  const active = workload.find((d) => d.uid === 'dist-active');
  const idle = workload.find((d) => d.uid === 'dist-idle');

  assert.equal(active.hasActiveAssignments, true);
  assert.equal(active.scheduledCount, 2);
  assert.equal(active.deliveringCount, 1);
  assert.equal(active.totalWorkload, 3);
  assert.ok(Math.abs(active.scheduledRatio - 2 / 3) < 1e-9);
  assert.ok(Math.abs(active.deliveringRatio - 1 / 3) < 1e-9);
  assert.equal(active.exceptionRatio, 0);
  assert.deepEqual(
    active.barSegments.map((seg) => ({ key: seg.key, count: seg.count, flex: seg.flex, toneKey: seg.toneKey })),
    [
      { key: 'scheduled', count: 2, flex: 2, toneKey: 'scheduled' },
      { key: 'delivering', count: 1, flex: 1, toneKey: 'primary' },
    ]
  );

  assert.equal(idle.hasActiveAssignments, false);
  assert.equal(idle.totalWorkload, 0);
  assert.deepEqual(idle.barSegments, []);

  assert.match(page, /workloadBarTrack/);
  assert.match(page, /workloadBarSegment/);
  assert.match(page, /No active assignments/);
  assert.match(page, /attentionAccentBar/);
  assert.match(page, /OngoingRequestFieldIcon/);
  assert.match(salesChart, /CircleDollarSign/);
  assert.match(salesChart, /ShieldCheck/);
  assert.match(salesChart, /Package/);
  assert.match(salesChart, /salesMetricIconBadge/);
});

test('Manager Dashboard entrance animation runs once per session and respects reduced-motion preference', () => {
  const {
    hasCompletedDashboardEntrance,
    markDashboardEntranceCompleted,
    resetDashboardEntranceForTests,
    getDashboardEntranceMotion,
  } = require('../../../services/managerOrderTargetNavigation');
  const shellSource = shell;

  resetDashboardEntranceForTests();
  assert.equal(hasCompletedDashboardEntrance('manager_dashboard'), false);

  const firstLoadSection0 = getDashboardEntranceMotion({
    sectionIndex: 0,
    reduceMotion: false,
    alreadyCompleted: hasCompletedDashboardEntrance('manager_dashboard'),
  });
  const firstLoadSection3 = getDashboardEntranceMotion({
    sectionIndex: 3,
    reduceMotion: false,
    alreadyCompleted: hasCompletedDashboardEntrance('manager_dashboard'),
  });
  assert.deepEqual(firstLoadSection0, {
    shouldAnimate: true,
    initialOpacity: 0,
    initialTranslateY: 8,
    durationMs: 300,
    delayMs: 0,
  });
  assert.deepEqual(firstLoadSection3, {
    shouldAnimate: true,
    initialOpacity: 0,
    initialTranslateY: 8,
    durationMs: 300,
    delayMs: 180,
  });

  markDashboardEntranceCompleted('manager_dashboard');
  assert.equal(hasCompletedDashboardEntrance('manager_dashboard'), true);

  const returnVisitMotion = getDashboardEntranceMotion({
    sectionIndex: 2,
    reduceMotion: false,
    alreadyCompleted: hasCompletedDashboardEntrance('manager_dashboard'),
  });
  assert.deepEqual(returnVisitMotion, {
    shouldAnimate: false,
    initialOpacity: 1,
    initialTranslateY: 0,
    durationMs: 0,
    delayMs: 0,
  });

  resetDashboardEntranceForTests();
  const reducedMotion = getDashboardEntranceMotion({
    sectionIndex: 1,
    reduceMotion: true,
    alreadyCompleted: false,
  });
  assert.deepEqual(reducedMotion, {
    shouldAnimate: false,
    initialOpacity: 1,
    initialTranslateY: 0,
    durationMs: 0,
    delayMs: 0,
  });

  assert.match(page, /DashboardSectionEntrance/);
  assert.match(page, /useReducedMotionPreference/);
  assert.match(page, /hasCompletedDashboardEntrance\('manager_dashboard'\)/);
  assert.match(page, /markDashboardEntranceCompleted\('manager_dashboard'\)/);
  assert.match(shellSource, /distance=\{active === 'dashboard' \? 0 : 8\}/);
  assert.match(shellSource, /duration=\{active === 'dashboard' \? 0 : 230\}/);
});

test('compact list cards apply controlled text truncation while detail modals preserve full text', () => {
  const notificationCardSource = readFileSync(resolve(root, 'components/NotificationCard.jsx'), 'utf8');
  const requestPageSource = readFileSync(resolve(root, 'app/manager/request.jsx'), 'utf8');

  // Dashboard rows truncate with ellipsis and expose web title tooltips
  assert.match(page, /numberOfLines=\{1\} ellipsizeMode="tail" title=\{item\.title\}/);
  assert.match(page, /numberOfLines=\{2\} ellipsizeMode="tail" title=\{item\.reason\}/);
  assert.match(page, /numberOfLines=\{1\} ellipsizeMode="tail" title=\{requesterLabel\}/);
  assert.match(page, /numberOfLines=\{1\} ellipsizeMode="tail" title=\{detailLabel\}/);
  assert.match(page, /numberOfLines=\{1\} ellipsizeMode="tail" title=\{entry\.requesterName\}/);
  assert.match(page, /numberOfLines=\{1\} ellipsizeMode="tail" title=\{distributorTitle\}/);

  // Notification cards truncate message to 2 lines and metadata with tail ellipsis
  assert.match(notificationCardSource, /numberOfLines=\{2\} ellipsizeMode="tail" style=\{\[styles\.message/);
  assert.match(notificationCardSource, /numberOfLines=\{layout\.metadataLines\} ellipsizeMode="tail" style=\{\[styles\.metadata/);

  // Request queue cards truncate compact rows while EditOrderModal detailGridValue remains untruncated
  assert.match(requestPageSource, /numberOfLines=\{1\} ellipsizeMode="tail" style=\{styles\.requesterName\}/);
  assert.match(requestPageSource, /numberOfLines=\{2\} ellipsizeMode="tail" style=\{\[styles\.productsSummary, styles\.productsSummaryInline\]\}/);
  assert.match(requestPageSource, /<Text style=\{styles\.detailGridValue\}>\{value\}<\/Text>/);
});

test('deep-link order target resolution locates the live section/tab, highlights in place, and handles missing orders cleanly', () => {
  const {
    TARGET_HIGHLIGHT_DURATION_MS,
    buildManagerOrderTargetRoute,
    resolveNotificationNavigationTarget,
    resolveManagerOrderTarget,
  } = require('../../../services/managerOrderTargetNavigation');
  const requestPageSource = readFileSync(resolve(root, 'app/manager/request.jsx'), 'utf8');

  assert.equal(TARGET_HIGHLIGHT_DURATION_MS, 2800);
  assert.deepEqual(buildManagerOrderTargetRoute({ id: 'ord-99', requestId: 'BT-2026-000099' }), {
    pathname: '/manager/request',
    params: { orderId: 'ord-99' },
  });

  // Notification target resolution
  assert.deepEqual(
    resolveNotificationNavigationTarget({ id: 'evt-1', orderId: 'ord-10', navigable: true }),
    {
      type: 'order',
      eventId: 'evt-1',
      orderId: 'ord-10',
      target: { pathname: '/manager/request', params: { orderId: 'ord-10' } },
    }
  );
  assert.deepEqual(
    resolveNotificationNavigationTarget({ id: 'evt-app', orderId: '', path: '/manager/distributors', navigable: true }),
    {
      type: 'route',
      eventId: 'evt-app',
      orderId: '',
      target: '/manager/distributors',
    }
  );
  assert.deepEqual(
    resolveNotificationNavigationTarget({ id: 'evt-modal', orderId: 'ord-10', navigable: false }),
    {
      type: 'modal',
      eventId: 'evt-modal',
      orderId: '',
      target: null,
    }
  );

  const requests = [
    order('ord-review', 'pending', { requestId: 'BT-REV-1', outsideServiceArea: false }),
    order('ord-exception', 'outside_radius_pending_approval', { requestId: 'BT-EXC-1', outsideServiceArea: true }),
    order('ord-awaiting', 'awaiting_distributor_assignment', { requestId: 'BT-AWAIT-1' }),
    order('ord-ongoing', 'out_for_delivery', { requestId: 'BT-ONG-1', assignedDistributorUid: 'dist-1' }),
    order('ord-completed', 'delivered', { requestId: 'BT-DONE-1', assignedDistributorUid: 'dist-1' }),
    order('ord-other-branch', 'pending', { currentBranchId: 'south', branchId: 'south', requestId: 'BT-SOUTH-1' }),
  ];
  const incomingTransfers = [
    {
      id: 'ord-transfer',
      requestId: 'BT-XFER-1',
      status: 'branch_transfer_pending',
      transferToBranchId: 'north',
    },
  ];
  const sourceDecisionEvents = [
    {
      id: 'dec-1',
      orderId: 'ord-decided',
      requestId: 'BT-DEC-1',
      sourceBranchId: 'north',
      decision: 'accepted',
    },
  ];

  // 1. Pending normal review order -> ReceivedRequestsQueue ('review')
  const resReview = resolveManagerOrderTarget('ord-review', { requests, incomingTransfers, sourceDecisionEvents, branchId: 'north' });
  assert.equal(resReview.status, 'resolved');
  assert.equal(resReview.section, 'review');

  // 2. Exception approval order matched by public requestId -> OutsideRadiusApprovalQueue ('exceptions')
  const resException = resolveManagerOrderTarget('BT-EXC-1', { requests, incomingTransfers, sourceDecisionEvents, branchId: 'north' });
  assert.equal(resException.status, 'resolved');
  assert.equal(resException.canonicalOrderId, 'ord-exception');
  assert.equal(resException.section, 'exceptions');

  // 3. Awaiting distributor assignment -> BranchOrdersOverview ('branchOrders', 'pending' tab)
  const resAwaiting = resolveManagerOrderTarget('ord-awaiting', { requests, incomingTransfers, sourceDecisionEvents, branchId: 'north' });
  assert.equal(resAwaiting.section, 'branchOrders');
  assert.equal(resAwaiting.ordersTab, 'pending');

  // 4. Ongoing assigned order -> BranchOrdersOverview ('branchOrders', 'ongoing' tab)
  const resOngoing = resolveManagerOrderTarget('ord-ongoing', { requests, incomingTransfers, sourceDecisionEvents, branchId: 'north' });
  assert.equal(resOngoing.section, 'branchOrders');
  assert.equal(resOngoing.ordersTab, 'ongoing');

  // 5. Completed order (notification opened after order moved to delivered) -> BranchOrdersOverview ('branchOrders', 'completed' tab)
  const resCompleted = resolveManagerOrderTarget('ord-completed', { requests, incomingTransfers, sourceDecisionEvents, branchId: 'north' });
  assert.equal(resCompleted.section, 'branchOrders');
  assert.equal(resCompleted.ordersTab, 'completed');

  // 6. Incoming transfer -> BranchTransfersQueue ('transfers')
  const resTransfer = resolveManagerOrderTarget('ord-transfer', { requests, incomingTransfers, sourceDecisionEvents, branchId: 'north' });
  assert.equal(resTransfer.section, 'transfers');
  assert.equal(resTransfer.revealDecisions, false);

  // 7. Outbound transfer decision event -> BranchTransfersQueue ('transfers', revealDecisions: true)
  const resDecision = resolveManagerOrderTarget('ord-decided', { requests, incomingTransfers, sourceDecisionEvents, branchId: 'north' });
  assert.equal(resDecision.status, 'resolved_decision');
  assert.equal(resDecision.section, 'transfers');
  assert.equal(resDecision.revealDecisions, true);

  // 8. While still loading, missing order returns 'loading' instead of premature unavailable error
  const resLoading = resolveManagerOrderTarget('ord-missing', { requests, incomingTransfers, sourceDecisionEvents, branchId: 'north', loading: true });
  assert.equal(resLoading.status, 'loading');

  // 9. After loading finishes, missing or cross-branch order returns 'unavailable' with clean message
  const resMissing = resolveManagerOrderTarget('ord-missing', { requests, incomingTransfers, sourceDecisionEvents, branchId: 'north', loading: false });
  assert.equal(resMissing.status, 'unavailable');
  assert.equal(resMissing.fallbackMessage, 'Order ord-missing could not be found in this branch or is no longer available.');

  const resOtherBranch = resolveManagerOrderTarget('ord-other-branch', { requests, incomingTransfers, sourceDecisionEvents, branchId: 'north', loading: false });
  assert.equal(resOtherBranch.status, 'unavailable');

  // 10. Request page highlights matched card in place and does not stretch notificationTargetButton with actionButton flexBasis
  assert.match(requestPageSource, /orderItemTargetHighlighted/);
  assert.match(requestPageSource, /targetOrderBadge/);
  assert.match(requestPageSource, /targetResolution\.status === 'unavailable'/);
  assert.doesNotMatch(requestPageSource, /style=\{\[styles\.actionButton, styles\.notificationTargetButton\]\}/);
});

test('Branch Reviews summary counts only pending branch applications and actionable branch safety reports without fabricating counts', () => {
  const applicants = [
    { uid: 'app-1', role: 'distributor', distributorStatus: 'pending', requestedBranchId: 'north', fullName: 'Juan Dela Cruz' },
    { uid: 'app-1', role: 'distributor', distributorStatus: 'pending', requestedBranchId: 'north', fullName: 'Juan Dela Cruz' },
    { uid: 'app-2', role: 'distributor', distributorStatus: 'pending', requestedBranchId: 'north', fullName: 'Maria Santos' },
    // Registered active distributor must NOT be counted as pending application
    { uid: 'dist-active', role: 'distributor', distributorStatus: 'active', branchId: 'north', fullName: 'Active Driver' },
    // Cross-branch applicant must NOT be counted
    { uid: 'app-south', role: 'distributor', distributorStatus: 'pending', requestedBranchId: 'south', fullName: 'South Applicant' },
    // Requester must NOT be counted
    { uid: 'req-1', role: 'requester', status: 'pending', branchId: 'north', fullName: 'Requester User' },
  ];

  const moderationCases = [
    { id: 'rep-1', branchId: 'north', status: 'active' },
    { id: 'rep-1', branchId: 'north', status: 'active' },
    { id: 'rep-2', branchId: 'north', status: 'open' },
    // Resolved or dismissed cases excluded
    { id: 'rep-resolved', branchId: 'north', status: 'resolved' },
    { id: 'rep-dismissed', branchId: 'north', status: 'dismissed' },
    // Cross-branch or admin-only cases excluded
    { id: 'rep-south', branchId: 'south', status: 'active' },
    { id: 'rep-admin', branchId: 'north', status: 'active', scope: 'admin_only' },
  ];

  const activeSummary = buildBranchReviewsSummary({
    branchId: 'north',
    pendingApplications: applicants,
    applicationsLoading: false,
    applicationsError: null,
    moderationCases,
    moderationLoading: false,
    moderationError: null,
  });

  assert.equal(activeSummary.distributorApplications.ready, true);
  assert.equal(activeSummary.distributorApplications.count, 2);
  assert.equal(activeSummary.distributorApplications.badgeLabel, '2 Pending');
  assert.equal(activeSummary.distributorApplications.actionLabel, 'Review');
  assert.equal(activeSummary.distributorApplications.targetPath, '/manager/distributors');
  assert.match(activeSummary.distributorApplications.description, /Juan Dela Cruz, Maria Santos/);

  assert.equal(activeSummary.reportsAndSafety.ready, true);
  assert.equal(activeSummary.reportsAndSafety.count, 2);
  assert.equal(activeSummary.reportsAndSafety.toneKey, 'danger');
  assert.equal(activeSummary.reportsAndSafety.badgeLabel, '2 Active');
  assert.equal(activeSummary.reportsAndSafety.actionLabel, 'Review Reports');
  assert.equal(activeSummary.reportsAndSafety.targetPath, '/manager/reports-safety');
  assert.equal(activeSummary.allClear, false);
  assert.equal(activeSummary.totalActionableCount, 4);

  // Clear state when both categories are ready with 0 items
  const clearSummary = buildBranchReviewsSummary({
    branchId: 'north',
    pendingApplications: [],
    applicationsLoading: false,
    applicationsError: null,
    moderationCases: [],
    moderationLoading: false,
    moderationError: null,
  });
  assert.equal(clearSummary.distributorApplications.count, 0);
  assert.equal(clearSummary.distributorApplications.badgeLabel, 'Clear');
  assert.equal(clearSummary.reportsAndSafety.count, 0);
  assert.equal(clearSummary.reportsAndSafety.badgeLabel, 'Clear');
  assert.equal(clearSummary.allClear, true);

  // Loading or error state never fabricates 0 count
  const unavailableSummary = buildBranchReviewsSummary({
    branchId: 'north',
    pendingApplications: [],
    applicationsLoading: true,
    applicationsError: null,
    moderationCases: null,
    moderationLoading: false,
    moderationError: new Error('Unavailable'),
  });
  assert.equal(unavailableSummary.distributorApplications.ready, false);
  assert.equal(unavailableSummary.distributorApplications.count, null);
  assert.equal(unavailableSummary.distributorApplications.badgeLabel, 'Loading');
  assert.equal(unavailableSummary.reportsAndSafety.ready, false);
  assert.equal(unavailableSummary.reportsAndSafety.count, null);
  assert.equal(unavailableSummary.reportsAndSafety.badgeLabel, 'Unavailable');
  assert.equal(unavailableSummary.allClear, false);
});

test('Product Delivery Rules preview formats up to 3 branch products, honors effectivePolicy, and flags unconfigured delivery days', () => {
  const products = [
    {
      id: 'prod-inactive',
      product_name: 'Alkaline Jug',
      price: 45,
      active: false,
      branchIds: ['north'],
      effectivePolicy: {
        configuredDeliveryDays: ['Tue', 'Thu'],
        deliveryDays: ['Tue', 'Thu'],
        maxQuantityPerRequester: 5,
        source: 'branch_override',
      },
    },
    {
      id: 'prod-1',
      product_name: 'BlueTap Purified 5-Gallon Slim',
      price: 35,
      active: true,
      imageUrl: 'https://example.com/slim.png',
      containerType: 'Slim Container',
      size: '5 Gallons',
      branchIds: ['north'],
      effectivePolicy: {
        configuredDeliveryDays: ['Mon', 'Wed', 'Fri'],
        deliveryDays: ['Mon', 'Wed', 'Fri'],
        maxQuantityPerRequester: 10,
        source: 'branch_override',
      },
    },
    {
      id: 'prod-1',
      product_name: 'Duplicate Product Ignored',
      price: 99,
      active: true,
      branchIds: ['north'],
    },
    {
      id: 'prod-2',
      product_name: 'Mineral Round Jug',
      price: 40,
      active: true,
      branchIds: ['north'],
      // Unconfigured delivery days (configuredDeliveryDays is empty even though ordering fallback has 7 days)
      effectivePolicy: {
        configuredDeliveryDays: [],
        deliveryDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        maxQuantityPerRequester: null,
        source: 'admin_default',
      },
    },
    {
      id: 'prod-3',
      product_name: 'Daily Refill Pack',
      price: 30,
      active: true,
      branchIds: ['north'],
      effectivePolicy: {
        configuredDeliveryDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        deliveryDays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        maxQuantityPerRequester: 12,
        source: 'admin_default',
      },
    },
    {
      id: 'prod-south',
      product_name: 'South Branch Exclusive',
      price: 50,
      active: true,
      branchIds: ['south'],
    },
  ];

  const preview = buildProductDeliveryRulesPreview(products, 'north', 3);
  assert.equal(preview.length, 3);
  // Active products sorted alphabetically first: BlueTap Purified..., Daily Refill Pack, Mineral Round Jug
  assert.deepEqual(
    preview.map((item) => item.id),
    ['prod-1', 'prod-3', 'prod-2']
  );

  // prod-1: configured weekdays + limit + image
  assert.equal(preview[0].name, 'BlueTap Purified 5-Gallon Slim');
  assert.equal(preview[0].priceLabel, '₱35.00');
  assert.equal(preview[0].imageUrl, 'https://example.com/slim.png');
  assert.equal(preview[0].hasDeliveryDaysConfigured, true);
  assert.equal(preview[0].deliveryDaysLabel, 'Mon, Wed, Fri');
  assert.equal(preview[0].hasLimitConfigured, true);
  assert.equal(preview[0].limitLabel, 'Max 10 per request');
  assert.equal(preview[0].statusLabel, 'Active');
  assert.equal(preview[0].targetPath, '/manager/products');

  // prod-3: all 7 days configured
  assert.equal(preview[1].hasDeliveryDaysConfigured, true);
  assert.equal(preview[1].deliveryDaysLabel, 'Every day (Mon–Sun)');
  assert.equal(preview[1].limitLabel, 'Max 12 per request');

  // prod-2: missing configuration state when configuredDeliveryDays is empty
  assert.equal(preview[2].hasDeliveryDaysConfigured, false);
  assert.equal(preview[2].deliveryDaysLabel, 'Delivery days not configured');
  assert.equal(preview[2].hasLimitConfigured, false);
  assert.equal(preview[2].limitLabel, 'No requester limit');

  // Without branchId, returns empty array to prevent cross-branch leakage
  assert.deepEqual(buildProductDeliveryRulesPreview(products, '', 3), []);
});

test('Manager Dashboard places Branch Reviews and Product Delivery Rules in Row 5 after Sales Overview', () => {
  const salesIndex = page.indexOf('Sales Overview');
  const branchReviewsIndex = page.indexOf('Branch Reviews');
  const productRulesIndex = page.indexOf('Product Delivery Rules');
  assert.ok(salesIndex > 0, 'Sales Overview must exist on Manager Dashboard');
  assert.ok(branchReviewsIndex > salesIndex, 'Branch Reviews must be placed AFTER Sales Overview');
  assert.ok(productRulesIndex > branchReviewsIndex, 'Product Delivery Rules must be placed alongside Branch Reviews in the lower row');

  assert.match(page, /sectionIndex=\{5\}/);
  assert.match(page, /Applications and safety matters/);
  assert.match(page, /Branch catalog and delivery availability/);
  assert.match(page, /reviewsPanel:\s*\{[^}]*flexGrow:\s*41,\s*flexShrink:\s*1,\s*flexBasis:\s*0,\s*alignSelf:\s*'stretch'/);
  assert.match(page, /productRulesPanel:\s*\{[^}]*flexGrow:\s*59,\s*flexShrink:\s*1,\s*flexBasis:\s*0,\s*alignSelf:\s*'stretch'/);
  assert.match(page, /'\/manager\/reports-safety'/);
  assert.match(page, /'\/manager\/products'/);
});
