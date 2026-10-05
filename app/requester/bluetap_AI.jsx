import React, { useState, useEffect, useMemo } from 'react';
import { useRequesterData } from '../../components/RoleDataProviders';
import { useModerationNotices } from '../../components/ModerationNotices';
import { useRoleNotifications } from '../../components/RoleNotifications';
import { buildSafeAssistantContext } from '../../services/assistant/assistantContext';
import { getActiveProducts } from '../../services/requesterOrdering';
import AssistantScreen from '../../components/assistant/AssistantScreen';

export function RequesterBlueTapAIPage() {
  const requesterData = useRequesterData();
  const moderationNotices = useModerationNotices();
  const roleNotifications = useRoleNotifications();
  const [catalogProducts, setCatalogProducts] = useState([]);

  useEffect(() => {
    let active = true;
    getActiveProducts()
      .then((items) => {
        if (active && Array.isArray(items)) setCatalogProducts(items);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const safeContext = useMemo(() => {
    return buildSafeAssistantContext({
      requesterData,
      moderationNotices,
      roleNotifications,
      catalogProducts,
    });
  }, [requesterData, moderationNotices, roleNotifications, catalogProducts]);

  const userId =
    safeContext?.requester?.userId ||
    requesterData?.uid ||
    safeContext?.requester?.publicId ||
    'anonymous';

  return (
    <AssistantScreen
      role="requester"
      safeContext={safeContext}
      userId={userId}
      backRoute="/requester/r_profile"
      title="BlueTap Assistant"
      subtitle="Orders, delivery & account help"
      detailOrders={requesterData.orders}
      detailBranches={requesterData.branches}
    />
  );
}

export default RequesterBlueTapAIPage;
