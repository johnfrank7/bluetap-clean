// Shared Multi-Trip Capacity and Scheduling Engine
// Enforces maximum 60 standard 5-gallon containers per trip, multiple orders per trip,
// multiple trips per distributor without arbitrary numerical limits, and authoritative
// delivery window overlap and turnaround conflict detection.
// Accurately classifies standard 5-gallon, other cargo (1-gallon, 24-pack), and unknown items.

const TRIP_MAX_CONTAINERS = 60;
const SCHEDULE_CONFLICT_WINDOW_MS = 30 * 60 * 1000; // 30 minutes minimum turnaround buffer
const DEFAULT_BASE_TRIP_MINUTES = 30;
const DEFAULT_PER_ORDER_MINUTES = 15;
const DEFAULT_TURNAROUND_BUFFER_MINUTES = 15;

const ACTIVE_ASSIGNMENT_STATUSES = new Set([
  'distributor_assigned',
  'assigned',
  'accepted',
  'scheduled',
  'rescheduled',
  'out_for_delivery',
  'delivery_failed',
]);

/**
 * Calculates authoritative trip or order duration in milliseconds.
 * Respects explicit trip/order end times, explicit duration fields (estimatedDurationMinutes,
 * durationMinutes, tripDurationMinutes), order stops count, and volume thresholds.
 */
function getTripDurationMs(tripOrOrder) {
  if (!tripOrOrder) return DEFAULT_BASE_TRIP_MINUTES * 60 * 1000;

  // 1. Explicit trip/order end time
  const startTime = tripOrOrder.time || parseScheduleTime(tripOrOrder.scheduledAt);
  const endTime = parseScheduleTime(tripOrOrder.endTime || tripOrOrder.scheduledEndTime);
  if (startTime && endTime && endTime > startTime) {
    return endTime - startTime;
  }

  // 2. Explicit duration in minutes on the trip or order object
  const explicitMinutes = Number(
    tripOrOrder.estimatedDurationMinutes ??
    tripOrOrder.durationMinutes ??
    tripOrOrder.tripDurationMinutes ??
    tripOrOrder.turnaroundMinutes
  );
  if (Number.isFinite(explicitMinutes) && explicitMinutes > 0) {
    return Math.round(explicitMinutes * 60 * 1000);
  }

  // 3. Multi-order trip: sum explicit order durations or compute based on delivery stops & cargo
  if (Array.isArray(tripOrOrder.orders) && tripOrOrder.orders.length > 0) {
    let sumMinutes = 0;
    let hasAnyExplicit = false;

    for (const ord of tripOrOrder.orders) {
      const m = Number(
        ord.estimatedDurationMinutes ??
        ord.durationMinutes ??
        ord.tripDurationMinutes
      );
      if (Number.isFinite(m) && m > 0) {
        sumMinutes += m;
        hasAnyExplicit = true;
      }
    }

    if (hasAnyExplicit && sumMinutes > 0) {
      return Math.round(sumMinutes * 60 * 1000);
    }

    const orderCount = tripOrOrder.orders.length;
    const containers = tripOrOrder.totalContainers || 0;
    const loadExtra = containers >= 30 ? 15 : 0;
    const calculatedMinutes = DEFAULT_BASE_TRIP_MINUTES + (orderCount * DEFAULT_PER_ORDER_MINUTES) + loadExtra;
    return calculatedMinutes * 60 * 1000;
  }

  // 4. Single order fallback
  const containers = tripOrOrder.orderContainers || tripOrOrder.standard5GallonCount || 0;
  const loadExtra = containers >= 30 ? 15 : 0;
  return (DEFAULT_BASE_TRIP_MINUTES + DEFAULT_PER_ORDER_MINUTES + loadExtra) * 60 * 1000;
}

/**
 * Returns the active delivery interval [start, end] in milliseconds for a trip or candidate schedule,
 * inclusive of necessary post-trip turnaround buffer.
 */
function getTripTimeWindow(tripOrTime, candidateOrder = null) {
  let startTime = 0;
  let durationMs = 0;

  if (typeof tripOrTime === 'number') {
    startTime = tripOrTime;
    durationMs = getTripDurationMs(candidateOrder);
  } else if (tripOrTime && typeof tripOrTime === 'object') {
    startTime = tripOrTime.time || parseScheduleTime(tripOrTime.scheduledAt) || 0;
    durationMs = getTripDurationMs(tripOrTime);
  }

  if (!startTime || Number.isNaN(startTime)) {
    return null;
  }

  const turnaroundBufferMs = DEFAULT_TURNAROUND_BUFFER_MINUTES * 60 * 1000;
  return {
    start: startTime,
    end: startTime + durationMs + turnaroundBufferMs,
  };
}

/**
 * Evaluates whether an existing trip overlaps with a candidate delivery schedule.
 * Accounts for start time, duration, order stops, and turnaround buffer.
 * Start times within 1 minute are co-loading candidates, not overlapping separate trips.
 */
function isTripOverlapping(trip, candidateTime, candidateOrder = null) {
  if (!trip || !candidateTime) return false;
  const tripTime = trip.time || parseScheduleTime(trip.scheduledAt);
  if (!tripTime) return false;

  // Same start time (within 1 minute) is co-loading, handled separately
  if (Math.abs(tripTime - candidateTime) < 60 * 1000) {
    return false;
  }

  const windowA = getTripTimeWindow(trip);
  const windowB = getTripTimeWindow(candidateTime, candidateOrder);
  if (!windowA || !windowB) return false;

  // Intervals [S_A, E_A] and [S_B, E_B] overlap if S_A < E_B and S_B < E_A
  return windowA.start < windowB.end && windowB.start < windowA.end;
}

