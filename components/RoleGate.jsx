import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { onAuthStateChanged, signOut } from 'firebase/auth';

import { auth } from '../firebase';
import {
  clearAllAuthSessions,
  clearModuleSession,
  getCachedPrivilegedAccess,
  validateRoleAccess,
} from '../services/authSession';

export default function RoleGate({ role, allowedRoles, children, bypass = false }) {
  const router = useRouter();
  const routerRef = useRef(router);
  routerRef.current = router;
  const allowedRolesKey = (Array.isArray(allowedRoles) && allowedRoles.length
    ? allowedRoles
    : [role]).join(',');
  const validationRunRef = useRef(0);
  const redirectTimerRef = useRef(null);
  const [gateState, setGateState] = useState({
    status: 'checking',
    message: '',
  });

  const validateAccess = useCallback(async () => {
    const runId = validationRunRef.current + 1;
    validationRunRef.current = runId;

    if (redirectTimerRef.current) {
      clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = null;
    }

    setGateState({ status: 'checking', message: '' });

    const roles = allowedRolesKey.split(',').filter(Boolean);
    let result = null;
    for (const allowedRole of roles) {
      if (allowedRole === 'admin' || allowedRole === 'manager') {
        console.info('[role-validation]', {
          stage: `${allowedRole.toUpperCase()}_VALIDATION_CALLED_FROM_ROLEGATE`,
        });
      }
      result = await validateRoleAccess(allowedRole);
      if (result.status === 'authorized') break;
    }

    if (validationRunRef.current !== runId) return;

    if (result.status === 'authorized') {
      setGateState({ status: 'authorized', message: '' });
      return;
    }

    if (result.clearRole) {
      clearModuleSession(result.clearRole);
    }

    if (result.shouldSignOut) {
      clearAllAuthSessions();

      try {
        await signOut(auth);
      } catch (error) {
        console.log('Unauthorized sign out error:', error.message);
      }
    }

    if (validationRunRef.current !== runId) return;

    setGateState({
      status: result.status || 'unauthorized',
      message: result.message || 'Unauthorized Access',
    });

    redirectTimerRef.current = setTimeout(() => {
      routerRef.current.replace(result.redirectTo || '/login');
    }, 0);
  }, [allowedRolesKey]);

  useEffect(() => {
    if (bypass) {
      validationRunRef.current += 1;
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
      redirectTimerRef.current = null;
      setGateState({ status: 'bypassed', message: '' });
      return undefined;
    }

    setGateState({ status: 'checking', message: '' });
    const unsubscribeAuth = onAuthStateChanged(auth, () => {
      setGateState({ status: 'checking', message: '' });
      validateAccess();
    });

    return () => {
      validationRunRef.current += 1;
      unsubscribeAuth();

      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
      }
    };
  }, [bypass, validateAccess]);

  if (bypass) return children;

  // Preserve the mounted navigator during the login-to-dashboard handoff.
  // This is the same UID/role/TTL-checked cache used by validateRoleAccess.
  if (allowedRolesKey.split(',').some((allowedRole) =>
    getCachedPrivilegedAccess(auth.currentUser, allowedRole))) return children;

  if (gateState.status !== 'authorized') {
    const isChecking = gateState.status === 'checking';

    return (
      <View style={styles.gate}>
        {isChecking ? (
          <ActivityIndicator size="large" color="#187BCD" />
        ) : (
          <Text style={styles.message}>{gateState.message}</Text>
        )}
      </View>
    );
  }

  return children;
}

const styles = StyleSheet.create({
  gate: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
  message: {
    color: '#187BCD',
    fontSize: 18,
    fontWeight: 'bold',
    textAlign: 'center',
  },
});
