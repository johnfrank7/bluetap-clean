import React from 'react';
import { loadModerationCases } from '../services/moderationApi';
import { subscribeModerationActivity } from '../services/moderationRealtime';
import { useManagerRealtimeData } from './ManagerRealtimeData';

export function useModerationActivitySignal(role) {
  const { branchId } = useManagerRealtimeData();
  const [revision, setRevision] = React.useState('');
  React.useEffect(() => subscribeModerationActivity({
    role,
    branchId: role === 'manager' ? branchId : '',
    onChange: (signal) => setRevision(`${signal.id}:${signal.revision}:${Date.now()}`),
  }), [branchId, role]);
  return revision;
}

export default function useModerationActivityBadge(role) {
  const [count, setCount] = React.useState(0);
  const revision = useModerationActivitySignal(role);
  React.useEffect(() => {
    let active = true;
    loadModerationCases(role, { status: 'active', limit: 50 })
      .then((result) => { if (active) setCount((result.reports || []).length); })
      .catch(() => { if (active) setCount(0); });
    return () => { active = false; };
  }, [revision, role]);
  return count;
}