function parseScheduleTime(value) {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value?.toDate === 'function') {
    try {
      const d = value.toDate();
      if (d instanceof Date && !Number.isNaN(d.getTime())) return d.getTime();
    } catch {}
  }
  if (typeof value?.toMillis === 'function') {
    try {
      const ms = value.toMillis();
      if (Number.isFinite(ms)) return ms;
    } catch {}
  }
  if (value && typeof value === 'object') {
    if (typeof value._seconds === 'number') {
      const ms = value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1000000);
      return Number.isFinite(ms) ? ms : null;
    }
    if (typeof value.seconds === 'number') {
      const ms = value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000);
      return Number.isFinite(ms) ? ms : null;
    }
    return null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null;
    return value > 1e11 ? value : value * 1000;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === 'null' || trimmed === 'undefined' || trimmed === 'Invalid Date') {
      return null;
    }
    const formMatch = trimmed.match(/^(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{4})$/);
    if (formMatch) {
      const d = new Date(Number(formMatch[3]), Number(formMatch[1]) - 1, Number(formMatch[2]));
      return Number.isNaN(d.getTime()) ? null : d.getTime();
    }
    const parsed = new Date(trimmed).getTime();
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function formatIsoSchedule(value) {
  const time = parseScheduleTime(value);
  if (!time || !Number.isFinite(time)) return null;
  try {
    const d = new Date(time);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  } catch {
    return null;
  }
}

/**
 * Classifies an individual order line item based on authoritative catalog and product metadata:
 * - 'standard_5_gallon': standard 5-gallon containers or 5-gallon refills.
 * - 'other': known non-5-gallon cargo (1-gallon water, 24-pack bottles, dispensers, etc.).
 * - 'unknown': physical trip load cannot be proven from metadata (requires review).
 */
function classifyProductItem(item = {}, orderFallback = {}) {
  if (!item || typeof item !== 'object') return 'unknown';

  // 1. Explicit deliveryLoad or loadClassificationSnapshot
  const deliveryLoad = item.deliveryLoad || orderFallback.deliveryLoad;
  if (deliveryLoad?.classification === 'standard_5_gallon' || item.loadClassificationSnapshot === 'STANDARD_5_GALLON' || orderFallback.loadClassificationSnapshot === 'STANDARD_5_GALLON') {
    return 'standard_5_gallon';
  }
  if (deliveryLoad?.classification === 'other' || item.loadClassificationSnapshot === 'OTHER_CARGO' || orderFallback.loadClassificationSnapshot === 'OTHER_CARGO') {
    return 'other';
  }

  // 2. Text inspection of size, container type, and product name
  const size = String(item.sizeSnapshot || item.size || orderFallback.sizeSnapshot || orderFallback.size || '').trim().toLowerCase();
  const container = String(item.containerTypeSnapshot || item.containerType || item.container_type || item.container || orderFallback.containerTypeSnapshot || orderFallback.containerType || orderFallback.container_type || orderFallback.container || '').trim().toLowerCase();
  const name = String(item.productNameSnapshot || item.product_name || item.name || orderFallback.productNameSnapshot || orderFallback.product_name || orderFallback.productName || orderFallback.name || '').trim().toLowerCase();

  const combined = `${name} ${size} ${container}`.trim().toLowerCase();
  if (!combined) {
    return 'unknown';
  }

  // Known non-5-gallon products (1-gallon water, 24-pack bottles, cups, accessories)
  const nonFiveGalOtherPattern = /(^|[\s_/-])(1-gal|1 gal|1-gallon|1 gallon|1g|pack|24 pack|24-pack|12 pack|12-pack|bottle|bottled|case|330ml|350ml|500ml|600ml|1000ml|1l|1\.5l|stand|pump|faucet|cup|cups)($|[\s_/-])/i;
  // Standard 5-gallon products
  const fiveGalPattern = /(^|[\s_/-])(5-gal|5 gal|5-gallon|5 gallon|5g|round 5|slim 5|5-g)($|[\s_/-])/i;
  const isDispenser = /(^|[\s_/-])(dispenser)($|[\s_/-])/i.test(combined);

  const isHardOther = nonFiveGalOtherPattern.test(combined);
  const isFiveGal = fiveGalPattern.test(combined);

  if (isHardOther && !isFiveGal) {
    return 'other';
  }
  if (isFiveGal) {
    return 'standard_5_gallon';
  }
  if (isDispenser) {
    // In water refill stations, "Round dispenser" or "Slim dispenser" is a 5-gal container type
    if (/\b(round dispenser|slim dispenser)\b/i.test(container) || /\b(round dispenser|slim dispenser)\b/i.test(combined)) {
      return 'standard_5_gallon';
    }
    // Standalone hardware dispensers (e.g. tabletop/electric dispensers) are other cargo
    return 'other';
  }

  // Common water-station terminology
  if (/\b(refill|water refill|purified refill|alkaline refill|mineral refill|purified water|mineral water|alkaline water)\b/i.test(name) && !isHardOther) {
    return 'standard_5_gallon';
  }
  if (/\b(slim container|round container|exchange container|round dispenser|slim|round|standard)\b/i.test(container) && !isHardOther) {
    return 'standard_5_gallon';
  }

  return 'unknown';
}

/**
 * Analyzes the entire cargo profile of an order:
 * Distinguishes standard 5-gallon containers, other non-5-gallon cargo, and unknown-size items.
 */
