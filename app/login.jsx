import { StatusBar } from 'expo-status-bar';
import React from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

import { auth, db } from '../firebase';
import { signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { findLocalUserByEmail, saveLocalUser } from '../localUsers';

const authErrorMessages = {
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/missing-password': 'Please enter your password.',
  'auth/network-request-failed': 'Network error. Please check your connection and try again.',
  'permission-denied': 'Your account was found, but the app cannot read your profile. Please check Firestore rules.',
};

const getAuthErrorMessage = (error) =>
  authErrorMessages[error?.code] || error?.message || 'Something went wrong. Please try again.';

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [pendingUser, setPendingUser] = React.useState(null);

  const goToRoleHome = (role) => {
    if (role === 'requester') {
      router.replace('/requester/r_dashboard');
    } else if (role === 'distributor') {
      router.replace('/distributor/d_dashboard');
    } else {
      Alert.alert('Login failed', 'This account has no valid role.');
    }
  };

  const handleLogin = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();

    if (!normalizedEmail || !trimmedPassword) {
      Alert.alert('Missing details', 'Please enter your email and password.');
      return;
    }

    try {
      setLoading(true);

      // Secret admin credentials (bypass Firebase, go straight to admin panel)
      if (normalizedEmail === 'bluetapadmin' && trimmedPassword === '12345678') {
        router.replace('/admin/dashboard');
        return;
      }

      // Regular login flow using Firebase Authentication
      const userCredential = await signInWithEmailAndPassword(
        auth,
        normalizedEmail,
        trimmedPassword
      );

      const user = userCredential.user;

      let userDoc = null;

      try {
        userDoc = await getDoc(doc(db, 'users', user.uid));
      } catch (error) {
        console.log('Login profile read error:', error.message);
      }

      if (!userDoc?.exists()) {
        const localUser = findLocalUserByEmail(normalizedEmail);

        if (localUser) {
          if (localUser.role === 'distributor' && localUser.approvalStatus !== 'approved') {
            await signOut(auth);
            Alert.alert(
              localUser.approvalStatus === 'rejected' ? 'Account rejected' : 'Pending approval',
              localUser.approvalStatus === 'rejected'
                ? 'Your distributor account was rejected by the admin.'
                : 'Your distributor account is still waiting for admin approval.'
            );
            return;
          }

          goToRoleHome(localUser.role);
          return;
        }

        setPendingUser(user);
        Alert.alert(
          'Finish account setup',
          'Your login exists, but your app profile is missing. Choose your account type to finish setup.'
        );
        return;
      }

      const userData = userDoc.data();
      const { role, approvalStatus } = userData;
      const localUser = findLocalUserByEmail(normalizedEmail);
      const profileData = {
        uid: user.uid,
        ...userData,
        email: (userData.email || user.email || normalizedEmail).trim().toLowerCase(),
      };

      if (role === 'distributor' && localUser?.approvalStatus === 'approved') {
        saveLocalUser({
          ...profileData,
          approvalStatus: 'approved',
        });
        goToRoleHome(role);
        return;
      }

      if (role === 'distributor' && approvalStatus !== 'approved') {
        saveLocalUser(profileData);
        await signOut(auth);
        Alert.alert(
          approvalStatus === 'rejected' ? 'Account rejected' : 'Pending approval',
          approvalStatus === 'rejected'
            ? 'Your distributor account was rejected by the admin.'
            : 'Your distributor account is still waiting for admin approval.'
        );
        return;
      }

      saveLocalUser(profileData);
      goToRoleHome(role);

    } catch (error) {
      console.log('Login error:', error.message);
      Alert.alert('Login failed', getAuthErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const finishMissingProfile = async (role) => {
    if (!pendingUser) return;

    try {
      setLoading(true);

      const localUserData = {
        uid: pendingUser.uid,
        firstName: '',
        lastName: '',
        email: (pendingUser.email || '').trim().toLowerCase(),
        phone: '',
        address: '',
        role,
        approvalStatus: role === 'distributor' ? 'pending' : 'approved',
      };

      saveLocalUser(localUserData);

      try {
        await setDoc(doc(db, 'users', pendingUser.uid), {
          ...localUserData,
          createdAt: serverTimestamp(),
        });
      } catch (error) {
        console.log('Profile setup Firestore error:', error.message);
      }

      setPendingUser(null);

      if (role === 'distributor') {
        await signOut(auth);
        Alert.alert(
          'Registration submitted',
          'Your distributor account is pending admin approval. You can log in after it is accepted.'
        );
        router.replace('/login');
        return;
      }

      goToRoleHome(role);
    } catch (error) {
      console.log('Profile setup error:', error.message);
      Alert.alert('Setup failed', getAuthErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <LinearGradient
      colors={['#187BCD', '#42A5F5']}
      style={styles.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
    >
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.phoneWrapper}>
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            <View style={styles.dripContainer}>
              <Image
                source={require('../assets/icons/meltdrop.png')}
                style={styles.dripImage}
                resizeMode="cover"
              />
            </View>

            <View style={styles.logoSection}>
              <Image
                source={require('../assets/icons/bluetapwhitelogo.png')}
                style={styles.logo}
                resizeMode="contain"
              />
              <Text style={styles.appName}>BlueTap</Text>
              <Text style={styles.tagline}>Water Within Reach</Text>
            </View>

            <View style={styles.formContainer}>
              <View style={styles.inputContainer}>
                <TextInput
                  style={styles.input}
                  placeholder="Enter email"
                  placeholderTextColor="#FFFFFF"
                  keyboardType="email-address"
                  autoCapitalize="none"
                  onChangeText={setEmail}
                />
                <TextInput
                  style={styles.input}
                  placeholder="Enter password"
                  placeholderTextColor="#FFFFFF"
                  secureTextEntry
                  onChangeText={setPassword}
                />
              </View>
            </View>

            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[styles.loginButton, loading && styles.buttonDisabled]}
                onPress={handleLogin}
                disabled={loading}
              >
                <Text style={styles.loginButtonText}>
                  {loading ? 'PLEASE WAIT...' : 'LOG IN'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.signupContainer}>
              <Text style={styles.signupText}>
                No account?{' '}
                <Text
                  style={styles.signupLink}
                  onPress={() => router.push('/signup')}
                >
                  Click here to sign up.
                </Text>
              </Text>
            </View>
          </ScrollView>
        </View>

        <Modal visible={!!pendingUser} transparent animationType="slide">
          <View style={styles.modalBackground}>
            <View style={styles.modalContainer}>
              <Text style={styles.modalTitle}>Finish Account Setup</Text>

              <TouchableOpacity
                style={styles.modalButton}
                onPress={() => finishMissingProfile('requester')}
                disabled={loading}
              >
                <Text style={styles.modalButtonText}>Requester</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalButton}
                onPress={() => finishMissingProfile('distributor')}
                disabled={loading}
              >
                <Text style={styles.modalButtonText}>Distributor</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalCancel}
                onPress={() => setPendingUser(null)}
                disabled={loading}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  container: {
    flex: 1,
    width: '100%',
  },
  phoneWrapper: {
    width: '100%',
    maxWidth: 375,
    alignSelf: 'center',
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: 20,
  },
  dripContainer: {
    width: '100%',
    height: 120,
    alignItems: 'center',
    overflow: 'hidden',
  },
  dripImage: {
    width: '100%',
    height: '100%',
  },
  logoSection: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 20,
    marginBottom: 20,
  },
  logo: {
    width: 100,
    height: 100,
    marginBottom: 12,
  },
  appName: {
    color: '#FFFFFF',
    fontSize: 36,
    fontWeight: 'bold',
    marginBottom: 6,
    textAlign: 'center',
  },
  tagline: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '300',
    textAlign: 'center',
  },
  formContainer: {
    width: '100%',
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  inputContainer: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  input: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    marginBottom: 12,
    color: '#FFFFFF',
  },
  buttonContainer: {
    width: '100%',
    paddingHorizontal: 24,
    marginBottom: 16,
  },
  loginButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingVertical: 12,
    width: '100%',
    alignItems: 'center',
  },
  loginButtonText: {
    color: '#187BCD',
    fontSize: 16,
    fontWeight: 'bold',
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  signupContainer: {
    alignItems: 'center',
    paddingHorizontal: 24,
    marginBottom: 20,
  },
  signupText: {
    color: 'rgba(255, 255, 255, 0.7)',
    fontSize: 13,
    textAlign: 'center',
  },
  signupLink: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    textDecorationLine: 'underline',
  },
  modalBackground: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContainer: {
    width: '85%',
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 20,
    color: '#187BCD',
  },
  modalButton: {
    width: '100%',
    backgroundColor: '#187BCD',
    padding: 14,
    borderRadius: 10,
    marginVertical: 8,
    alignItems: 'center',
  },
  modalButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  modalCancel: {
    marginTop: 10,
  },
  modalCancelText: {
    color: '#187BCD',
    fontWeight: 'bold',
  },
});
