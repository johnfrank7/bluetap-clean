const { mergeReportPages, projectReportPage } = require('./requesterReportNotifications');

const PAGE_SIZE = 20;
const MAX_CONTINUATION_PAGES = 3;
const REFRESH_INTERVAL_MS = 30_000;

const emptyState = (uid = '') => ({
  uid, events: [], nextCursor: null, hasMore: false, historyComplete: false,
  loaded: false, loading: false, loadingMore: false, error: '',
});

function combineLoadedNotifications(baseEvents = [], reportEvents = []) {
  const byId = new Map();
  for (const event of [...baseEvents, ...reportEvents]) {
    if (event?.id && !byId.has(event.id)) byId.set(event.id, event);
  }
  return [...byId.values()].sort((left, right) =>
    right.at.getTime() - left.at.getTime() || right.id.localeCompare(left.id));
}

function countLoadedUnseen(events, seen) {
  return events.filter((event) => !seen.has(event.id)).length;
}

function createRequesterReportFeed({ fetchPage, now = Date.now, pageSize = PAGE_SIZE,
  maxContinuationPages = MAX_CONTINUATION_PAGES, refreshIntervalMs = REFRESH_INTERVAL_MS }) {
  let state = emptyState();
  let generation = 0;
  let inFlight = null;
  let lastAttempt = -Infinity;
  const listeners = new Set();
  const publish = (next) => {
    state = next;
    listeners.forEach((listener) => listener(state));
  };

  async function loadBatch(uid, startingCursor) {
    let cursor = startingCursor;
    let loaded = { events: [], nextCursor: cursor || null, hasMore: Boolean(cursor), historyComplete: false };
    const visited = new Set(cursor ? [cursor] : []);
    for (let pageNumber = 0; pageNumber < maxContinuationPages; pageNumber += 1) {
      const page = projectReportPage(await fetchPage(uid, { cursor, limit: pageSize }));
      if (!page) throw new Error('Delivery reports returned an invalid page. Please retry.');
      if (page.nextCursor && visited.has(page.nextCursor)) {
        throw new Error('Delivery report pagination did not advance. Please retry.');
      }
      if (page.nextCursor) visited.add(page.nextCursor);
      loaded = mergeReportPages(loaded, page);
      if (loaded.events.length || !page.hasMore) break;
      cursor = page.nextCursor;
    }
    return loaded;
  }

  function setUid(uid) {
    const nextUid = typeof uid === 'string' ? uid.trim() : '';
    if (state.uid === nextUid) return;
    generation += 1;
    inFlight = null;
    lastAttempt = -Infinity;
    publish(emptyState(nextUid));
  }

  function run(kind, force = false) {
    if (!state.uid) return Promise.resolve(state);
    if (inFlight) return inFlight;
    if (kind === 'more' && (!state.loaded || !state.nextCursor)) return Promise.resolve(state);
    if (kind === 'refresh' && !force && now() - lastAttempt < refreshIntervalMs) return Promise.resolve(state);
    const uid = state.uid;
    const requestGeneration = generation;
    const cursor = kind === 'more' ? state.nextCursor : '';
    if (kind === 'refresh') lastAttempt = now();
    publish({ ...state, loading: kind === 'refresh', loadingMore: kind === 'more', error: '' });
    const operation = (async () => {
      try {
        const page = await loadBatch(uid, cursor);
        if (requestGeneration !== generation || state.uid !== uid) return state;
        const merged = kind === 'more' ? mergeReportPages(state, page)
          : state.loaded ? mergeReportPages(page, state) : page;
        publish({ ...state, events: merged.events, nextCursor: merged.nextCursor,
          hasMore: merged.hasMore, historyComplete: merged.historyComplete,
          loaded: true, loading: false, loadingMore: false, error: '' });
      } catch (error) {
        if (requestGeneration === generation && state.uid === uid) {
          publish({ ...state, loading: false, loadingMore: false,
            error: error?.message || 'Delivery reports could not be loaded. Please retry.' });
        }
      } finally {
        if (inFlight === operation) inFlight = null;
      }
      return state;
    })();
    inFlight = operation;
    return operation;
  }

  return {
    getState: () => state,
    setUid,
    refresh: ({ force = false } = {}) => run('refresh', force),
    loadOlder: () => run('more'),
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
  };
}

module.exports = {
  PAGE_SIZE, MAX_CONTINUATION_PAGES, REFRESH_INTERVAL_MS,
  combineLoadedNotifications, countLoadedUnseen, createRequesterReportFeed,
};
