function schedulingEvent(order, event, at, reason = '') {
  const assignments = Array.isArray(order.assignmentHistory) ? order.assignmentHistory.length : 0;
  const deliveries = Array.isArray(order.distributorDeliveryHistory) ? order.distributorDeliveryHistory.length : 0;
  return { event, at, id: `${event}:${assignments}:${deliveries}`, ...(reason ? { reason } : {}) };
}

module.exports = { schedulingEvent };
