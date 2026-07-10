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
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

import { auth, db } from '../firebase';
import {
  fetchSignInMethodsForEmail,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { findLocalUserByEmail, saveLocalUser } from '../localUsers';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const applicationPendingTitle = 'Application Pending';
const applicationPendingMessage =
  'Your distributor application is still under review.\n\nPlease wait for the administrator to approve your application before logging in.';
const getApplicationRejectedMessage = (rejectionReason) =>
  `Unfortunately, your distributor application has been rejected.\n\nReason:\n${rejectionReason || 'No rejection reason was provided.'}\n\nPlease submit a new application with valid and complete documents.`;
const distributorRegistrationMessage =
  'Your application has been submitted successfully.\n\nYour account is currently Pending Approval.\n\nPlease wait for the administrator to review and approve your application before you can log in.';

const authErrorMessages = {
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/invalid-credential': 'Wrong username or password.',
  'auth/user-not-found': 'Wrong username or password.',
  'auth/wrong-password': 'Wrong username or password.',
  'auth/missing-password': 'Please enter your password.',
  'auth/network-request-failed': 'Network error. Please check your connection and try again.',
  'permission-denied': 'Your account was found, but the app cannot read your profile. Please check Firestore rules.',
};

const getAuthErrorMessage = (error) =>
  authErrorMessages[error?.code] || error?.message || 'Something went wrong. Please try again.';

const passwordResetErrorMessages = {
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/user-not-found': 'No account is associated with this email.',
  'auth/expired-action-code': 'This password reset link has expired.',
  'auth/invalid-action-code': 'This password reset link has expired.',
  'auth/network-request-failed': 'Network error. Please check your connection and try again.',
};

const getPasswordResetErrorMessage = (error) =>
  passwordResetErrorMessages[error?.code] ||
  error?.message ||
  'Something went wrong. Please try again.';

const isValidEmail = (value) => emailPattern.test(value.trim().toLowerCase());
const isWrongLoginError = (error) =>
  ['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password'].includes(error?.code);
const normalizeApprovalStatus = (status) =>
  (status || 'pending').toString().trim().toLowerCase();
const normalizeRole = (role) => (role || '').toString().trim().toLowerCase();
const toApplicationStatus = (status) => {
  const normalizedStatus = normalizeApprovalStatus(status);

  if (normalizedStatus === 'approved') return 'Approved';
  if (normalizedStatus === 'rejected') return 'Rejected';

  return 'Pending';
};
const getApplicationStatus = (profile, defaultStatus = 'pending') =>
  normalizeApprovalStatus(
    profile?.status || profile?.approvalStatus || profile?.accountStatus || defaultStatus
  );

export default function LoginPage() {
  const router = useRouter();
  const passwordInputRef = React.useRef(null);

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [pendingUser, setPendingUser] = React.useState(null);
  const [forgotPasswordVisible, setForgotPasswordVisible] = React.useState(false);
  const [resetEmail, setResetEmail] = React.useState('');
  const [resetEmailError, setResetEmailError] = React.useState('');
  const [resetLoading, setResetLoading] = React.useState(false);
  const [notification, setNotification] = React.useState(null);
  const isLoginSuccessVisible = notification?.title === 'Successfully logged in';

  const showNotification = (title, message, onConfirm) => {
    setNotification({ title, message, onConfirm });
  };

  const showDistributorStatusNotification = (applicationStatus, rejectionReason) => {
    if (applicationStatus === 'rejected') {
      showNotification(
        'Application Rejected',
        getApplicationRejectedMessage(rejectionReason)
      );
      return;
    }

    showNotification(applicationPendingTitle, applicationPendingMessage);
  };

  const closeNotification = () => {
    const onConfirm = notification?.onConfirm;
    setNotification(null);
    onConfirm?.();
  };

  const navigateToRoleHome = (role) => {
    const normalizedRole = normalizeRole(role);

    if (normalizedRole === 'requester') {
      router.replace('/requester/r_dashboard');
    } else if (normalizedRole === 'distributor') {
      router.replace('/distributor/d_dashboard');
    } else {
      showNotification('Login failed', 'This account has no valid role.');
    }
  };

  const finishSuccessfulLogin = (role) => {
    setLoading(false);
    showNotification(
      'Successfully logged in',
      'You have successfully logged in.',
      () => navigateToRoleHome(role)
    );
  };

  const handleLogin = async () => {
    if (loading) return;

    const normalizedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();

    if (!normalizedEmail || !trimmedPassword) {
      showNotification('Missing details', 'Please enter your email and password.');
      return;
    }

    try {
      setLoading(true);

      // Secret admin credentials (bypass Firebase, go straight to admin panel)
      if (normalizedEmail === 'bluetapadmin' && trimmedPassword === '12345678') {
        setLoading(false);
        showNotification(
          'Successfully logged in',
          'You have successfully logged in.',
          () => router.replace('/admin/dashboard')
        );
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
          const localRole = normalizeRole(localUser.role);
          const localApplicationStatus = getApplicationStatus(localUser);

          if (localRole === 'distributor' && localApplicationStatus !== 'approved') {
            await signOut(auth);
            showDistributorStatusNotification(
              localApplicationStatus,
              localUser.rejectionReason
            );
            return;
          }

          finishSuccessfulLogin(localRole);
          return;
        }

        setPendingUser(user);
        showNotification(
          'Finish account setup',
          'Your login exists, but your app profile is missing. Choose your account type to finish setup.'
        );
        return;
      }

      const userData = userDoc.data();
      const { role } = userData;
      const profileRole = normalizeRole(role);
      const profileApplicationStatus = getApplicationStatus(
        userData,
        profileRole === 'distributor' ? 'pending' : 'approved'
      );
      const profileData = {
        uid: user.uid,
        ...userData,
        role: profileRole,
        email: (userData.email || user.email || normalizedEmail).trim().toLowerCase(),
        approvalStatus: profileApplicationStatus,
        status: toApplicationStatus(profileApplicationStatus),
        rejectionReason: userData.rejectionReason || null,
      };

      if (profileRole === 'distributor' && profileApplicationStatus !== 'approved') {
        saveLocalUser(profileData);
        await signOut(auth);
        showDistributorStatusNotification(
          profileApplicationStatus,
          userData.rejectionReason
        );
        return;
      }

      saveLocalUser(profileData);
      finishSuccessfulLogin(profileRole);

    } catch (error) {
      console.log('Login error:', error.message);
      showNotification(
        isWrongLoginError(error) ? 'Wrong username/password' : 'Login failed',
        getAuthErrorMessage(error)
      );
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
        barangay: '',
        address: '',
        role,
        approvalStatus: role === 'distributor' ? 'pending' : 'approved',
        status: role === 'distributor' ? 'Pending' : 'Approved',
        rejectionReason: null,
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
        setLoading(false);
        showNotification(
          'Registration Submitted',
          distributorRegistrationMessage,
          () => router.replace('/login')
        );
        return;
      }

      finishSuccessfulLogin(role);
    } catch (error) {
      console.log('Profile setup error:', error.message);
      showNotification('Setup failed', getAuthErrorMessage(error));
    } finally {
      setLoading(false);
    }
  };

  const openForgotPassword = () => {
    setResetEmail(email.trim().toLowerCase());
    setResetEmailError('');
    setForgotPasswordVisible(true);
  };

  const closeForgotPassword = () => {
    if (resetLoading) return;

    setForgotPasswordVisible(false);
    setResetEmailError('');
  };

  const handlePasswordReset = async () => {
    const normalizedEmail = resetEmail.trim().toLowerCase();

    if (!isValidEmail(normalizedEmail)) {
      setResetEmailError('Please enter a valid email address.');
      return;
    }

    try {
      setResetLoading(true);
      setResetEmailError('');

      const signInMethods = await fetchSignInMethodsForEmail(auth, normalizedEmail);

      if (signInMethods.length === 0 && !findLocalUserByEmail(normalizedEmail)) {
        const noAccountError = new Error('No account is associated with this email.');
        noAccountError.code = 'auth/user-not-found';
        throw noAccountError;
      }

      await sendPasswordResetEmail(auth, normalizedEmail);
      setForgotPasswordVisible(false);
      setResetEmail('');
      showNotification('Password reset', 'Password reset link has been sent to your email.');
    } catch (error) {
      console.log('Password reset error:', error.message);
      const message = getPasswordResetErrorMessage(error);
      setResetEmailError(message);
      showNotification('Password reset failed', message);
    } finally {
      setResetLoading(false);
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
                  value={email}
                  onChangeText={setEmail}
                  returnKeyType="next"
                  onSubmitEditing={() => passwordInputRef.current?.focus()}
                />
                <TextInput
                  ref={passwordInputRef}
                  style={styles.input}
                  placeholder="Enter password"
                  placeholderTextColor="#FFFFFF"
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  returnKeyType="done"
                  onSubmitEditing={handleLogin}
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
                  {isLoginSuccessVisible
                    ? 'SUCCESSFULLY LOGGED IN'
                    : loading
                      ? 'PLEASE WAIT...'
                      : 'LOG IN'}
                </Text>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.forgotPasswordContainer}
              onPress={openForgotPassword}
              disabled={loading}
            >
              <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
            </TouchableOpacity>

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

        <Modal visible={forgotPasswordVisible} transparent animationType="slide">
          <View style={styles.modalBackground}>
            <View style={styles.modalContainer}>
              <Text style={styles.modalTitle}>Forgot Password?</Text>
              <Text style={styles.resetHelperText}>
                Enter your registered email to receive a password reset link.
              </Text>

              <TextInput
                style={[styles.resetInput, !!resetEmailError && styles.resetInputError]}
                placeholder="Enter email"
                placeholderTextColor="#90A4AE"
                keyboardType="email-address"
                autoCapitalize="none"
                value={resetEmail}
                onChangeText={(value) => {
                  setResetEmail(value);
                  if (resetEmailError) {
                    setResetEmailError(
                      isValidEmail(value) ? '' : 'Please enter a valid email address.'
                    );
                  }
                }}
              />
              {!!resetEmailError && (
                <Text style={styles.resetErrorText}>{resetEmailError}</Text>
              )}

              <TouchableOpacity
                style={[styles.modalButton, resetLoading && styles.buttonDisabled]}
                onPress={handlePasswordReset}
                disabled={resetLoading}
              >
                <Text style={styles.modalButtonText}>
                  {resetLoading ? 'Sending...' : 'Send reset link'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalCancel}
                onPress={closeForgotPassword}
                disabled={resetLoading}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <Modal visible={!!notification} transparent animationType="fade">
          <View style={styles.modalBackground}>
            <View style={styles.modalContainer}>
              <Text style={styles.modalTitle}>{notification?.title}</Text>
              <Text style={styles.notificationMessage}>{notification?.message}</Text>

              <TouchableOpacity style={styles.modalButton} onPress={closeNotification}>
                <Text style={styles.modalButtonText}>OK</Text>
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
  forgotPasswordContainer: {
    alignItems: 'center',
    paddingHorizontal: 24,
    marginTop: -6,
    marginBottom: 14,
  },
  forgotPasswordText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: 'bold',
    textDecorationLine: 'underline',
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
  resetHelperText: {
    color: '#455A64',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: -8,
    marginBottom: 14,
  },
  resetInput: {
    width: '100%',
    borderWidth: 1,
    borderColor: '#BBDEFB',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#187BCD',
    marginBottom: 8,
  },
  resetInputError: {
    borderColor: '#D32F2F',
    backgroundColor: '#FFEBEE',
  },
  resetErrorText: {
    width: '100%',
    color: '#D32F2F',
    fontSize: 12,
    marginBottom: 10,
  },
  notificationMessage: {
    width: '100%',
    color: '#455A64',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginTop: -8,
    marginBottom: 16,
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
