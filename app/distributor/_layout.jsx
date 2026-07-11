import React from 'react';
import { Stack } from 'expo-router';

import RoleGate from '../../components/RoleGate';

export default function DistributorLayout() {
  return (
    <RoleGate role="distributor">
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'none',
        }}
      />
    </RoleGate>
  );
}
