import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { onAuthStateChanged, signOut } from 'firebase/auth';

import { auth } from '../firebase';
import {
  clearAllAuthSessions,
  clearModuleSession,
  subscribeAuthSessionChanges,
  validateRoleAccess,
} from '../services/authSession';

export default function RoleGate({ role, allowedRoles, children }) {
  const router = useRouter();
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
      router.replace(result.redirectTo || '/login');
    }, 0);
  }, [allowedRolesKey, router]);

  useEffect(() => {
    let hasAuthStateLoaded = false;

    const unsubscribeAuth = onAuthStateChanged(auth, () => {
      hasAuthStateLoaded = true;
      setGateState({ status: 'checking', message: '' });
      validateAccess();
    });
    const unsubscribeSession = subscribeAuthSessionChanges(() => {
      if (hasAuthStateLoaded) {
        validateAccess();
      }
    });

    return () => {
      unsubscribeAuth();
      unsubscribeSession();

      if (redirectTimerRef.current) {
        clearTimeout(redirectTimerRef.current);
      }
    };
  }, [validateAccess]);

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
