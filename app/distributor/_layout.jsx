import React from 'react';

import { DistributorBottomNav } from '../../components/AppBottomNav';
import RoleGate from '../../components/RoleGate';
import UserPortalShell from '../../components/UserPortalShell';

export default function DistributorLayout() {
  return (
    <RoleGate role="distributor">
      <UserPortalShell navigation={<DistributorBottomNav />} />
    </RoleGate>
  );
}
