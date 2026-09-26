import React from 'react';

import { DistributorBottomNav } from '../../components/AppBottomNav';
import RoleGate from '../../components/RoleGate';
import UserPortalShell from '../../components/UserPortalShell';
import { DistributorDataProvider } from '../../components/RoleDataProviders';

export default function DistributorLayout() {
  return (
    <RoleGate role="distributor">
      <DistributorDataProvider>
        <UserPortalShell navigation={<DistributorBottomNav />} />
      </DistributorDataProvider>
    </RoleGate>
  );
}
