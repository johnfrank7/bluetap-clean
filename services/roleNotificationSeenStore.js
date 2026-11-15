function createRoleNotificationSeenStore(storage, limit = 500) {
  const memory = new Map();
  const subscribers = new Map();
  const writes = new Map();
  const keyFor = (role, uid) => uid ? `bluetap_${role}_notification_seen_${uid}` : '';

  async function read(key) {
    if (!key) return new Set();
    try {
      const stored = await storage.getItem(key);
      if (memory.has(key)) return new Set(memory.get(key));
      if (stored) {
        const ids = JSON.parse(stored);
        if (Array.isArray(ids)) return new Set(ids.filter((id) => typeof id === 'string').slice(-limit));
      }
    } catch {}
    return new Set(memory.get(key) || []);
  }

  async function write(key, values) {
    if (!key) return;
    const bounded = [...values].slice(-limit);
    memory.set(key, bounded);
    (subscribers.get(key) || new Set()).forEach((listener) => listener(new Set(bounded)));
    const operation = (writes.get(key) || Promise.resolve())
      .then(() => storage.setItem(key, JSON.stringify(bounded))).catch(() => {});
    writes.set(key, operation);
    await operation;
    if (writes.get(key) === operation) writes.delete(key);
  }

  function subscribe(key, listener) {
    if (!key) return () => {};
    const listeners = subscribers.get(key) || new Set();
    listeners.add(listener);
    subscribers.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) subscribers.delete(key);
    };
  }

  return { keyFor, read, write, subscribe };
}

module.exports = { createRoleNotificationSeenStore };
