import { cancelRequesterOrder, createRequesterOrder, getRequesterOrders } from './requesterOrdering';
import {
  isActiveRequesterOrderStatus,
  normalizeRequesterOrderStatus,
} from '../constants/requesterOrderStatus';
import { parseTimestamp } from './notificationTimestamp';

export const REQUESTS_COLLECTION = 'requests';

const LOCAL_REQUESTS_KEY = 'bluetapLocalRequests';
const LOCAL_REQUESTS_CHANGED_EVENT = 'bluetapLocalRequestsChanged';

const normalizeAmount = (amount) => {
  const parsedAmount = Number(amount);
  return Number.isFinite(parsedAmount) ? parsedAmount : 0;
};

const normalizeItems = (data = {}) => {
  if (Array.isArray(data.items) && data.items.length > 0) {
    return data.items
      .map((item) => ({
        product_id: item.product_id || item.productId || '',
        product_name: item.product_name || item.productName || item.productNameSnapshot || '',
        product_price: normalizeAmount(item.product_price ?? item.price ?? item.unitPriceAtOrder),
        quantity: normalizeAmount(item.quantity),
        line_total: normalizeAmount(
          item.line_total ?? item.totalAtOrder ?? normalizeAmount(item.product_price ?? item.price ?? item.unitPriceAtOrder) * normalizeAmount(item.quantity)
        ),
      }))
      .filter((item) => item.product_id && item.quantity > 0);
  }

  if (!data.product_id && !data.product_name) {
    return [];
  }

  const quantity = normalizeAmount(data.quantity);
  const productPrice = normalizeAmount(data.product_price);

  return [
    {
      product_id: data.product_id || '',
      product_name: data.product_name || '',
      product_price: productPrice,
      quantity,
      line_total: normalizeAmount(data.total_cost || productPrice * quantity),
    },
  ];
};

const timestampToMillis = (timestamp) => {
  const d = parseTimestamp(timestamp);
  return d ? d.getTime() : 0;
};

const normalizeRequest = (id, data = {}) => {
  const items = normalizeItems(data);
  const totalQuantity =
    normalizeAmount(data.quantity) ||
    items.reduce((sum, item) => sum + normalizeAmount(item.quantity), 0);
  const totalCost =
    normalizeAmount(data.total_cost) ||
    items.reduce((sum, item) => sum + normalizeAmount(item.line_total), 0);

  return {
    id,
    request_id: data.request_id || data.requestId || '',
    requesterUid: (data.requesterUid || data.requester_id || '').toString().trim(),
    requester_id: (data.requester_id || data.requesterUid || '').toString().trim(),
    requester_unique_id:
      (data.requester_unique_id || data.requesterUniqueId || '').toString().trim(),
    requester_name: data.requester_name || '',
    distributor_id: (data.distributor_id || data.distributorId || '').toString().trim(),
    distributor_unique_id:
      (data.distributor_unique_id || data.distributorUniqueId || '')
        .toString()
        .trim(),
    distributor_name: data.distributor_name || data.distributorName || data.branchNameSnapshot || '',
    assignedDistributorName: data.assignedDistributorNameSnapshot || data.distributor_name || data.distributorName || '',
    contact_number: data.contact_number || '',
    address: data.address || data.addressSnapshot || '',
    product_id: data.product_id || items[0]?.product_id || '',
    product_name:
      data.product_name ||
      items.map((item) => item.product_name).filter(Boolean).join(', '),
    product_price: normalizeAmount(data.product_price || items[0]?.product_price),
    quantity: totalQuantity,
    items,
    container: data.container || '',
    water_station: data.water_station || data.branchNameSnapshot || '',
    branchId: (data.branchId || '').toString().trim(),
    currentBranchId: (data.currentBranchId || data.branchId || '').toString().trim(),
    branchNameSnapshot:
      data.currentBranchNameSnapshot || data.branchNameSnapshot || data.water_station || '',
    currentBranchName: data.currentBranchNameSnapshot || data.branchNameSnapshot || data.water_station || '',
    transferState: data.transferState || '',
    transferToBranchName: data.transferToBranchNameSnapshot || '',
    delivery_date: data.delivery_date || '',
    total_cost: totalCost,
    status: data.status || 'Pending',
    created_at: data.created_at || data.createdAt || null,
    createdAt: data.createdAt || data.created_at || null,
    updated_at: data.updated_at || data.updatedAt || null,
    updatedAt: data.updatedAt || data.updated_at || null,
    canceled_at: data.canceled_at || data.cancelledAt || data.cancelled_at || null,
    cancelledAt: data.cancelledAt || data.canceled_at || data.cancelled_at || null,
    deliveredAt: data.deliveredAt || data.delivered_at || null,
    delivered_at: data.delivered_at || data.deliveredAt || null,
    scheduledAt: data.scheduledAt || data.scheduled_at || null,
    scheduled_at: data.scheduled_at || data.scheduledAt || null,
    acceptedAt: data.acceptedAt || data.accepted_at || null,
    accepted_at: data.accepted_at || data.acceptedAt || null,
    assignedAt: data.assignedAt || data.assigned_at || null,
    assigned_at: data.assigned_at || data.assignedAt || null,
    deliveryFailedAt: data.deliveryFailedAt || data.delivery_failed_at || null,
    delivery_failed_at: data.delivery_failed_at || data.deliveryFailedAt || null,
    isLocal: !!data.isLocal,
  };
};

