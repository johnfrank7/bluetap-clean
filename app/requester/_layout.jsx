import React from 'react';
import { usePathname } from 'expo-router';
import { RequesterBottomNav } from '../../components/AppBottomNav';
import RequesterHeader from '../../components/RequesterHeader';
import RoleGate from '../../components/RoleGate';
import UserPortalShell from '../../components/UserPortalShell';
import { RequesterDataProvider } from '../../components/RoleDataProviders';
import ChatDataProvider from '../../components/chat/ChatDataProvider';
import { RoleNotificationProvider } from '../../components/RoleNotifications';
import { ModerationNoticeProvider } from '../../components/ModerationNotices';

export default function RequesterLayout() {
  const pathname = usePathname();
  const assistantOpen = pathname === '/requester/bluetap_AI';
  return (
    <RoleGate role="requester">
      <RequesterDataProvider>
        <ModerationNoticeProvider><ChatDataProvider role="requester">
          <RoleNotificationProvider role="requester">
            <UserPortalShell
              header={assistantOpen ? null : <RequesterHeader />}
              navigation={<RequesterBottomNav />}
            />
          </RoleNotificationProvider>
        </ChatDataProvider></ModerationNoticeProvider>
      </RequesterDataProvider>
    </RoleGate>
  );
}
