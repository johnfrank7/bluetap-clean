const timeOf = (value) => value?.toMillis?.() || value?.getTime?.()
  || Number(value?.seconds || value?._seconds || 0) * 1000
  || new Date(value || 0).getTime() || 0;

function shouldRefreshHistory(state, summaryVersion, now = Date.now()) {
  if (!state || state.loading || state.loadingMore) return false;
  if (state.error && state.summaryVersion === summaryVersion) return false;
  return !state.loaded || state.summaryVersion !== summaryVersion || now - state.refreshedAt > 60_000;
}

function visibleHistory(items, now = Date.now()) {
  return (items || []).filter((item) => timeOf(item.readAccessEndsAt || item.accessEndsAt) > now);
}

function appendHistoryPage(items, page) {
  const seen = new Set(items.map((item) => item.historyId));
  return [...items, ...(page || []).filter((item) => !seen.has(item.historyId))];
}

function verifiedHistoryPage(page) {
  const invalid = () => new Error('Chat History needs the updated BlueTap backend. Restart the local API and try again.');
  if (page?.view !== 'history' || !Array.isArray(page.conversations) || (page.nextCursor != null && typeof page.nextCursor !== 'string')) throw invalid();
  const seen = new Set();
  for (const item of page.conversations) {
    const orderId = String(item?.historyOrderId || '').trim();
    const status = String(item?.orderContext?.status || '').trim().toLowerCase();
    if (!item?.id || !item?.historyId || !orderId || !item?.readAccessEndsAt ||
      String(item.orderContext?.id || '').trim() !== orderId || !['delivered', 'completed'].includes(status) ||
      seen.has(item.historyId)) throw invalid();
    seen.add(item.historyId);
  }
  return page;
}

function runScopedHistoryRequest(inFlightRef, scope, operation) {
  if (inFlightRef.current?.scope === scope) return inFlightRef.current.promise;
  const promise = Promise.resolve().then(operation).finally(() => {
    if (inFlightRef.current?.promise === promise) inFlightRef.current = null;
  });
  inFlightRef.current = { scope, promise };
  return promise;
}

module.exports = { appendHistoryPage, runScopedHistoryRequest, shouldRefreshHistory, timeOf, verifiedHistoryPage, visibleHistory };
