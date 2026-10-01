import React from 'react';
import { loadModerationCases } from '../services/moderationApi';

export default function useModerationActivityBadge(role) {
  const [count, setCount] = React.useState(0);
  React.useEffect(() => {
    let active = true;
    loadModerationCases(role, { status: role === 'admin' ? 'escalated' : 'open', limit: 50 })
      .then((result) => { if (active) setCount((result.reports || []).length); })
      .catch(() => { if (active) setCount(0); });
    return () => { active = false; };
  }, [role]);
  return count;
}
