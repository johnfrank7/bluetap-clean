import React from 'react';
import { Stack, useSegments } from 'expo-router';
import RoleGate from '../../components/RoleGate';

export default function AdminLayout() {
  const segments = useSegments();
  if (segments[segments.length - 1] === 'login') return <Stack screenOptions={{ headerShown: false }} />;
  return <RoleGate allowedRoles={["admin"]}><Stack screenOptions={{ headerShown: false }} /></RoleGate>;
}
