import React from 'react';

import { getFaceServiceStatus } from './faceVerification';

const {
  FACE_SERVICE_POLL_INTERVAL_MS,
  shouldContinueFaceWarmup,
} = require('./faceServiceWarmupCore');

export function useFaceServiceWarmup(registrationSessionId, required) {
  const [status, setStatus] = React.useState(required === false ? 'not_required' : 'idle');
  const [run, setRun] = React.useState(0);

  const checkAgain = React.useCallback(() => setRun((value) => value + 1), []);

  React.useEffect(() => {
    if (!required) {
      setStatus('not_required');
      return undefined;
    }
    if (!registrationSessionId) {
      setStatus('idle');
      return undefined;
    }

    let active = true;
    let timer;
    let attempts = 0;
    const startedAt = Date.now();
    setStatus('starting');

    const poll = async () => {
      if (attempts > 0 && !shouldContinueFaceWarmup({ required, status: 'starting', startedAt, now: Date.now() })) {
        if (active) setStatus('unavailable');
        return;
      }
      attempts += 1;
      let nextStatus = 'starting';
      try {
        const result = await getFaceServiceStatus(registrationSessionId);
        nextStatus = result?.status === 'ready' ? 'ready'
          : result?.status === 'not_required' ? 'not_required'
            : result?.status === 'unavailable' ? 'unavailable'
            : 'starting';
      } catch {
        nextStatus = 'starting';
      }
      if (!active) return;
      if (nextStatus === 'ready' || nextStatus === 'not_required' || nextStatus === 'unavailable') {
        setStatus(nextStatus);
        return;
      }
      if (!shouldContinueFaceWarmup({ required, status: nextStatus, startedAt, now: Date.now() })) {
        setStatus('unavailable');
        return;
      }
      setStatus('starting');
      timer = setTimeout(poll, FACE_SERVICE_POLL_INTERVAL_MS);
    };

    poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [registrationSessionId, required, run]);

  return { status, checkAgain };
}
