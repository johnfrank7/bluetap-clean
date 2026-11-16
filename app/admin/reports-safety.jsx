import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import AdminShell from '../../components/AdminShell';
import AdminDeliveryAppealsWorkspace from '../../components/AdminDeliveryAppealsWorkspace';
import ModerationWorkspace from '../../components/ModerationWorkspace';
import { useAdminTheme } from '../../components/AdminTheme';

export default function AdminReportsSafetyPage() {
  const { colors } = useAdminTheme();
  const params = useLocalSearchParams();
  const attemptId = typeof params.attemptId === 'string' ? params.attemptId : '';
  const [section, setSection] = React.useState(attemptId ? 'appeals' : 'reports');
  const [safetyKind, setSafetyKind] = React.useState('reports');
  const [visitedSafety, setVisitedSafety] = React.useState(!attemptId);
  const [visitedAppeals, setVisitedAppeals] = React.useState(Boolean(attemptId));
  React.useEffect(() => { if (attemptId) { setVisitedAppeals(true); setSection('appeals'); } }, [attemptId]);
  return <AdminShell title="Reports & Safety" subtitle="Review safety cases and delivery appeals with audited decisions.">
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 10 }}>
      {[['reports', 'Chat Reports'], ['abuse', 'Ordering Abuse Review'], ['appeals', 'Delivery Appeals']].map(([value, label]) =>
        <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: section === value }} dataSet={{ safetyChoice: section === value ? 'selected' : undefined }}
          onPress={() => { if (value === 'appeals') setVisitedAppeals(true); else { setVisitedSafety(true); setSafetyKind(value); } setSection(value); }} style={{ minHeight: 44, justifyContent: 'center', borderRadius: 10,
            borderWidth: 1, borderColor: section === value ? colors.primary : colors.border,
            backgroundColor: section === value ? colors.primarySoft : colors.surfaceAlt, paddingHorizontal: 15 }}>
          <Text style={{ color: colors.textPrimary, fontWeight: '800' }}>{label}</Text>
        </Pressable>)}
    </View>
    {visitedSafety && <View style={{ display: section === 'appeals' ? 'none' : 'flex' }}><ModerationWorkspace role="admin" initialKind={safetyKind} hideWorkflowTabs /></View>}
    {visitedAppeals && <View style={{ display: section === 'appeals' ? 'flex' : 'none' }}><AdminDeliveryAppealsWorkspace targetAttemptId={attemptId} /></View>}
  </AdminShell>;
}