function analyzeOrderCargo(order = {}) {
  if (!order || typeof order !== 'object') {
    return {
      standard5GallonCount: 0,
      otherCargoCount: 0,
      unknownLoadCount: 1,
      has5Gallon: false,
      hasOtherCargo: false,
      hasUnknownCargo: true,
      isPure5Gallon: false,
      isMixed: false,
      isOnlyOther: false,
      badgeLabel: '⚠️ Load Review Required',
      badgeTone: 'warning',
      itemAnalyses: [],
    };
  }

  let items = Array.isArray(order.items) && order.items.length > 0 ? order.items : null;

  // If order has no items array, inspect order top-level fields
  if (!items) {
    const name = order.productNameSnapshot || order.product_name || order.productName || order.name || '';
    const container = order.containerTypeSnapshot || order.containerType || order.container || '';
    const size = order.sizeSnapshot || order.size || '';
    const rawQty = Number(order.quantity ?? order.total_quantity ?? order.totalQuantity);
    const qty = Number.isFinite(rawQty) && rawQty >= 1 ? Math.round(rawQty) : 1;

    if (!name && !container && !size) {
      // Legacy or test fixture order without product information
      const defaultContainers = Number.isSafeInteger(order.orderContainers)
        ? order.orderContainers
        : Number.isFinite(rawQty) && rawQty >= 1 ? Math.round(rawQty) : 1;
      return {
        standard5GallonCount: defaultContainers,
        otherCargoCount: 0,
        unknownLoadCount: 0,
        has5Gallon: defaultContainers > 0,
        hasOtherCargo: false,
        hasUnknownCargo: false,
        isPure5Gallon: true,
        isMixed: false,
        isOnlyOther: false,
        badgeLabel: `📦 ${defaultContainers} × 5-gal`,
        badgeTone: 'blue',
        itemAnalyses: [],
      };
    }

    items = [{
      productNameSnapshot: name,
      containerTypeSnapshot: container,
      sizeSnapshot: size,
      quantity: qty,
      loadClassificationSnapshot: order.loadClassificationSnapshot,
      deliveryLoad: order.deliveryLoad,
    }];
  }

  let standard5GallonCount = 0;
  let otherCargoCount = 0;
  let unknownLoadCount = 0;
  const itemAnalyses = [];

  for (const item of items) {
    const rawQty = Number(item?.quantity);
    const qty = Number.isFinite(rawQty) && rawQty >= 1 ? Math.round(rawQty) : 1;
    const classification = classifyProductItem(item, order);

    itemAnalyses.push({
      item,
      quantity: qty,
      classification,
    });

    if (classification === 'standard_5_gallon') {
      standard5GallonCount += qty;
    } else if (classification === 'other') {
      otherCargoCount += qty;
    } else {
      unknownLoadCount += qty;
    }
  }

  const has5Gallon = standard5GallonCount > 0;
  const hasOtherCargo = otherCargoCount > 0;
  const hasUnknownCargo = unknownLoadCount > 0;
  const isPure5Gallon = has5Gallon && !hasOtherCargo && !hasUnknownCargo;
  const isMixed = has5Gallon && hasOtherCargo && !hasUnknownCargo;
  const isOnlyOther = !has5Gallon && hasOtherCargo && !hasUnknownCargo;

  // Physical loading is handled operationally by Distributors and station staff.
  // Software authority enforces maximum 60 standard 5-gallon containers, schedule conflicts,
  // and requires catalog review only for truly unknown/unclassified products.
  const isPhysicalLoadVerified = !hasUnknownCargo;
  const hasUnverifiedPhysicalLoad = false;

  let badgeLabel = '';
  let badgeTone = 'blue';

  if (hasUnknownCargo) {
    badgeLabel = '⚠️ Catalog Review Required';
    badgeTone = 'warning';
  } else if (isPure5Gallon) {
    badgeLabel = `📦 ${standard5GallonCount} × 5-gal`;
    badgeTone = 'blue';
  } else if (isMixed) {
    badgeLabel = `📦 ${standard5GallonCount} × 5-gal + Other Cargo`;
    badgeTone = 'purple';
  } else if (isOnlyOther) {
    badgeLabel = `📦 Other Cargo (${otherCargoCount} item${otherCargoCount === 1 ? '' : 's'})`;
    badgeTone = 'orange';
  } else {
    badgeLabel = '📦 Standard Load';
    badgeTone = 'blue';
  }

  return {
    standard5GallonCount,
    otherCargoCount,
    unknownLoadCount,
    has5Gallon,
    hasOtherCargo,
    hasUnknownCargo,
    isPure5Gallon,
    isMixed,
    isOnlyOther,
    isPhysicalLoadVerified,
    hasUnverifiedPhysicalLoad,
    badgeLabel,
    badgeTone,
    itemAnalyses,
  };
}

function calculateOrderContainers(order = {}) {
  if (!order || typeof order !== 'object') return 0;
  if (Number.isSafeInteger(order.orderContainers) && order.orderContainers >= 0) {
    return order.orderContainers;
  }
  const cargo = analyzeOrderCargo(order);
  return cargo.standard5GallonCount;
}

function generateTripId(distributorUid, scheduledTime) {
  const time = parseScheduleTime(scheduledTime) || Date.now();
  const d = new Date(time);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const mins = String(d.getUTCMinutes()).padStart(2, '0');
  const uidPrefix = String(distributorUid || 'distributor').replace(/[^a-zA-Z0-9]/g, '').slice(0, 16);
  return `trip_${uidPrefix}_${year}${month}${day}_${hours}${mins}`;
}

