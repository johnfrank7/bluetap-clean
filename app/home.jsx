import React from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { onAuthStateChanged } from 'firebase/auth';

import { auth } from '../firebase';
import { validateRoleAccess } from '../services/authSession';

/**
 * Authenticated landing route used for direct links such as /home.
 * Role-specific layouts continue to protect every dashboard after this redirect.
 */
export default function HomeRoute() {
  const router = useRouter();

  React.useEffect(() => {
    let isActive = true;

    const redirectToHome = async () => {
      const result = await validateRoleAccess('admin');

      if (isActive) {
        router.replace(result.redirectTo || '/admin/dashboard');
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
