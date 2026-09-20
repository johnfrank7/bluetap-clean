import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';

import { auth } from '../firebase';
import { getRoleHomePath, validateRoleAccess } from '../services/authSession';

/**
 * Authenticated landing route used for direct links such as /home.
 * Role-specific layouts continue to protect every dashboard after this redirect.
 */
export default function HomeRoute() {
  const router = useRouter();

  React.useEffect(() => {
    let isActive = true;

    const redirectToHome = async () => {
      let result = await validateRoleAccess('admin');
      if (result.status !== 'authorized' && !auth.currentUser) {
        result = await validateRoleAccess('manager');
      }

      if (isActive) {
        const destination = result.status === 'authorized'
          ? getRoleHomePath(result.profile?.role)
          : result.redirectTo || '/login';
        router.replace(destination);
      }
    };

    // Wait for Firebase to restore a persisted browser session before deciding
    // whether the visitor should be sent to the login screen.
    const unsubscribe = onAuthStateChanged(auth, redirectToHome);

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [router]);

  return (
    <View style={styles.loading}>
      <ActivityIndicator size="large" color="#187BCD" />
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
  },
});
