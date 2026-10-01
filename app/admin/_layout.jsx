import React from 'react';
import { Stack, usePathname } from 'expo-router';
import RoleGate from '../../components/RoleGate';
import { AdminThemeProvider } from '../../components/AdminTheme';
import AdminShell from '../../components/AdminShell';
import { AdminRouteSkeleton } from '../../components/AdminSkeleton';
import { AdminDataProvider } from '../../components/AdminDataProvider';

const routeCopy = {
  '/admin/dashboard': ['Administrator Dashboard', 'Loading secure administration overview…'],
  '/admin/branches': ['Branches', 'Loading branch workspace…'],
  '/admin/managers': ['Accounts & Audit', 'Loading account workspace…'],
  '/admin/distributors': ['Distributor Management', 'Loading distributor workspace…'],
  '/admin/registration-security': ['Security Settings', 'Loading security policy…'],
  '/admin/system-maintenance': ['System Maintenance', 'Loading data retention controls…'],
  '/admin/reports-safety': ['Reports & Safety', 'Loading the moderation queue…'],
};

export default function AdminLayout() {
  const pathname = usePathname();
  const [title, subtitle] = routeCopy[pathname] || ['BlueTap Administration', 'Validating administrator access…'];
  return (
    <AdminThemeProvider>
      <RoleGate allowedRoles={["admin"]} bypass={pathname === '/admin/login'} loadingFallback={<AdminShell title={title} subtitle={subtitle}><AdminRouteSkeleton /></AdminShell>}>
        <AdminDataProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </AdminDataProvider>
      </RoleGate>
    </AdminThemeProvider>
  );
}
