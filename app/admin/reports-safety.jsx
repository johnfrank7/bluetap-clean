import React from 'react';
import AdminShell from '../../components/AdminShell';
import ModerationWorkspace from '../../components/ModerationWorkspace';

export default function AdminReportsSafetyPage() {
  return <AdminShell title="Reports & Safety" subtitle="Review escalated safety cases and apply audited platform actions."><ModerationWorkspace role="admin" /></AdminShell>;
}
