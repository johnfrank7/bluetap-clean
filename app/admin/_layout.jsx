import React from 'react';
import { Stack } from 'expo-router';
import RoleGate from '../../components/RoleGate';

export default function AdminLayout() {
  return <RoleGate allowedRoles={["admin"]}><Stack screenOptions={{ headerShown: false }} /></RoleGate>;
}
