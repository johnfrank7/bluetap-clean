import React from 'react';
import {
  resolveOrderFromList,
  normalizeRequestDetails,
  resolveAuthorizedOrderDetails,
} from '../services/orderNormalizer';

export function useCurrentPageRequestDetails(orders = []) {
  const [selectedRequest, setSelectedRequest] = React.useState(null);
  const activeRequestIdRef = React.useRef(null);

  const openRequestDetails = React.useCallback((orderOrId) => {
    if (!orderOrId) return false;

    // 1. Immediate local resolution
    const localMatch = resolveOrderFromList(orderOrId, orders);
    if (localMatch) {
      setSelectedRequest(localMatch);
      activeRequestIdRef.current = localMatch.id || localMatch.requestId;
    } else if (orderOrId && typeof orderOrId === 'object') {
      const normalizedInitial = normalizeRequestDetails(orderOrId);
      setSelectedRequest(normalizedInitial);
      activeRequestIdRef.current = normalizedInitial?.id || normalizedInitial?.requestId;
    } else if (typeof orderOrId === 'string') {
      const interim = normalizeRequestDetails({ id: orderOrId, requestId: orderOrId });
      setSelectedRequest(interim);
      activeRequestIdRef.current = orderOrId;
    }

    // 2. Authoritative full fetch if partial or ID
    const targetId = typeof orderOrId === 'string'
      ? orderOrId
      : (orderOrId.id || orderOrId.requestId || orderOrId.request_id || orderOrId.orderId);

    if (targetId) {
      resolveAuthorizedOrderDetails({
        orderId: targetId,
        order: typeof orderOrId === 'object' ? orderOrId : null,
        localOrders: orders,
      }).then((authoritative) => {
        if (authoritative && activeRequestIdRef.current === targetId) {
          setSelectedRequest(authoritative);
        }
      }).catch(() => {
        // Retain optimistic/local state on network error
      });
    }

    return true;
  }, [orders]);

  const closeRequestDetails = React.useCallback(() => {
    activeRequestIdRef.current = null;
    setSelectedRequest(null);
  }, []);

  return {
    selectedRequest,
    requestDetailsVisible: Boolean(selectedRequest),
    openRequestDetails,
    closeRequestDetails,
  };
}

export default useCurrentPageRequestDetails;
