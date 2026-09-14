import React from 'react';
import { Stack, useSegments } from 'expo-router';

import RoleGate from '../../components/RoleGate';

export default function ManagerLayout() {
  const segments = useSegments();
  const stack = <Stack screenOptions={{ headerShown: false, animation: 'none' }} />;
  if (segments[segments.length - 1] === 'login') return stack;
  return (
    <RoleGate allowedRoles={["manager"]}>
      {stack}
    </RoleGate>
  );
}
