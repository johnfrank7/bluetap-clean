import React from 'react';

const { reconcilePresenceList } = require('../services/animatedPresence');

export const PRESENCE_DURATION_MS = 210;

export { reconcilePresenceList };

export function useAnimatedPresenceList(items, getId, duration = PRESENCE_DURATION_MS) {
  const getIdRef = React.useRef(getId);
  getIdRef.current = getId;
  const seenIdsRef = React.useRef(new Set());
  const timersRef = React.useRef(new Map());
  const [presented, setPresented] = React.useState(() => reconcilePresenceList(
    [],
    Array.isArray(items) ? items : [],
    getId,
    seenIdsRef.current
  ));

  React.useEffect(() => {
    setPresented((current) => reconcilePresenceList(
      current,
      Array.isArray(items) ? items : [],
      (item, index) => getIdRef.current(item, index),
      seenIdsRef.current
    ));
  }, [items]);

  React.useEffect(() => {
    const activeTimerKeys = new Set();
    presented.forEach((entry) => {
      if (entry.phase === 'present') return;
      const timerKey = `${entry.phase}:${entry.id}`;
      activeTimerKeys.add(timerKey);
      if (timersRef.current.has(timerKey)) return;
      const timer = setTimeout(() => {
        timersRef.current.delete(timerKey);
        setPresented((current) => entry.phase === 'exiting'
          ? current.filter((candidate) => candidate.id !== entry.id || candidate.phase !== 'exiting')
          : current.map((candidate) => candidate.id === entry.id && candidate.phase === 'entering'
            ? { ...candidate, phase: 'present' }
            : candidate));
      }, duration);
      timersRef.current.set(timerKey, timer);
    });

    timersRef.current.forEach((timer, key) => {
      if (!activeTimerKeys.has(key)) {
        clearTimeout(timer);
        timersRef.current.delete(key);
      }
    });
  }, [duration, presented]);

  React.useEffect(() => () => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current.clear();
  }, []);

  return presented;
}