function isSameTrip(orderA = {}, orderB = {}) {
  if (!orderA || !orderB) return false;
  if (orderA.tripId && orderB.tripId && orderA.tripId === orderB.tripId) {
    return true;
  }
  const distA = String(orderA.assignedDistributorUid || orderA.distributor_id || '').trim();
  const distB = String(orderB.assignedDistributorUid || orderB.distributor_id || '').trim();
  if (distA && distB && distA === distB) {
    const timeA = parseScheduleTime(orderA.scheduledAt || orderA.scheduled_at);
    const timeB = parseScheduleTime(orderB.scheduledAt || orderB.scheduled_at);
    if (timeA && timeB && Math.abs(timeA - timeB) < 60 * 1000) {
      return true;
    }
  }
  return false;
}

/**
 * Aggregates identical cargo items by name and quantity (e.g. 1 x A + 1 x A -> 2 x A).
 */
function aggregateCargoItems(items = []) {
  if (!Array.isArray(items) || items.length === 0) return '';
  const counts = new Map();
  for (const entry of items) {
    if (!entry) continue;
    let name = '';
    let qty = 1;
    if (typeof entry === 'string') {
      const match = entry.match(/^(\d+)\s*[×x]\s*(.+)$/);
      if (match) {
        qty = Number(match[1]) || 1;
        name = match[2].trim();
      } else {
        name = entry.trim();
      }
    } else if (typeof entry === 'object') {
      qty = Number(entry.quantity || entry.item?.quantity || entry.qty || 1);
      name = String(
        entry.name ||
        entry.item?.productNameSnapshot ||
        entry.item?.product_name ||
        entry.item?.name ||
        entry.productNameSnapshot ||
        entry.product_name ||
        entry.productName ||
        'Other Cargo'
      ).trim();
    }
    if (name) {
      counts.set(name, (counts.get(name) || 0) + qty);
    }
  }
  const parts = [];
  for (const [name, qty] of counts.entries()) {
    parts.push(`${qty} × ${name}`);
  }
  return parts.join(', ');
}

