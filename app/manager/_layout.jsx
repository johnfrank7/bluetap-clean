import React from 'react';
import { Stack } from 'expo-router';

import RoleGate from '../../components/RoleGate';

export default function ManagerLayout() {
  return (
    <RoleGate allowedRoles={["manager"]}>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: 'none',
        }}
      />
    </RoleGate>
  );
}
