import React from 'react';

import { DistributorBottomNav } from '../../components/AppBottomNav';
import RoleGate from '../../components/RoleGate';
import UserPortalShell from '../../components/UserPortalShell';
import { DistributorDataProvider } from '../../components/RoleDataProviders';
import ChatDataProvider from '../../components/chat/ChatDataProvider';
import { RoleNotificationProvider } from '../../components/RoleNotifications';
import { ModerationNoticeProvider } from '../../components/ModerationNotices';

export default function DistributorLayout() {
  return (
    <RoleGate role="distributor">
      <DistributorDataProvider>
        <ModerationNoticeProvider><ChatDataProvider role="distributor">
          <RoleNotificationProvider role="distributor">
            <UserPortalShell navigation={<DistributorBottomNav />} />
          </RoleNotificationProvider>
        </ChatDataProvider></ModerationNoticeProvider>
      </DistributorDataProvider>
    </RoleGate>
  );
}
