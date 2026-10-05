import React from 'react';

const clean = (value) => String(value || '').trim();

const orderIdentifiers = (order = {}) => [
  order.id,
  order.sourceId,
  order.orderId,
  order.requestId,
  order.request_id,
  order.publicOrderReference,
].map(clean).filter(Boolean);

export function useCurrentPageRequestDetails(orders = []) {
  const [selectedRequest, setSelectedRequest] = React.useState(null);

  const openRequestDetails = React.useCallback((orderOrId) => {
    if (orderOrId && typeof orderOrId === 'object') {
      setSelectedRequest(orderOrId);
      return true;
    }

    const target = clean(orderOrId);
    const match = (Array.isArray(orders) ? orders : []).find((order) =>
      orderIdentifiers(order).includes(target)
    );
    if (!match) return false;
    setSelectedRequest(match);
    return true;
  }, [orders]);

  const closeRequestDetails = React.useCallback(() => setSelectedRequest(null), []);

  return {
    selectedRequest,
    requestDetailsVisible: Boolean(selectedRequest),
    openRequestDetails,
    closeRequestDetails,
  };
}

export default useCurrentPageRequestDetails;
