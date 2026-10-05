import React from 'react';
import { usePathname, useRouter } from 'expo-router';

const { createSingleFlightNavigation } = require('../services/navigationLock');

export default function useSingleFlightNavigation() {
  const router = useRouter();
  const pathname = usePathname();
  const routerRef = React.useRef(router);
  const pathnameRef = React.useRef(pathname);
  const navigationRef = React.useRef(null);
  routerRef.current = router;
  pathnameRef.current = pathname;
  if (!navigationRef.current) navigationRef.current = createSingleFlightNavigation();

  React.useEffect(() => {
    navigationRef.current.settle(pathname);
  }, [pathname]);

  React.useEffect(() => () => navigationRef.current?.dispose(), []);

  const run = React.useCallback((target, method) => navigationRef.current.navigate({
    action: (destination) => routerRef.current[method](destination),
    currentPath: pathnameRef.current,
    target,
  }), []);

  const navigateOnce = React.useCallback((target) => run(target, 'push'), [run]);
  const replaceOnce = React.useCallback((target) => run(target, 'replace'), [run]);

  return { navigateOnce, replaceOnce };
}