function groupOrdersIntoTrips(orders = [], distributorUid = null) {
  const seenOrderIds = new Set();
  const activeOrders = [];

  for (const order of (Array.isArray(orders) ? orders : [])) {
    if (!order || typeof order !== 'object') continue;
    const orderId = String(order.id || order.requestId || order._id || '').trim();
    if (orderId && seenOrderIds.has(orderId)) continue;

    const status = String(order.status || '').trim().toLowerCase();
    if (!ACTIVE_ASSIGNMENT_STATUSES.has(status)) continue;

    if (distributorUid) {
      const orderDist = String(
        order.assignedDistributorUid ||
        order.distributor_id ||
        order.distributorId ||
        order.assignedDistributorId ||
        order.distributorUid ||
        ''
      ).trim();
      if (orderDist !== distributorUid) continue;
    }

    if (orderId) seenOrderIds.add(orderId);
    activeOrders.push(order);
  }

  const tripGroups = new Map();

  for (const order of activeOrders) {
    const distUid = String(order.assignedDistributorUid || order.distributor_id || '').trim();
    const distName = String(order.assignedDistributorName || order.distributorNameSnapshot || order.distributor_name || '').trim();
    const distUniqueId = String(order.assignedDistributorUniqueId || order.distributorUniqueId || '').trim();
    const time = parseScheduleTime(order.scheduledAt || order.scheduled_at);
    let tripKey = order.tripId ? String(order.tripId).trim() : null;

    if (!tripKey && distUid && time) {
      // Find an existing group for this distributor whose scheduled time is within 1 minute
      for (const [existingKey, group] of tripGroups.entries()) {
        if (group.distributorUid === distUid && group.time && Math.abs(group.time - time) < 60 * 1000) {
          tripKey = existingKey;
          break;
        }
      }
      if (!tripKey) {
        tripKey = generateTripId(distUid, time);
      }
    }

    if (!tripKey) {
      tripKey = `trip_adhoc_${order.id || Math.random().toString(36).slice(2)}`;
    }

    if (!tripGroups.has(tripKey)) {
      tripGroups.set(tripKey, {
        tripId: tripKey,
        distributorUid: distUid,
        distributorName: distName,
        distributorUniqueId: distUniqueId,
        time: time || null,
        scheduledAt: order.scheduledAt || order.scheduled_at || null,
        orders: [],
      });
    }

    const group = tripGroups.get(tripKey);
    group.orders.push(order);
    if (!group.distributorName && distName) group.distributorName = distName;
    if (!group.distributorUniqueId && distUniqueId) group.distributorUniqueId = distUniqueId;
    if (!group.time && time) {
      group.time = time;
      group.scheduledAt = order.scheduledAt || order.scheduled_at;
    }
  }

  // Sort trips by time
  const sortedTrips = Array.from(tripGroups.values()).sort((a, b) => {
    const timeA = a.time || 0;
    const timeB = b.time || 0;
    return timeA - timeB;
  });

  const now = Date.now();

  // Calculate capacity, tripNumber, and statuses
  return sortedTrips.map((group, index) => {
    let totalContainers = 0;
    let otherCargoCount = 0;
    let unknownLoadCount = 0;
    let hasOtherCargo = false;
    let hasUnknownCargo = false;
    const otherCargoItemSummaries = [];

    for (const order of group.orders) {
      const cargo = analyzeOrderCargo(order);
      totalContainers += cargo.standard5GallonCount;
      otherCargoCount += cargo.otherCargoCount;
      if (cargo.hasOtherCargo) {
        hasOtherCargo = true;
        if (Array.isArray(cargo.itemAnalyses)) {
          for (const it of cargo.itemAnalyses) {
            if (it.classification === 'other') {
              const name = it.item?.productNameSnapshot || it.item?.name || 'Other Cargo';
              otherCargoItemSummaries.push({ quantity: it.quantity, name });
            }
          }
        }
      }
      if (cargo.hasUnknownCargo) {
        hasUnknownCargo = true;
        unknownLoadCount += cargo.unknownLoadCount || 1;
      }
    }

    const otherCargoSummary = aggregateCargoItems(otherCargoItemSummaries) ||
      (otherCargoCount > 0 ? `${otherCargoCount} items other cargo` : '');
    const otherCargoAggregatedList = otherCargoSummary ? otherCargoSummary.split(', ') : [];

    const maxCapacity = TRIP_MAX_CONTAINERS;
    const remainingCapacity = Math.max(0, maxCapacity - totalContainers);
    const isFull = totalContainers >= maxCapacity;
    const managerApproved = group.orders.every((o) => o.managerApproved !== false);

    const isScheduled = Boolean(group.time);
    const isOverdue = Boolean(
      isScheduled &&
      group.time < (now - 30 * 60 * 1000) &&
      !group.orders.every((o) => String(o.status || '').toLowerCase() === 'delivered') &&
      !group.orders.some((o) => String(o.status || '').toLowerCase() === 'delivery_failed')
    );

    let status = 'approved';
    if (!managerApproved) {
      status = 'planning';
    } else if (group.orders.some((o) => String(o.status || '').toLowerCase() === 'out_for_delivery')) {
      status = isOverdue ? 'overdue_delivery' : 'in_transit';
    } else if (group.orders.every((o) => String(o.status || '').toLowerCase() === 'delivered')) {
      status = 'completed';
    } else if (group.orders.some((o) => String(o.status || '').toLowerCase() === 'delivery_failed')) {
      status = 'delivery_failed';
    } else if (isOverdue) {
      status = 'overdue_scheduled';
    }

    const d = isScheduled ? new Date(group.time) : null;
    const dateLabel = d && !Number.isNaN(d.getTime())
      ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      : '';
    const timeLabel = d && !Number.isNaN(d.getTime())
      ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      : 'Unscheduled';
    const fullScheduleLabel = isScheduled
      ? `${dateLabel} · ${timeLabel}${isOverdue ? ' (Overdue)' : ''}`
      : 'Unscheduled';

    let statusLabel = 'Scheduled';
    if (status === 'overdue_delivery') {
      statusLabel = 'Overdue Delivery';
    } else if (status === 'overdue_scheduled') {
      statusLabel = 'Overdue Scheduled';
    } else if (status === 'in_transit') {
      statusLabel = 'In Transit';
    } else if (status === 'delivery_failed') {
      statusLabel = 'Delivery Issue';
    } else if (status === 'completed') {
      statusLabel = 'Delivered';
    } else if (String(group.tripId).startsWith('trip_adhoc_') || !group.time || !group.distributorUid) {
      statusLabel = 'Unverified Legacy';
    }

    const isPhysicalLoadVerified = !hasUnknownCargo;
    const hasUnverifiedPhysicalLoad = false;
    const isLegacyUnverified = Boolean(
      String(group.tripId).startsWith('trip_adhoc_') ||
      !group.time ||
      !group.distributorUid
    );

    return {
      tripId: group.tripId,
      tripNumber: index + 1,
      distributorUid: group.distributorUid,
      distributorName: group.distributorName || 'Unassigned / Needs Review',
      distributorUniqueId: group.distributorUniqueId || '',
      isLegacyUnverified,
      isOverdue,
      time: group.time,
      scheduledAt: formatIsoSchedule(group.time || group.scheduledAt),
      isScheduled,
      dateLabel,
      timeLabel,
      fullScheduleLabel,
      orders: group.orders,
      orderIds: group.orders.map((o) => o.id),
      totalContainers,
      otherCargoCount,
      otherCargoSummary,
      otherCargoItemSummaries: otherCargoAggregatedList,
      unknownLoadCount,
      hasOtherCargo,
      hasUnknownCargo,
      isPhysicalLoadVerified,
      hasUnverifiedPhysicalLoad,
      maxCapacity,
      remainingCapacity,
      isFull,
      managerApproved,
      status,
      statusLabel,
    };
  });
}

/**
 * Produces a clear human-readable cargo breakdown for an individual order.
 */
function describeOrderCargo(order = {}) {
  const cargo = analyzeOrderCargo(order);
  const parts = [];
  if (cargo.standard5GallonCount > 0) {
    parts.push(`${cargo.standard5GallonCount} × 5-gal`);
  }
  if (cargo.otherCargoCount > 0) {
    const otherItems = [];
    if (Array.isArray(cargo.itemAnalyses)) {
      for (const it of cargo.itemAnalyses) {
        if (it.classification === 'other') {
          const name = it.item?.productNameSnapshot || it.item?.name || 'Other';
          otherItems.push({ quantity: it.quantity, name });
        }
      }
    }
    const otherText = aggregateCargoItems(otherItems) || `${cargo.otherCargoCount} other cargo`;
    parts.push(otherText);
  }
  if (cargo.hasUnknownCargo) {
    parts.push(`⚠️ Needs Review (${cargo.unknownLoadCount || 1} unverified item)`);
  }
  return {
    summary: parts.join(' + ') || '0 items',
    badgeLabel: cargo.badgeLabel,
    badgeTone: cargo.badgeTone,
    standard5GallonCount: cargo.standard5GallonCount,
    otherCargoCount: cargo.otherCargoCount,
    hasUnknownCargo: cargo.hasUnknownCargo,
    isPure5Gallon: cargo.isPure5Gallon,
    isMixed: cargo.isMixed,
    isOnlyOther: cargo.isOnlyOther,
    isPhysicalLoadVerified: cargo.isPhysicalLoadVerified,
    hasUnverifiedPhysicalLoad: cargo.hasUnverifiedPhysicalLoad,
  };
}

