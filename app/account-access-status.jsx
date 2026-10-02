import React from 'react';
import { useLocalSearchParams, useRouter } from 'expo-router';

import AccountAccessState from '../components/AccountAccessState';

export default function AccountAccessStatusPage() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const requested = Array.isArray(params.state) ? params.state[0] : params.state;
  const state = ['suspended', 'terminated', 'inactive'].includes(requested) ? requested : 'inactive';
  return <AccountAccessState state={state} onBack={() => router.replace('/login')} />;
}
