import React from 'react';
import { Stack, usePathname } from 'expo-router';
import RoleGate from '../../components/RoleGate';

export default function AdminLayout() {
  const pathname = usePathname();
  return (
    <RoleGate allowedRoles={["admin"]} bypass={pathname === '/admin/login'}>
      <Stack screenOptions={{ headerShown: false }} />
    </RoleGate>
  );
}