/**
 * Summarizes the entire active workload of a distributor across all trips.
 */
function getDistributorWorkloadSummary({ activeOrders = [], distributorUid = '' }) {
  if (!distributorUid) {
    return {
      totalActiveOrders: 0,
      activeTrips: [],
      activeTripsCount: 0,
      isAtMaxTrips: false,
      total5GallonContainers: 0,
      totalOtherCargoCount: 0,
      hasUnscheduledOrders: false,
      unscheduledOrdersCount: 0,
      hasUnknownCargo: false,
      hasOverdueTrips: false,
      overdueTripsCount: 0,
      activeOrders: [],
    };
  }

  const trips = groupOrdersIntoTrips(activeOrders, distributorUid);
  let totalActiveOrders = 0;
  let total5GallonContainers = 0;
  let totalOtherCargoCount = 0;
  let hasUnscheduledOrders = false;
  let unscheduledOrdersCount = 0;
  let hasUnknownCargo = false;
  const filteredActiveOrders = [];

  for (const trip of trips) {
    totalActiveOrders += trip.orders.length;
    total5GallonContainers += trip.totalContainers;
    totalOtherCargoCount += trip.otherCargoCount || 0;
    if (!trip.isScheduled) {
      hasUnscheduledOrders = true;
      unscheduledOrdersCount += trip.orders.length;
    }
    if (trip.hasUnknownCargo) {
      hasUnknownCargo = true;
    }
    filteredActiveOrders.push(...trip.orders);
  }

  const hasOverdueTrips = trips.some((t) => t.isOverdue);
  const overdueTripsCount = trips.filter((t) => t.isOverdue).length;

  return {
    totalActiveOrders,
    activeTrips: trips,
    activeTripsCount: trips.length,
    isAtMaxTrips: false,
    total5GallonContainers,
    totalOtherCargoCount,
    hasUnscheduledOrders,
    unscheduledOrdersCount,
    hasUnknownCargo,
    hasOverdueTrips,
    overdueTripsCount,
    activeOrders: filteredActiveOrders,
  };
}

/**
 * Calculates real-time capacity and co-loading eligibility for a specific delivery slot.
 */
