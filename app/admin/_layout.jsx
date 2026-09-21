import React from 'react';
import { Stack, usePathname } from 'expo-router';
import RoleGate from '../../components/RoleGate';
import { AdminThemeProvider } from '../../components/AdminTheme';

export default function AdminLayout() {
  const pathname = usePathname();
  return (
    <AdminThemeProvider>
      <RoleGate allowedRoles={["admin"]} bypass={pathname === '/admin/login'}>
        <Stack screenOptions={{ headerShown: false }} />
      </RoleGate>
    </AdminThemeProvider>
  );
}
