import React from 'react';
import { RequesterBottomNav } from '../../components/AppBottomNav';
import RequesterHeader from '../../components/RequesterHeader';
import RoleGate from '../../components/RoleGate';
import UserPortalShell from '../../components/UserPortalShell';

export default function RequesterLayout() {
  return (
    <RoleGate role="requester">
      <UserPortalShell
        header={<RequesterHeader />}
        navigation={<RequesterBottomNav />}
      />
    </RoleGate>
  );
}
