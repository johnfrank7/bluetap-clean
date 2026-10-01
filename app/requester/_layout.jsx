import React from 'react';
import { RequesterBottomNav } from '../../components/AppBottomNav';
import RequesterHeader from '../../components/RequesterHeader';
import RoleGate from '../../components/RoleGate';
import UserPortalShell from '../../components/UserPortalShell';
import { RequesterDataProvider } from '../../components/RoleDataProviders';
import ChatDataProvider from '../../components/chat/ChatDataProvider';
import { RoleNotificationProvider } from '../../components/RoleNotifications';

export default function RequesterLayout() {
  return (
    <RoleGate role="requester">
      <RequesterDataProvider>
        <ChatDataProvider role="requester">
          <RoleNotificationProvider role="requester">
            <UserPortalShell
              header={<RequesterHeader />}
              navigation={<RequesterBottomNav />}
            />
          </RoleNotificationProvider>
        </ChatDataProvider>
      </RequesterDataProvider>
    </RoleGate>
  );
}
