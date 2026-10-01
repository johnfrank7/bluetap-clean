import React from 'react';

import { DistributorBottomNav } from '../../components/AppBottomNav';
import RoleGate from '../../components/RoleGate';
import UserPortalShell from '../../components/UserPortalShell';
import { DistributorDataProvider } from '../../components/RoleDataProviders';
import ChatDataProvider from '../../components/chat/ChatDataProvider';
import { RoleNotificationProvider } from '../../components/RoleNotifications';

export default function DistributorLayout() {
  return (
    <RoleGate role="distributor">
      <DistributorDataProvider>
        <ChatDataProvider role="distributor">
          <RoleNotificationProvider role="distributor">
            <UserPortalShell navigation={<DistributorBottomNav />} />
          </RoleNotificationProvider>
        </ChatDataProvider>
      </DistributorDataProvider>
    </RoleGate>
  );
}