export const sortRequesterOrders = (requests) =>
  [...requests].sort((left, right) => {
    const timestampFor = (request) => {
      if (!isActiveRequesterOrderStatus(request?.status)) {
        return timestampToMillis(request.updated_at || request.canceled_at || request.created_at);
      }

      return timestampToMillis(request.created_at || request.updated_at);
    };

    return timestampFor(right) - timestampFor(left);
  });

export const isCurrentRequesterRequest = (request) => {
  return isActiveRequesterOrderStatus(request?.status);
};

const getCurrentRequesterRequests = (requests) =>
  sortRequesterOrders(requests.filter(isCurrentRequesterRequest));

const getMemoryRequests = () => {
  if (!globalThis.__bluetapLocalRequests) {
    globalThis.__bluetapLocalRequests = [];
  }

  return globalThis.__bluetapLocalRequests;
};

export const getLocalRequests = () => {
  try {
    if (globalThis.localStorage) {
      const storedRequests = JSON.parse(
        globalThis.localStorage.getItem(LOCAL_REQUESTS_KEY) || '[]'
      );
      return Array.isArray(storedRequests)
        ? storedRequests.map((request) => normalizeRequest(request.id, request))
        : [];
    }
  } catch (error) {
    console.log('Local requests read error:', error.message);
  }

  return getMemoryRequests().map((request) => normalizeRequest(request.id, request));
};

const saveLocalRequests = (requests) => {
  const normalizedRequests = requests.map((request) =>
    normalizeRequest(request.id, request)
  );

  try {
    if (globalThis.localStorage) {
      globalThis.localStorage.setItem(
        LOCAL_REQUESTS_KEY,
        JSON.stringify(normalizedRequests)
      );
    } else {
      globalThis.__bluetapLocalRequests = normalizedRequests;
    }
  } catch (error) {
    console.log('Local requests save error:', error.message);
    globalThis.__bluetapLocalRequests = normalizedRequests;
  }

  try {
    globalThis.dispatchEvent?.(new Event(LOCAL_REQUESTS_CHANGED_EVENT));
  } catch (error) {
    console.log('Local requests event error:', error.message);
  }

  return normalizedRequests;
};

const upsertLocalRequest = (request) => {
  const requests = getLocalRequests();
  const normalizedRequest = normalizeRequest(request.id, {
    ...request,
    isLocal: true,
  });

  return saveLocalRequests([
    ...requests.filter((item) => item.id !== normalizedRequest.id),
    normalizedRequest,
  ]);
};

const removeLocalRequest = (requestId) =>
  saveLocalRequests(getLocalRequests().filter((request) => request.id !== requestId));

const subscribeLocalRequests = (listener) => {
  if (!globalThis.addEventListener) {
    return () => {};
  }

  const handleStorage = (event) => {
    if (!event || event.key === LOCAL_REQUESTS_KEY) {
      listener();
    }
  };

  globalThis.addEventListener(LOCAL_REQUESTS_CHANGED_EVENT, listener);
  globalThis.addEventListener('storage', handleStorage);

  return () => {
    globalThis.removeEventListener?.(LOCAL_REQUESTS_CHANGED_EVENT, listener);
    globalThis.removeEventListener?.('storage', handleStorage);
  };
};

const REQUEST_SUBSCRIPTION_IDLE_MS = 15000;
const requesterRequestSubscriptions = new Map();

const getRequestSignature = (requests) =>
  requests
    .map(
      (request) =>
        `${request.id}|${request.status}|${timestampToMillis(request.updated_at)}|${timestampToMillis(request.created_at)}|${request.total_cost}|${request.quantity}`
    )
    .join('::');

const getRequesterRequestEntry = (requesterId) => {
  if (!requesterRequestSubscriptions.has(requesterId)) {
    requesterRequestSubscriptions.set(requesterId, {
      serverRequests: [],
      cachedRequests: null,
      cachedSignature: '',
      subscribers: new Set(),
      refreshPromise: null,
      stopTimer: null,
    });
  }

  return requesterRequestSubscriptions.get(requesterId);
};

const notifyRequesterRequestSubscribers = (entry) => {
  entry.subscribers.forEach(({ listener }) => {
    listener(entry.cachedRequests || []);
  });
};

