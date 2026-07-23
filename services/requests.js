import {
  collection,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';

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
        product_name: item.product_name || item.productName || '',
        product_price: normalizeAmount(item.product_price ?? item.price),
        quantity: normalizeAmount(item.quantity),
        line_total: normalizeAmount(
          item.line_total ?? normalizeAmount(item.product_price ?? item.price) * normalizeAmount(item.quantity)
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
  if (!timestamp) return 0;
  if (typeof timestamp === 'string') return new Date(timestamp).getTime() || 0;
  if (typeof timestamp.toMillis === 'function') return timestamp.toMillis();
  if (timestamp.seconds) return timestamp.seconds * 1000;
  return 0;
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
    request_id: data.request_id || '',
    requester_id: (data.requester_id || '').toString().trim(),
    requester_unique_id:
      (data.requester_unique_id || data.requesterUniqueId || '').toString().trim(),
    requester_name: data.requester_name || '',
    distributor_id: (data.distributor_id || data.distributorId || '').toString().trim(),
    distributor_unique_id:
      (data.distributor_unique_id || data.distributorUniqueId || '')
        .toString()
        .trim(),
    distributor_name: data.distributor_name || data.distributorName || '',
    contact_number: data.contact_number || '',
    address: data.address || '',
    product_id: data.product_id || items[0]?.product_id || '',
    product_name:
      data.product_name ||
      items.map((item) => item.product_name).filter(Boolean).join(', '),
    product_price: normalizeAmount(data.product_price || items[0]?.product_price),
    quantity: totalQuantity,
    items,
    container: data.container || '',
    water_station: data.water_station || '',
    delivery_date: data.delivery_date || '',
    total_cost: totalCost,
    status: data.status || 'Pending',
    created_at: data.created_at || null,
    updated_at: data.updated_at || null,
    canceled_at: data.canceled_at || null,
    isLocal: !!data.isLocal,
  };
};

const sortRequests = (requests) =>
  [...requests].sort(
    (left, right) =>
      timestampToMillis(right.created_at) - timestampToMillis(left.created_at)
  );

const inactiveCurrentRequestStatuses = new Set([
  'cancelled',
  'canceled',
  'delivered',
  'rejected',
]);

export const isCurrentRequesterRequest = (request) => {
  const normalizedStatus = (request.status || 'Pending')
    .toString()
    .trim()
    .toLowerCase();

  return !inactiveCurrentRequestStatuses.has(normalizedStatus);
};

const getCurrentRequesterRequests = (requests) =>
  sortRequests(requests.filter(isCurrentRequesterRequest));

const createRequestNumber = () =>
  `BT-${String(Date.now()).slice(-5).padStart(5, '0')}`;

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

const mergeRequests = (firestoreRequests, localRequests) => {
  const requestsById = new Map();

  firestoreRequests.forEach((request) => {
    requestsById.set(request.id, request);
  });

  localRequests.forEach((localRequest) => {
    const firestoreRequest = requestsById.get(localRequest.id);

    if (!firestoreRequest) {
      requestsById.set(localRequest.id, localRequest);
      return;
    }

    const localUpdatedAt = timestampToMillis(localRequest.updated_at);
    const firestoreUpdatedAt = timestampToMillis(firestoreRequest.updated_at);
    const hasLocalStatusChange =
      localRequest.status &&
      localRequest.status.toLowerCase() !== firestoreRequest.status.toLowerCase();
    const shouldUseLocalRequest =
      localUpdatedAt >= firestoreUpdatedAt ||
      (firestoreUpdatedAt === 0 && hasLocalStatusChange);

    requestsById.set(
      localRequest.id,
      shouldUseLocalRequest
        ? { ...firestoreRequest, ...localRequest, isLocal: true }
        : firestoreRequest
    );
  });

  return sortRequests(Array.from(requestsById.values()));
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
      firestoreRequests: [],
      cachedRequests: null,
      cachedSignature: '',
      subscribers: new Set(),
      unsubscribeFirestore: null,
      unsubscribeLocal: null,
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
  const localRequests = getLocalRequests().filter(
    (request) => request.requester_id === requesterId
  );
  const nextRequests = mergeRequests(entry.firestoreRequests, localRequests);
  const nextSignature = getRequestSignature(nextRequests);

  if (!force && entry.cachedRequests && nextSignature === entry.cachedSignature) {
    return;
  }

  entry.cachedRequests = nextRequests;
  entry.cachedSignature = nextSignature;
  notifyRequesterRequestSubscribers(entry);
};

