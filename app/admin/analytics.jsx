import { Redirect } from 'expo-router';
// Keep one canonical Admin landing page. This legacy URL must never cross into
// the Manager route tree, whose guard correctly rejects an Admin identity.
export default function LegacyAdminAnalyticsRedirect() { return <Redirect href="/admin/dashboard" />; }