const emitRequesterRequests = (requesterId, entry, force = false) => {
  const nextRequests = sortRequesterOrders(
    entry.serverRequests.filter(
      (request) => (request.requesterUid || request.requester_id) === requesterId
    )
  );
  const nextSignature = getRequestSignature(nextRequests);

  if (!force && entry.cachedRequests && nextSignature === entry.cachedSignature) {
    return;
  }

  entry.cachedRequests = nextRequests;
  entry.cachedSignature = nextSignature;
  notifyRequesterRequestSubscribers(entry);
};

const stopRequesterRequestSubscription = (requesterId, entry) => {
  entry.stopTimer = null;
};

const scheduleRequesterRequestStop = (requesterId, entry) => {
  if (entry.subscribers.size > 0 || entry.stopTimer) return;

  entry.stopTimer = setTimeout(() => {
    if (entry.subscribers.size === 0) {
      stopRequesterRequestSubscription(requesterId, entry);
    }
  }, REQUEST_SUBSCRIPTION_IDLE_MS);
};

const startRequesterRequestSubscription = (requesterId, entry) => {
  if (entry.stopTimer) {
    clearTimeout(entry.stopTimer);
    entry.stopTimer = null;
  }

  if (entry.refreshPromise) return;

  entry.refreshPromise = getRequesterOrders()
    .then((orders) => {
      entry.serverRequests = (Array.isArray(orders) ? orders : [])
        .map((order) => normalizeRequest(order.id || order.requestId || order.request_id, order))
        .filter((order) => (order.requesterUid || order.requester_id) === requesterId);
      emitRequesterRequests(requesterId, entry, true);
    })
    .catch((error) => {
      entry.subscribers.forEach(({ onError }) => onError?.(error));
    })
    .finally(() => {
      entry.refreshPromise = null;
    });
};

export const subscribeRequesterRequests = (requesterId, listener, onError) => {
  const normalizedRequesterId = (requesterId || '').toString().trim();

  if (!normalizedRequesterId) {
    listener([]);
    return () => {};
  }

  const entry = getRequesterRequestEntry(normalizedRequesterId);
  const subscriber = { listener, onError };
  entry.subscribers.add(subscriber);

  if (entry.cachedRequests !== null) {
    listener(entry.cachedRequests);
  }

  startRequesterRequestSubscription(normalizedRequesterId, entry);

  return () => {
    entry.subscribers.delete(subscriber);
    scheduleRequesterRequestStop(normalizedRequesterId, entry);
  };
};

export const subscribeRequesterCurrentRequests = (requesterId, listener, onError) =>
  subscribeRequesterRequests(
    requesterId,
    (requests) => listener(getCurrentRequesterRequests(requests)),
    onError
  );

export const refreshRequesterRequests = async (requesterId) => {
  const normalizedRequesterId = (requesterId || '').toString().trim();

  if (!normalizedRequesterId) return [];

  const entry = getRequesterRequestEntry(normalizedRequesterId);
  startRequesterRequestSubscription(normalizedRequesterId, entry);
  await entry.refreshPromise;
  return entry.cachedRequests || [];
};

const primeRequesterRequest = (order) => {
  const normalizedOrder = normalizeRequest(order?.id || order?.requestId || order?.request_id, order);
  const requesterId = normalizedOrder.requesterUid || normalizedOrder.requester_id;

  if (!requesterId || !normalizedOrder.id) return normalizedOrder;

  const entry = getRequesterRequestEntry(requesterId);
  entry.serverRequests = [
    normalizedOrder,
    ...entry.serverRequests.filter((request) => request.id !== normalizedOrder.id),
  ];
  emitRequesterRequests(requesterId, entry, true);
  return normalizedOrder;
};

export const createRequest = async (requestData) => {
  const order = await createRequesterOrder({
    branchId: requestData.branchId,
    deliveryLocation: requestData.deliveryLocation,
    container: requestData.container,
    expectedDeliveryDate: requestData.expectedDeliveryDate || requestData.delivery_date,
    items: normalizeItems(requestData).map((item) => ({ productId: item.product_id, quantity: item.quantity })),
  });
  return primeRequesterRequest(order);
};

export const cancelRequest = async (request) => {
  const requestId = typeof request === 'string' ? request : request?.id;

  if (!requestId) {
    throw new Error('Request is missing an ID.');
  }

  const normalizedRequest = normalizeRequest(requestId, typeof request === 'string' ? {} : request);

  if (!['pending', 'outside radius pending approval'].includes(normalizeRequesterOrderStatus(normalizedRequest.status))) {
    throw new Error('Only pending requests can be canceled.');
  }

  const cancelled = await cancelRequesterOrder(requestId);
  return primeRequesterRequest({ ...cancelled, id: requestId });
};