const stopRequesterRequestSubscription = (requesterId, entry) => {
  entry.unsubscribeFirestore?.();
  entry.unsubscribeLocal?.();
  entry.unsubscribeFirestore = null;
  entry.unsubscribeLocal = null;
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

  if (entry.unsubscribeFirestore && entry.unsubscribeLocal) {
    return;
  }

  entry.unsubscribeLocal = subscribeLocalRequests(() =>
    emitRequesterRequests(requesterId, entry)
  );

  const requestsQuery = query(
    collection(db, REQUESTS_COLLECTION),
    where('requester_id', '==', requesterId)
  );

  entry.unsubscribeFirestore = onSnapshot(
    requestsQuery,
    (snapshot) => {
      entry.firestoreRequests = snapshot.docs.map((item) =>
        normalizeRequest(item.id, item.data())
      );
      emitRequesterRequests(requesterId, entry);
    },
    (error) => {
      console.log('Requests Firestore subscription error:', error.message);
      entry.subscribers.forEach(({ onError }) => onError?.(error));
      emitRequesterRequests(requesterId, entry, true);
    }
  );
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

  if (entry.cachedRequests) {
    listener(entry.cachedRequests);
  } else {
    emitRequesterRequests(normalizedRequesterId, entry, true);
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

const buildLocalRequest = (id, payload) => {
  const now = new Date().toISOString();

  return normalizeRequest(id, {
    ...payload,
    id,
    created_at: now,
    updated_at: now,
    isLocal: true,
  });
};

export const createRequest = async (requestData) => {
  const requestRef = doc(collection(db, REQUESTS_COLLECTION));
  const requesterId = (requestData.requester_id || '').toString().trim();
  const items = normalizeItems(requestData);
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalCost =
    normalizeAmount(requestData.total_cost) ||
    items.reduce((sum, item) => sum + item.line_total, 0);
  const firstItem = items[0] || {};

  const requestPayload = {
    request_id: createRequestNumber(),
    requester_id: requesterId,
    requester_unique_id:
      (requestData.requester_unique_id || requestData.requesterUniqueId || '')
        .toString()
        .trim(),
    requester_name: requestData.requester_name,
    distributor_id:
      (requestData.distributor_id || requestData.distributorId || '')
        .toString()
        .trim(),
    distributor_unique_id:
      (requestData.distributor_unique_id || requestData.distributorUniqueId || '')
        .toString()
        .trim(),
    distributor_name: requestData.distributor_name || requestData.distributorName || '',
    contact_number: requestData.contact_number,
    address: requestData.address,
    product_id: firstItem.product_id || requestData.product_id || '',
    product_name:
      requestData.product_name ||
      items.map((item) => item.product_name).filter(Boolean).join(', '),
    product_price: normalizeAmount(firstItem.product_price || requestData.product_price),
    quantity: totalQuantity || normalizeAmount(requestData.quantity),
    items,
    container: requestData.container,
    water_station: requestData.water_station,
    delivery_date: requestData.delivery_date,
    total_cost: totalCost,
    status: 'Pending',
    created_at: serverTimestamp(),
    updated_at: serverTimestamp(),
  };

  try {
    await setDoc(requestRef, requestPayload);
    removeLocalRequest(requestRef.id);

    return normalizeRequest(requestRef.id, requestPayload);
  } catch (error) {
    const localRequest = buildLocalRequest(requestRef.id, requestPayload);
    upsertLocalRequest(localRequest);

    error.savedLocal = true;
    error.localRequest = localRequest;
    throw error;
  }
};

export const cancelRequest = async (request) => {
  const requestId = typeof request === 'string' ? request : request?.id;

  if (!requestId) {
    throw new Error('Request is missing an ID.');
  }

  const matchingLocalRequest = getLocalRequests().find(
    (localRequest) => localRequest.id === requestId
  );
  const requestData =
    typeof request === 'string'
      ? matchingLocalRequest
      : { ...(matchingLocalRequest || {}), ...request };
  const normalizedRequest = normalizeRequest(requestId, requestData);

  if (normalizedRequest.status.toLowerCase() !== 'pending') {
    throw new Error('Only pending requests can be canceled.');
  }

  const canceledAt = new Date().toISOString();
  const canceledRequest = normalizeRequest(requestId, {
    ...normalizedRequest,
    status: 'Cancelled',
    updated_at: canceledAt,
    canceled_at: canceledAt,
    isLocal: true,
  });

  if (normalizedRequest.isLocal) {
    upsertLocalRequest(canceledRequest);
    return canceledRequest;
  }

  try {
    await setDoc(
      doc(db, REQUESTS_COLLECTION, requestId),
      {
        status: 'Cancelled',
        updated_at: serverTimestamp(),
        canceled_at: serverTimestamp(),
      },
      { merge: true }
    );
    removeLocalRequest(requestId);

    return {
      ...normalizedRequest,
      status: 'Cancelled',
      updated_at: canceledAt,
      canceled_at: canceledAt,
    };
  } catch (error) {
    upsertLocalRequest(canceledRequest);

    error.savedLocal = true;
    error.localRequest = canceledRequest;
    throw error;
  }
};
