import React from 'react';
import { Stack, usePathname } from 'expo-router';

import RoleGate from '../../components/RoleGate';
import { AdminThemeProvider } from '../../components/AdminTheme';
import { ManagerRealtimeDataProvider } from '../../components/ManagerRealtimeData';

export default function ManagerLayout() {
  const pathname = usePathname();
  return (
    <AdminThemeProvider>
      <RoleGate allowedRoles={["manager"]} bypass={pathname === '/manager/login'}>
        <ManagerRealtimeDataProvider>
          <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
        </ManagerRealtimeDataProvider>
      </RoleGate>
    </AdminThemeProvider>
  );
}
