const clean = (value) => String(value || '').trim();

function orderDocumentId(order = {}) {
  return clean(order.sourceId || order.id || order.orderId || order.requestId || order.request_id);
}

function orderDetailPathForRole(role) {
  if (role === 'requester') return '/requester/r_notification';
  if (role === 'distributor') return '/distributor/d_notification';
  if (role === 'manager') return '/manager/request';
  return '';
}

function orderDetailTarget(role, order = {}) {
  const pathname = orderDetailPathForRole(role);
  const orderId = orderDocumentId(order);
  return pathname && orderId ? { pathname, params: { orderId } } : null;
}

module.exports = { orderDetailPathForRole, orderDetailTarget, orderDocumentId };
