import React from 'react';
import { RequesterBottomNav } from '../../components/AppBottomNav';
import RequesterHeader from '../../components/RequesterHeader';
import RoleGate from '../../components/RoleGate';
import UserPortalShell from '../../components/UserPortalShell';
import { RequesterDataProvider } from '../../components/RoleDataProviders';

export default function RequesterLayout() {
  return (
    <RoleGate role="requester">
      <RequesterDataProvider>
        <UserPortalShell
          header={<RequesterHeader />}
          navigation={<RequesterBottomNav />}
        />
      </RequesterDataProvider>
    </RoleGate>
  );
}
