import React from 'react';

import { getFaceServiceStatus } from './faceVerification';
const { faceServiceWarmupStore } = require('./faceServiceWarmupStore');

export function useFaceServiceWarmup(registrationSessionId, required) {
  const [snapshot, setSnapshot] = React.useState(() => faceServiceWarmupStore.getSnapshot(required));

  React.useEffect(() => {
    const unsubscribe = faceServiceWarmupStore.subscribe(() => setSnapshot(faceServiceWarmupStore.getSnapshot(required)));
    setSnapshot(faceServiceWarmupStore.getSnapshot(required));
    faceServiceWarmupStore.start({ registrationSessionId, required, checkStatus: getFaceServiceStatus });
    return unsubscribe;
  }, [registrationSessionId, required]);

  const checkAgain = React.useCallback(() => {
    faceServiceWarmupStore.retry({ registrationSessionId, required, checkStatus: getFaceServiceStatus });
  }, [registrationSessionId, required]);

  return { status: snapshot.status, checkAgain };
}
