import React from 'react';
import { Stack, usePathname } from 'expo-router';

import RoleGate from '../../components/RoleGate';
import { AdminThemeProvider } from '../../components/AdminTheme';
import { ManagerRealtimeDataProvider } from '../../components/ManagerRealtimeData';
import { ManagerNotificationsProvider } from '../../components/ManagerNotifications';
import ChatDataProvider from '../../components/chat/ChatDataProvider';

export default function ManagerLayout() {
  const pathname = usePathname();
  return (
    <AdminThemeProvider>
      <RoleGate allowedRoles={["manager"]} bypass={pathname === '/manager/login'}>
        <ManagerRealtimeDataProvider>
          <ChatDataProvider role="manager">
            <ManagerNotificationsProvider>
              <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
            </ManagerNotificationsProvider>
          </ChatDataProvider>
        </ManagerRealtimeDataProvider>
      </RoleGate>
    </AdminThemeProvider>
  );
}
