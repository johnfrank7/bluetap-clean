import React from 'react';
import { RequesterBottomNav } from '../../components/AppBottomNav';
import RequesterHeader from '../../components/RequesterHeader';
import RoleGate from '../../components/RoleGate';
import UserPortalShell from '../../components/UserPortalShell';
import { RequesterDataProvider } from '../../components/RoleDataProviders';
import ChatDataProvider from '../../components/chat/ChatDataProvider';

export default function RequesterLayout() {
  return (
    <RoleGate role="requester">
      <RequesterDataProvider>
        <ChatDataProvider role="requester">
          <UserPortalShell
            header={<RequesterHeader />}
            navigation={<RequesterBottomNav />}
          />
        </ChatDataProvider>
      </RequesterDataProvider>
    </RoleGate>
  );
}
