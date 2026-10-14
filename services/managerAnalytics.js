const ISSUE_STATUSES = new Set([
  'cancelled',
  'canceled',
  'delivery_failed',
  'declined',
  'rejected',
  'declined_outside_service_area',
]);

const normalizeStatus = (value) => String(value || '').toLowerCase().replace(/[\s-]+/g, '_');

const numericValue = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const requestId = (request = {}) => String(request.id || request.requestId || request.request_id || '').trim();

export const mergeManagerBranchRequests = (realtimeRequests = [], localRequests = [], branchId = '') => {
  if (!branchId) return realtimeRequests;
  const serverIds = new Set(realtimeRequests.map(requestId).filter(Boolean));
  const scopedLocalRequests = localRequests.filter((request) => String(request.branchId || '').trim() === String(branchId || '').trim());
  return [
    ...realtimeRequests,
    ...scopedLocalRequests.filter((request) => {
      const id = requestId(request);
      return !id || !serverIds.has(id);
    }),
  ];
};

const itemStats = (item = {}) => {
  const units = numericValue(item.quantity);
  const revenue = numericValue(
    item.line_total ??
    item.subtotal ??
    item.totalAtOrder ??
    (numericValue(item.unitPriceAtOrder ?? item.product_price ?? item.price) * units)
  );
  return { units, revenue };
};

const deliveredOrderStats = (order = {}) => {
  if (Array.isArray(order.items) && order.items.length > 0) {
    return order.items.reduce((total, item) => {
      const next = itemStats(item);
      return { units: total.units + next.units, revenue: total.revenue + next.revenue };
    }, { units: 0, revenue: 0 });
  }

  return {
    units: numericValue(order.quantity),
    revenue: numericValue(order.totalAtOrder ?? order.total_amount ?? order.totalAmount ?? order.total_cost),
  };
};

const timestampMillis = (value) => {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (typeof value?.toDate === 'function') return value.toDate().getTime();
  if (typeof value?.seconds === 'number') return value.seconds * 1000;
  const parsed = new Date(value || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

export const getManagerOrderAnalytics = (requests = [], now = new Date()) => {
  const result = { total: requests.length, delivered: 0, ongoing: 0, issues: 0, revenue: 0, units: 0 };
  const products = new Map();
  const months = [];
  const monthKeys = new Set();

  for (let offset = 5; offset >= 0; offset -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - offset, 1);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    monthKeys.add(key);
    months.push({ key, month: new Intl.DateTimeFormat('en-US', { month: 'short' }).format(date), value: 0 });
  }

  const monthIndex = new Map(months.map((month, index) => [month.key, index]));

  requests.forEach((order) => {
    const status = normalizeStatus(order.status);
    if (status !== 'delivered') {
      if (ISSUE_STATUSES.has(status)) result.issues += 1;
      else result.ongoing += 1;
      return;
    }

    result.delivered += 1;
    const totals = deliveredOrderStats(order);
    result.revenue += totals.revenue;
    result.units += totals.units;

    const dateValue = order.deliveredAt || order.delivered_at || order.createdAt || order.created_at;
    const millis = timestampMillis(dateValue);
    if (millis) {
      const date = new Date(millis);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (monthKeys.has(key)) months[monthIndex.get(key)].value += totals.units;
    }

    const items = Array.isArray(order.items) && order.items.length > 0
      ? order.items
      : [{
          productNameSnapshot: order.productNameSnapshot || order.product_name || order.productName || 'Product',
          quantity: order.quantity,
          totalAtOrder: order.totalAtOrder ?? order.total_amount ?? order.totalAmount ?? order.total_cost,
          unitPriceAtOrder: order.unitPriceAtOrder ?? order.product_price ?? order.price,
        }];

    items.forEach((item) => {
      const name = item.productNameSnapshot || item.product_name || item.productName || item.name || 'Product';
      const values = itemStats(item);
      const existing = products.get(name) || { name, units: 0, revenue: 0 };
      existing.units += values.units;
      existing.revenue += values.revenue;
      products.set(name, existing);
    });
  });

  return {
    ...result,
    products: [...products.values()].sort((left, right) => right.revenue - left.revenue),
    trend: months.map(({ month, value }) => ({ month, value })),
  };
};