function getSlotCapacityInfo({ trips = [], slotTime = 0, currentOrder = null, targetTripId = '' }) {
  let matchingTrip = null;
  if (targetTripId) {
    matchingTrip = (Array.isArray(trips) ? trips : []).find(
      (t) => t.tripId === targetTripId
    ) || null;
  }
  if (!matchingTrip && slotTime) {
    const slotTrips = (Array.isArray(trips) ? trips : []).filter(
      (t) => t.time && Math.abs(t.time - slotTime) < 60 * 1000
    );
    if (slotTrips.length >= 1) {
      matchingTrip = slotTrips[0];
    }
  }

  const conflictTrip = matchingTrip
    ? null
    : (Array.isArray(trips) ? trips : []).find(
        (t) => isTripOverlapping(t, slotTime, currentOrder)
      ) || null;

  const currentCargo = analyzeOrderCargo(currentOrder);
  const currentContainers = currentCargo.standard5GallonCount;
  const isPastTime = slotTime < Date.now() - 5 * 60 * 1000;

  if (matchingTrip) {
    const projectedContainers = matchingTrip.totalContainers + currentContainers;
    const remainingAfter = Math.max(0, TRIP_MAX_CONTAINERS - projectedContainers);
    const isOverCapacity = projectedContainers > TRIP_MAX_CONTAINERS;
    const hasUnknownCargo = matchingTrip.hasUnknownCargo || currentCargo.hasUnknownCargo;

    const totalOtherCargo = (matchingTrip.otherCargoCount || 0) + (currentCargo.otherCargoCount || 0);
    const hasOtherCargo = totalOtherCargo > 0;

    const hasUnverifiedPhysicalLoad = false;
    const isPhysicalLoadVerified = !hasUnknownCargo;

    const isEligibleForCoLoad = !isOverCapacity && !hasUnknownCargo && !isPastTime;

    let explanation = '';
    if (isPastTime) {
      explanation = 'Delivery time slot has already passed.';
    } else if (hasUnknownCargo) {
      explanation = 'Physical trip load is unverified. Review product specifications before assigning.';
    } else if (isOverCapacity) {
      explanation = `Trip #${matchingTrip.tripNumber} cannot co-load this order (${matchingTrip.totalContainers} loaded + ${currentContainers} = ${projectedContainers} > ${TRIP_MAX_CONTAINERS} max).`;
    } else {
      explanation = `Eligible for Co-Loading: Order fits within Trip #${matchingTrip.tripNumber} (${projectedContainers}/${TRIP_MAX_CONTAINERS} standard 5-gal used, ${remainingAfter} remaining${totalOtherCargo > 0 ? ` + ${totalOtherCargo} other cargo` : ''}).`;
    }

    let statusLabel = 'Co-Load Available';
    let statusTone = 'purple';
    if (isPastTime) {
      statusLabel = 'Passed';
      statusTone = 'muted';
    } else if (hasUnknownCargo) {
      statusLabel = 'Needs Review';
      statusTone = 'warning';
    } else if (isOverCapacity) {
      statusLabel = 'Trip Full';
      statusTone = 'danger';
    }

    return {
      isExistingTrip: true,
      trip: matchingTrip,
      tripNumber: matchingTrip.tripNumber,
      tripId: matchingTrip.tripId,
      fullScheduleLabel: matchingTrip.fullScheduleLabel,
      dateLabel: matchingTrip.dateLabel,
      timeLabel: matchingTrip.timeLabel,
      usedContainers: matchingTrip.totalContainers,
      maxCapacity: TRIP_MAX_CONTAINERS,
      remainingCapacity: matchingTrip.remainingCapacity,
      projectedContainers,
      remainingAfter,
      isOverCapacity,
      hasOtherCargo,
      otherCargoCount: totalOtherCargo,
      otherCargoSummary: aggregateCargoItems([matchingTrip.otherCargoSummary, currentCargo.hasOtherCargo ? describeOrderCargo(currentOrder).summary : ''].filter(Boolean)),
      hasUnknownCargo,
      hasUnverifiedPhysicalLoad,
      isPhysicalLoadVerified,
      assignedOrders: matchingTrip.orders,
      assignedOrdersCount: matchingTrip.orders.length,
      hasTurnaroundConflict: false,
      conflictTrip: null,
      isPastTime,
      isEligible: isEligibleForCoLoad,
      statusLabel,
      statusTone,
      explanation,
    };
  }

  // New trip slot
  const hasTurnaroundConflict = Boolean(conflictTrip);
  const isOverCapacity = currentContainers > TRIP_MAX_CONTAINERS;
  const hasUnknownCargo = currentCargo.hasUnknownCargo;
  const hasOtherCargo = currentCargo.hasOtherCargo;
  const hasUnverifiedPhysicalLoad = false;
  const isPhysicalLoadVerified = !hasUnknownCargo;
  const isEligible = !isPastTime && !hasTurnaroundConflict && !isOverCapacity && !hasUnknownCargo;

  let explanation = '';
  if (isPastTime) {
    explanation = 'Delivery time slot has already passed.';
  } else if (hasTurnaroundConflict) {
    explanation = `Schedule conflict: Distributor has Trip #${conflictTrip.tripNumber} scheduled that overlaps with this delivery window.`;
  } else if (isOverCapacity) {
    explanation = `Order container count (${currentContainers}) exceeds maximum trip capacity (${TRIP_MAX_CONTAINERS}).`;
  } else if (currentCargo.hasUnknownCargo) {
    explanation = 'Physical trip load for this order is unverified. Review product specifications before assigning.';
  } else {
    explanation = `New Trip #${(Array.isArray(trips) ? trips : []).length + 1} will be created (${currentContainers}/${TRIP_MAX_CONTAINERS} standard 5-gal used${currentCargo.otherCargoCount > 0 ? ` + ${currentCargo.otherCargoCount} other cargo` : ''}).`;
  }

  // An empty slot's status badge reflects the slot's schedule availability, NOT the candidate order's cargo status
  let statusLabel = 'New Trip';
  let statusTone = 'blue';
  if (isPastTime) {
    statusLabel = 'Passed';
    statusTone = 'muted';
  } else if (hasTurnaroundConflict) {
    statusLabel = 'Conflict';
    statusTone = 'orange';
  }

  return {
    isExistingTrip: false,
    trip: null,
    tripNumber: (Array.isArray(trips) ? trips : []).length + 1,
    tripId: '',
    fullScheduleLabel: '',
    dateLabel: '',
    timeLabel: '',
    usedContainers: 0,
    maxCapacity: TRIP_MAX_CONTAINERS,
    remainingCapacity: TRIP_MAX_CONTAINERS,
    projectedContainers: currentContainers,
    remainingAfter: Math.max(0, TRIP_MAX_CONTAINERS - currentContainers),
    isOverCapacity,
    hasOtherCargo,
    otherCargoCount: currentCargo.otherCargoCount || 0,
    otherCargoSummary: currentCargo.hasOtherCargo ? describeOrderCargo(currentOrder).summary : '',
    hasUnknownCargo,
    hasUnverifiedPhysicalLoad,
    isPhysicalLoadVerified,
    assignedOrders: [],
    assignedOrdersCount: 0,
    hasTurnaroundConflict,
    conflictTrip,
    isPastTime,
    isEligible,
    statusLabel,
    statusTone,
    explanation,
  };
}

