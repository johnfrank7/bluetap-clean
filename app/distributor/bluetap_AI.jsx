import React, { useMemo } from 'react';
import { useDistributorData } from '../../components/RoleDataProviders';
import { useModerationNotices } from '../../components/ModerationNotices';
import { useRoleNotifications } from '../../components/RoleNotifications';
import { buildSafeDistributorContext } from '../../services/assistant/assistantContext';
import AssistantScreen from '../../components/assistant/AssistantScreen';

export function DistributorBlueTapAIPage() {
  const distributorData = useDistributorData();
  const moderationNotices = useModerationNotices();
  const roleNotifications = useRoleNotifications();

  const safeContext = useMemo(() => {
    return buildSafeDistributorContext({
      distributorData,
      moderationNotices,
      roleNotifications,
    });
  }, [distributorData, moderationNotices, roleNotifications]);

  const userId =
    safeContext?.distributor?.userId ||
    distributorData?.uid ||
    safeContext?.distributor?.publicId ||
    'anonymous';

  return (
    <AssistantScreen
      role="distributor"
      safeContext={safeContext}
      userId={userId}
      backRoute="/distributor/d_profile"
      title="BlueTap Assistant"
      subtitle="Deliveries, schedule & route help"
      detailOrders={distributorData.orders}
    />
  );
}

export default DistributorBlueTapAIPage;
