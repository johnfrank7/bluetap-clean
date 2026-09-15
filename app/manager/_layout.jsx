import React from 'react';
import { Stack, usePathname } from 'expo-router';

import RoleGate from '../../components/RoleGate';

export default function ManagerLayout() {
  const pathname = usePathname();
  return (
    <RoleGate allowedRoles={["manager"]} bypass={pathname === '/manager/login'}>
      <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
    </RoleGate>
  );
}
