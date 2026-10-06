import deliveryFailureReasonsModule from '../constants/deliveryFailureReasons.js';
const { formatDeliveryFailureReason } = deliveryFailureReasonsModule;

const clean = (value) => String(value || '').trim();

export function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value?.toDate === 'function') {
    try { const d = value.toDate(); if (d instanceof Date && !Number.isNaN(d.getTime())) return d; } catch {}
  }
  if (typeof value?.toMillis === 'function') {
    try { const ms = value.toMillis(); if (Number.isFinite(ms)) return new Date(ms); } catch {}
  }
  if (value && typeof value._seconds === 'number') {
    return new Date(value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1000000));
  }
  if (value && typeof value.seconds === 'number') {
    return new Date(value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000));
  }
  if (typeof value === 'number') {
    const ms = value > 1e11 ? value : value * 1000;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const formMatch = trimmed.match(/^(\d{1,2})\s*-\s*(\d{1,2})\s*-\s*(\d{4})$/);
    if (formMatch) {
      const d = new Date(Number(formMatch[3]), Number(formMatch[1]) - 1, Number(formMatch[2]));
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(trimmed);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function formatOrderDate(rawDate, fallback = 'Not set') {
  const date = parseDate(rawDate);
  if (!date) {
    return clean(rawDate) || fallback;
  }
  try {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return fallback;
  }
}

export function formatDeliveryDate(rawDate, fallback = 'Not set') {
  const date = parseDate(rawDate);
  if (!date) {
    return clean(rawDate) || fallback;
  }
  try {
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return fallback;
  }
}

export function formatDisplayUniqueId(val, fallback = 'Not assigned') {
  const raw = clean(val);
  if (!raw) return fallback;
  if (/^[A-Za-z0-9]{28}$/.test(raw) && !/^(?:REQ|DIS|MGR|ADM)-/i.test(raw)) {
    return fallback;
  }
  return raw;
}

export function formatCurrency(amount) {
  if (amount === undefined || amount === null || amount === '') {
    return '—';
  }

  let numeric = amount;
  if (typeof amount === 'string') {
    const trimmed = amount.trim();
    if (!trimmed || trimmed === '—' || trimmed === 'Not set') return '—';
    const stripped = trimmed.replace(/^[₱\u20B1\s]+/, '').replace(/,/g, '');
    numeric = Number(stripped);
  } else {
    numeric = Number(amount);
  }

  if (!Number.isFinite(numeric)) {
    return '—';
  }

  return `₱${numeric.toFixed(2)}`;
}

export function normalizeProductItem(item = {}, index = 0) {
  const id = clean(item.id || item.productId || item.product_id || `${item.productName || item.product_name || 'product'}-${index}`);
  const productId = clean(item.productId || item.product_id || item.id || '');
  const productName = clean(
    item.productNameSnapshot ||
    item.productName ||
    item.product_name ||
    item.name ||
    'Mineral Water'
  );

  const rawQty = item.quantity ?? item.qty;
  const quantity = Number.isFinite(Number(rawQty)) && Number(rawQty) > 0 ? Number(rawQty) : 1;

  const rawUnitPrice = item.unitPriceAtOrder ?? item.unitPrice ?? item.unit_price ?? item.product_price ?? item.price;
  const unitPrice = rawUnitPrice !== undefined && rawUnitPrice !== null && rawUnitPrice !== ''
    ? Number(rawUnitPrice)
    : undefined;

  const rawSubtotal = item.totalAtOrder ?? item.subtotal ?? item.line_total;
  const subtotal = rawSubtotal !== undefined && rawSubtotal !== null && rawSubtotal !== ''
    ? Number(rawSubtotal)
    : (unitPrice !== undefined ? Math.round(unitPrice * quantity * 100) / 100 : undefined);

  const containerType = clean(item.containerType || item.container || item.container_type || 'Slim');

  return {
    id,
    productId,
    name: productName,
    productName,
    productNameSnapshot: productName,
    quantity,
    qty: quantity,
    containerType,
    container: containerType,
    unitPrice,
    unitPriceAtOrder: unitPrice,
    subtotal,
    totalAtOrder: subtotal,
    line_total: subtotal,
    formattedUnitPrice: formatCurrency(unitPrice),
    formattedSubtotal: formatCurrency(subtotal),
  };
}

export function normalizeRequestDetails(order) {
  if (!order || typeof order !== 'object') {
    return null;
  }

  const id = clean(order.id || order.sourceId || order.orderId);
  const requestId = clean(
    order.requestId ||
    order.request_id ||
    order.id ||
    order.publicOrderReference ||
    ''
  );
  const publicOrderId = clean(
    order.publicOrderId ||
    order.publicOrderReference ||
    order.requestId ||
    order.request_id ||
    (id ? `BT-${id.slice(-6).toUpperCase()}` : 'Order')
  );

  const waterStation = clean(
    order.waterStation ||
    order.currentBranchName ||
    order.currentBranchNameSnapshot ||
    order.branchName ||
    order.branchNameSnapshot ||
    order.branch_name ||
    order.water_station ||
    order.branchDisplayName ||
    'BlueTap Station'
  );

  const branchId = clean(
    order.currentBranchId ||
    order.branchId ||
    order.water_station_id ||
    order.branch ||
    ''
  );

  const deliveryAddress = clean(
    order.deliveryAddress ||
    order.addressSnapshot ||
    order.address ||
    order.deliveryLocation?.address ||
    order.completeAddress ||
    ''
  );

  const requesterName = clean(
    order.requesterNameSnapshot ||
    order.requesterName ||
    order.requester_name ||
    order.customerName ||
    order.customer_name ||
    order.requester ||
    order.fullName ||
    order.requesterFullName ||
    ''
  );

  const rawRequesterId = clean(
    order.requesterPublicUidSnapshot ||
    order.requesterUniqueId ||
    order.requesterUniqueIdSnapshot ||
    order.requester_unique_id ||
    order.requesterDisplayUid ||
    order.requester_id ||
    order.requesterId ||
    ''
  );
  const requesterUniqueId = formatDisplayUniqueId(rawRequesterId, 'Not assigned');

  const contactNumber = clean(
    order.contactNumber ||
    order.contact_number ||
    order.contact ||
    order.phone ||
    order.phoneNumber ||
    order.requesterPhone ||
    order.requesterContactNumber ||
    order.requesterContact ||
    ''
  );

  const distributorName = clean(
    order.distributorNameSnapshot ||
    order.distributorName ||
    order.distributor_name ||
    order.assignedDistributorName ||
    ''
  );

  const rawDistributorId = clean(
    order.distributorPublicUidSnapshot ||
    order.distributorUniqueId ||
    order.distributor_unique_id ||
    order.distributorDisplayUid ||
    ''
  );
  const distributorUniqueId = formatDisplayUniqueId(rawDistributorId, 'Not assigned');

  // Dates
  const rawOrderDate = order.orderDate || order.order_date || order.createdAt || order.created_at || order.requestedAt || order.timestamp || order.when;
  const orderDate = formatOrderDate(rawOrderDate, 'Not set');

  const rawDeliveryDate = order.deliveryDate || order.delivery_date || order.scheduledAt || order.scheduled_at || order.scheduledDateTime || order.scheduledDate || order.deliverySchedule || order.schedule || order.expectedDeliveryDate;
  const deliveryDate = formatDeliveryDate(rawDeliveryDate, 'Not set');

  // Normalize items
  let rawItems = Array.isArray(order.items) && order.items.length
    ? order.items
    : (Array.isArray(order.products) && order.products.length ? order.products : []);
  if (!rawItems.length && (order.productId || order.product_id || order.productName || order.product_name)) {
    rawItems = [{
      productId: order.productId || order.product_id,
      productName: order.productName || order.product_name || order.productNameSnapshot,
      quantity: order.quantity,
      containerType: order.container || order.containerType,
      unitPrice: order.unitPriceAtOrder ?? order.unitPrice ?? order.product_price ?? order.price,
      subtotal: order.totalAtOrder ?? order.total_cost ?? order.subtotal,
    }];
  }
  const items = rawItems.map(normalizeProductItem);

  // Authoritative Subtotal
  const rawSubtotal = order.subtotalAtOrder ?? order.subtotal;
  let subtotal = rawSubtotal !== undefined && rawSubtotal !== null && rawSubtotal !== ''
    ? Number(rawSubtotal)
    : items.reduce((sum, item) => sum + (Number.isFinite(item.subtotal) ? item.subtotal : 0), 0);
  if (!Number.isFinite(subtotal)) subtotal = 0;

  // Authoritative Delivery Fee
  const rawDeliveryFee = order.deliveryFeeAtOrder ?? order.deliveryFee ?? order.delivery_fee;
  let deliveryFee = rawDeliveryFee !== undefined && rawDeliveryFee !== null && rawDeliveryFee !== ''
    ? Number(rawDeliveryFee)
    : 0;
  if (!Number.isFinite(deliveryFee)) deliveryFee = 0;

  // Authoritative Grand Total
  // Priority: totalAtOrder -> total_cost -> grandTotalAmount -> grandTotal -> totalAmount -> total
  const totalCandidates = [
    order.totalAtOrder,
    order.total_cost,
    order.grandTotalAmount,
    order.grandTotal,
    order.totalAmount,
    order.total,
  ];

  let grandTotal = undefined;
  for (const candidate of totalCandidates) {
    if (candidate !== undefined && candidate !== null && candidate !== '') {
      let num = candidate;
      if (typeof candidate === 'string') {
        const stripped = candidate.replace(/^[₱\u20B1\s]+/, '').replace(/,/g, '');
        num = Number(stripped);
      } else {
        num = Number(candidate);
      }
      if (Number.isFinite(num) && num > 0) {
        grandTotal = num;
        break;
      }
    }
  }

  // Fallback line-item computation if no explicit authoritative total is found
  if (grandTotal === undefined) {
    const discount = Number.isFinite(Number(order.discount)) ? Number(order.discount) : 0;
    const computed = Math.round((subtotal + deliveryFee - discount) * 100) / 100;
    if (computed > 0 || (items.length > 0 && computed >= 0)) {
      grandTotal = computed;
    } else if (order.price !== undefined && Number.isFinite(Number(order.price))) {
      const qty = Number(order.quantity) || 1;
      grandTotal = Math.round(Number(order.price) * qty * 100) / 100;
    } else {
      grandTotal = undefined;
    }
  }

  const paymentMethod = clean(order.paymentMethod || order.payment_method || 'Cash on Delivery');
  const status = clean(order.status || 'pending').toLowerCase().replace(/[\s-]+/g, '_');
  const failureReason = formatDeliveryFailureReason(order, '');

  return {
    ...order,
    id,
    requestId,
    publicOrderId,
    status,
    orderDate,
    rawOrderDate,
    deliveryDate,
    rawDeliveryDate,
    waterStation,
    currentBranchName: waterStation,
    branchName: waterStation,
    branchId,
    deliveryAddress,
    requesterName,
    customerName: requesterName,
    requesterUniqueId,
    contactNumber,
    distributorName,
    distributorUniqueId,
    paymentMethod,
    items,
    products: items,
    subtotal,
    subtotalAtOrder: subtotal,
    deliveryFee,
    deliveryFeeAtOrder: deliveryFee,
    grandTotal,
    grandTotalAmount: grandTotal,
    totalAmount: grandTotal,
    total_cost: grandTotal,
    totalAtOrder: order.totalAtOrder !== undefined ? order.totalAtOrder : grandTotal,
    total: grandTotal,
    formattedSubtotal: formatCurrency(subtotal),
    formattedDeliveryFee: formatCurrency(deliveryFee),
    formattedGrandTotal: formatCurrency(grandTotal),
    failureReason,
  };
}

export function orderIdentifiers(order = {}) {
  return [
    order.id,
    order.sourceId,
    order.orderId,
    order.requestId,
    order.request_id,
    order.publicOrderReference,
    order.publicOrderId,
  ].map(clean).filter(Boolean);
}

export function resolveOrderFromList(orderOrId, orders = []) {
  if (!orderOrId) return null;

  const orderList = Array.isArray(orders) ? orders : [];
  let matched = null;

  if (typeof orderOrId === 'string') {
    const target = clean(orderOrId);
    matched = orderList.find((order) => orderIdentifiers(order).includes(target)) || null;
    return matched ? normalizeRequestDetails(matched) : null;
  }

  if (typeof orderOrId === 'object') {
    const targetIds = orderIdentifiers(orderOrId);
    if (targetIds.length) {
      matched = orderList.find((order) => {
        const ids = orderIdentifiers(order);
        return targetIds.some((targetId) => ids.includes(targetId));
      }) || null;
    }
    if (matched) {
      return normalizeRequestDetails({ ...matched, ...orderOrId });
    }
    return normalizeRequestDetails(orderOrId);
  }

  return null;
}

export async function resolveAuthorizedOrderDetails({ orderId, order, localOrders = [] }) {
  const candidateId = clean(orderId || order?.id || order?.requestId || order?.request_id || order?.orderId);

  // 1. Check local order cache
  const fromList = resolveOrderFromList(candidateId || order, localOrders);
  if (fromList && fromList.items?.length > 0 && fromList.orderDate !== 'Not set') {
    return fromList;
  }

  // 2. Check if the passed-in order itself is already complete
  if (order && typeof order === 'object') {
    const direct = normalizeRequestDetails(order);
    if (direct && direct.items?.length > 0 && direct.orderDate !== 'Not set') {
      return direct;
    }
  }

  // 3. Fetch authoritative order from backend endpoint
  if (candidateId) {
    try {
      const { getAuth } = await import('firebase/auth');
      const auth = getAuth();
      const token = await auth.currentUser?.getIdToken();
      if (token) {
        const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:3000';
        const response = await fetch(`${baseUrl}/api/orders/details?orderId=${encodeURIComponent(candidateId)}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });
        if (response.ok) {
          const data = await response.json();
          if (data?.order) {
            return normalizeRequestDetails(data.order);
          }
        }
      }
    } catch {
      // Graceful fallback to normalized local data
    }
  }

  if (order && typeof order === 'object') {
    return normalizeRequestDetails(order);
  }
  if (fromList) {
    return fromList;
  }
  return candidateId ? normalizeRequestDetails({ id: candidateId }) : null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatCurrency,
    formatOrderDate,
    formatDeliveryDate,
    formatDisplayUniqueId,
    normalizeProductItem,
    normalizeRequestDetails,
    orderIdentifiers,
    parseDate,
    resolveOrderFromList,
    resolveAuthorizedOrderDetails,
  };
}
