import React from 'react';
import ManagerShell from '../../components/ManagerShell';
import ModerationWorkspace from '../../components/ModerationWorkspace';

export default function ManagerReportsSafetyPage() {
  return <ManagerShell active="reports" title="Reports & Safety" subtitle="Review reports and ordering-abuse signals for your assigned branch only."><ModerationWorkspace role="manager" /></ManagerShell>;
}
