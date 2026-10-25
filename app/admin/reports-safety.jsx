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
  const [section, setSection] = React.useState(attemptId ? 'appeals' : 'safety');
  React.useEffect(() => { if (attemptId) setSection('appeals'); }, [attemptId]);
  return <AdminShell title="Reports & Safety" subtitle="Review safety cases and delivery appeals with audited decisions.">
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingTop: 10 }}>
      {[['safety', 'Safety cases'], ['appeals', 'Delivery appeals']].map(([value, label]) =>
        <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: section === value }}
          onPress={() => setSection(value)} style={{ minHeight: 44, justifyContent: 'center', borderRadius: 10,
            borderWidth: 1, borderColor: section === value ? colors.primary : colors.border,
            backgroundColor: section === value ? colors.primarySoft : colors.surfaceAlt, paddingHorizontal: 15 }}>
          <Text style={{ color: section === value ? colors.primary : colors.textPrimary, fontWeight: '800' }}>{label}</Text>
        </Pressable>)}
    </View>
    {section === 'appeals' ? <AdminDeliveryAppealsWorkspace targetAttemptId={attemptId} /> : <ModerationWorkspace role="admin" />}
  </AdminShell>;
}