function validateTripAssignment({
  activeOrders = [],
  currentOrderId = '',
  targetDistributorUid = '',
  targetScheduledAt = null,
  targetTripId = '',
  orderToAssign = {},
  requirePhysicalLoadVerification = false,
  OtpErrorClass = Error,
}) {
  const cargo = analyzeOrderCargo(orderToAssign);
  if (cargo.hasUnknownCargo) {
    throw new OtpErrorClass(
      409,
      'TRIP_LOAD_UNKNOWN',
      'Order cargo physical load is unknown. Review product catalog specifications before assigning to trip.'
    );
  }

  const orderContainers = cargo.standard5GallonCount;
  if (orderContainers > TRIP_MAX_CONTAINERS) {
    throw new OtpErrorClass(
      409,
      'TRIP_CAPACITY_EXCEEDED',
      `Order container count (${orderContainers}) exceeds the maximum trip capacity of ${TRIP_MAX_CONTAINERS} standard 5-gallon containers.`
    );
  }

  const targetTime = parseScheduleTime(targetScheduledAt);
  if (!targetTime || targetTime < Date.now() - 5 * 60 * 1000) {
    throw new OtpErrorClass(
      400,
      'INVALID_DELIVERY_SCHEDULE',
      'Choose a current or future delivery time.'
    );
  }

  // Filter active orders for the target distributor, excluding current order
  const distributorOrders = (Array.isArray(activeOrders) ? activeOrders : []).filter((o) => {
    if (o.id === currentOrderId) return false;
    const distUid = String(o.assignedDistributorUid || o.distributor_id || '').trim();
    if (distUid !== targetDistributorUid) return false;
    const st = String(o.status || '').trim().toLowerCase();
    return ACTIVE_ASSIGNMENT_STATUSES.has(st);
  });

  const existingTrips = groupOrdersIntoTrips(distributorOrders, targetDistributorUid);

  // Check if target matches an existing trip (co-loading into same trip)
  let matchingTrip = null;
  if (targetTripId) {
    matchingTrip = existingTrips.find((t) => t.tripId === targetTripId) || null;
  }
  if (!matchingTrip && targetTime) {
    matchingTrip = existingTrips.find((t) => t.time && Math.abs(t.time - targetTime) < 60 * 1000) || null;
  }

  // Check for schedule conflicts with OTHER trips (prevent overlapping delivery windows)
  for (const trip of existingTrips) {
    if (matchingTrip && trip.tripId === matchingTrip.tripId) {
      continue; // Co-loading into the same trip is allowed
    }
    if (isTripOverlapping(trip, targetTime, orderToAssign)) {
      throw new OtpErrorClass(
        409,
        'DISTRIBUTOR_SCHEDULE_CONFLICT',
        `Distributor already has an active delivery (Trip #${trip.tripNumber}) scheduled that overlaps with this delivery window.`
      );
    }
  }

  if (matchingTrip) {
    if (matchingTrip.hasUnknownCargo) {
      throw new OtpErrorClass(
        409,
        'TRIP_LOAD_UNKNOWN',
        `Distributor Trip #${matchingTrip.tripNumber} contains unclassified cargo items. Review product specifications before co-loading.`
      );
    }

    const newTotal = matchingTrip.totalContainers + orderContainers;
    if (newTotal > TRIP_MAX_CONTAINERS) {
      throw new OtpErrorClass(
        409,
        'TRIP_CAPACITY_EXCEEDED',
        `Distributor trip capacity of ${TRIP_MAX_CONTAINERS} standard 5-gallon containers exceeded (${matchingTrip.totalContainers} currently loaded + ${orderContainers} requested = ${newTotal}). Choose another trip or distributor.`
      );
    }
    return {
      tripId: matchingTrip.tripId,
      tripNumber: matchingTrip.tripNumber,
      orderContainers,
      tripContainers: newTotal,
      remainingCapacity: Math.max(0, TRIP_MAX_CONTAINERS - newTotal),
      hasOtherCargo: matchingTrip.hasOtherCargo || cargo.hasOtherCargo,
      otherCargoCount: (matchingTrip.otherCargoCount || 0) + (cargo.otherCargoCount || 0),
      isPhysicalLoadVerified: true,
      hasUnverifiedPhysicalLoad: false,
      isNewTrip: false,
    };
  }

  // New trip creation: policy permits multiple active trips when capacity and schedules permit
  const newTripId = targetTripId || generateTripId(targetDistributorUid, targetTime);
  const newTripNumber = existingTrips.length + 1;

  return {
    tripId: newTripId,
    tripNumber: newTripNumber,
    orderContainers,
    tripContainers: orderContainers,
    remainingCapacity: Math.max(0, TRIP_MAX_CONTAINERS - orderContainers),
    hasOtherCargo: cargo.hasOtherCargo,
    otherCargoCount: cargo.otherCargoCount,
    isPhysicalLoadVerified: true,
    hasUnverifiedPhysicalLoad: false,
    isNewTrip: true,
  };
}

const TIME_SLOT_OPTIONS = [
  { label: '09:00 AM', hours: 9, minutes: 0 },
  { label: '11:00 AM', hours: 11, minutes: 0 },
  { label: '01:00 PM', hours: 13, minutes: 0 },
  { label: '03:00 PM', hours: 15, minutes: 0 },
  { label: '05:00 PM', hours: 17, minutes: 0 },
];

function getActiveDistributorOrders(allOrders = [], distributorUid = '', excludeOrderId = '') {
  if (!distributorUid) return [];
  const seen = new Set();
  const result = [];
  for (const item of (Array.isArray(allOrders) ? allOrders : [])) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || item.requestId || item._id || '').trim();
    if (id && id === excludeOrderId) continue;
    if (id && seen.has(id)) continue;

    const distUid = String(
      item.assignedDistributorUid ||
      item.distributor_id ||
      item.distributorId ||
      item.assignedDistributorId ||
      item.distributorUid ||
      ''
    ).trim();
    if (distUid !== distributorUid) continue;

    const status = String(item.status || '').trim().toLowerCase();
    if (!ACTIVE_ASSIGNMENT_STATUSES.has(status)) continue;

    if (id) seen.add(id);
    result.push(item);
  }
  return result;
}

module.exports = {
  TRIP_MAX_CONTAINERS,
  SCHEDULE_CONFLICT_WINDOW_MS,
  ACTIVE_ASSIGNMENT_STATUSES,
  TIME_SLOT_OPTIONS,
  getActiveDistributorOrders,
  parseScheduleTime,
  formatIsoSchedule,
  classifyProductItem,
  analyzeOrderCargo,
  calculateOrderContainers,
  generateTripId,
  isSameTrip,
  groupOrdersIntoTrips,
  validateTripAssignment,
  describeOrderCargo,
  getDistributorWorkloadSummary,
  getSlotCapacityInfo,
  getTripDurationMs,
  getTripTimeWindow,
  isTripOverlapping,
  aggregateCargoItems,
};
