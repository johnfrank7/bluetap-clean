let fallbackSequence = 0;

function createMutationId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  if (typeof globalThis.crypto?.getRandomValues !== 'function') {
    // This is a retry correlation ID, never an authentication or authorization token.
    fallbackSequence += 1;
    return `report_${Date.now().toString(36)}_${fallbackSequence.toString(36)}_${Math.random().toString(36).slice(2)}`;
  }
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createDeliveryReportSubmission({ send, readOrder, makeId = createMutationId }) {
  let pending = null;
  let inFlight = false;
  return {
    hasPending: () => Boolean(pending),
    cancel: () => { if (!inFlight) pending = null; },
    async submit(orderId, draft) {
      if (inFlight) return { ignored: true };
      inFlight = true;
      try {
        if (!pending) {
          pending = { orderId, payload: { ...JSON.parse(JSON.stringify(draft)), clientMutationId: makeId() }, uncertain: false };
        }
        if (pending.orderId !== orderId) throw new Error('Finish the pending delivery report first.');
        if (pending.uncertain) {
          let order;
          try { order = await readOrder(orderId); }
          catch (error) { error.retryCheckFailed = true; throw error; }
          const status = String(order?.status || '').trim().toLowerCase();
          if (!['out_for_delivery', 'delivery_failed'].includes(status)) {
            pending = null;
            const error = new Error('This delivery changed. Refresh the dashboard before reporting again.');
            error.code = 'DELIVERY_REPORT_STALE';
            throw error;
          }
        }
        const result = await send(orderId, pending.payload);
        pending = null;
        return { order: result };
      } catch (error) {
        if (pending) {
          if (error?.uncertain || error?.retryCheckFailed) pending.uncertain = true;
          else pending = null;
        }
        throw error;
      } finally {
        inFlight = false;
      }
    },
  };
}

module.exports = { createMutationId, createDeliveryReportSubmission };
