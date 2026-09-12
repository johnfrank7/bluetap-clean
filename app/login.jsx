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
  Dimensions,
  Keyboard,
  Modal,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { BLUETAP_LOGIN_GRADIENT } from '../constants/bluetapTheme';
import { auth, db } from '../firebase';
import {
  fetchSignInMethodsForEmail,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithCustomToken,
  signOut,
} from 'firebase/auth';
import { doc, getDoc } from 'firebase/firestore';
import { findLocalUserByEmail, saveLocalUser } from '../localUsers';
import {
  clearAllAuthSessions,
  saveAdminSession,
  saveRoleSession,
} from '../services/authSession';
import { ensureUserUniqueId } from '../services/uniqueIds';
import { loginWithUsername } from '../services/usernameAuth';
import { recoverTrustedProfile } from '../services/profileRecovery';
import { restartIncompleteRegistration } from '../services/profileRecovery';
import { clearPendingRegistration } from '../services/emailVerification';

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
const requiresEmailVerification = (profile) => profile?.emailVerificationRequired === true;
const BASE_SCROLL_PADDING_BOTTOM = 20;
const DEFAULT_KEYBOARD_GAP = 24;
const PASSWORD_KEYBOARD_GAP = 112;

const getKeyboardTop = (keyboardFrame) => {
  const windowHeight = Dimensions.get('window').height;

  if (typeof keyboardFrame?.screenY === 'number') {
    return keyboardFrame.screenY;
  }

  if (typeof keyboardFrame?.height === 'number') {
    return windowHeight - keyboardFrame.height;
  }

  return windowHeight;
};

const getFieldKeyboardGap = (field) =>
  field === 'password' ? PASSWORD_KEYBOARD_GAP : DEFAULT_KEYBOARD_GAP;

export default function LoginPage() {
  const router = useRouter();
  const { signup } = useLocalSearchParams();
  const emailInputRef = React.useRef(null);
  const passwordInputRef = React.useRef(null);
  const scrollViewRef = React.useRef(null);
  const activeFieldRef = React.useRef(null);
  const keyboardFrameRef = React.useRef(null);
  const keyboardVisibleRef = React.useRef(false);
  const scrollOffsetRef = React.useRef(0);
  const focusScrollTimeoutRef = React.useRef(null);

  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [pendingUser, setPendingUser] = React.useState(null);
  const [restartPhase, setRestartPhase] = React.useState('idle');
  const [restartError, setRestartError] = React.useState('');
  const [forgotPasswordVisible, setForgotPasswordVisible] = React.useState(false);
  const [resetEmail, setResetEmail] = React.useState('');
  const [resetEmailError, setResetEmailError] = React.useState('');
  const [resetLoading, setResetLoading] = React.useState(false);
  const [notification, setNotification] = React.useState(null);
  const [keyboardBottomInset, setKeyboardBottomInset] = React.useState(0);
  const isLoginSuccessVisible = notification?.title === 'Successfully logged in';

  React.useEffect(() => {
    if (signup === 'true') {
      router.replace('/signup');
    }
  }, [router, signup]);

  const clearFocusScrollTimeout = React.useCallback(() => {
    if (focusScrollTimeoutRef.current) {
      clearTimeout(focusScrollTimeoutRef.current);
      focusScrollTimeoutRef.current = null;
    }
  }, []);

  const scrollFocusedInputIntoView = React.useCallback((field, keyboardFrame) => {
    if (!field) return;

    const inputRef = field === 'password' ? passwordInputRef.current : emailInputRef.current;

    if (!inputRef?.measureInWindow) return;

    requestAnimationFrame(() => {
      inputRef.measureInWindow((x, y, width, height) => {
        const keyboardTop = getKeyboardTop(keyboardFrame || keyboardFrameRef.current);
        const requiredGap = getFieldKeyboardGap(field);
        const inputBottom = y + height;
        const overlap = inputBottom + requiredGap - keyboardTop;

        if (overlap > 0) {
          scrollViewRef.current?.scrollTo({
            y: Math.max(scrollOffsetRef.current + overlap, 0),
            animated: true,
          });
          return;
        }

        const topGap = 12;

        if (y < topGap) {
          scrollViewRef.current?.scrollTo({
            y: Math.max(scrollOffsetRef.current - (topGap - y), 0),
            animated: true,
          });
        }
      });
    });
  }, []);

  React.useEffect(() => {
    const handleKeyboardFrame = (event) => {
      Keyboard.scheduleLayoutAnimation?.(event);
      keyboardVisibleRef.current = true;
      keyboardFrameRef.current = event.endCoordinates || null;
      setKeyboardBottomInset(Math.max(event.endCoordinates?.height || 0, 0));
      clearFocusScrollTimeout();

      focusScrollTimeoutRef.current = setTimeout(() => {
        scrollFocusedInputIntoView(activeFieldRef.current, event.endCoordinates);
      }, Platform.OS === 'ios' ? 80 : 120);
    };

    const handleKeyboardHide = (event) => {
      Keyboard.scheduleLayoutAnimation?.(event);
      keyboardVisibleRef.current = false;
      keyboardFrameRef.current = null;
      setKeyboardBottomInset(0);
      clearFocusScrollTimeout();
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
    };

    const keyboardSubscriptions = [
      Keyboard.addListener(
        Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
        handleKeyboardFrame
      ),
      Keyboard.addListener(
        Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
        handleKeyboardHide
      ),
    ];

    if (Platform.OS === 'ios') {
      keyboardSubscriptions.push(
        Keyboard.addListener('keyboardWillChangeFrame', handleKeyboardFrame)
      );
    }

    return () => {
      clearFocusScrollTimeout();
      keyboardSubscriptions.forEach((subscription) => subscription.remove());
    };
  }, [clearFocusScrollTimeout, scrollFocusedInputIntoView]);

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

  const openSignupOptions = () => {
    router.push('/signup');
  };

  const handleInputFocus = (field) => {
    activeFieldRef.current = field;
    clearFocusScrollTimeout();

    focusScrollTimeoutRef.current = setTimeout(() => {
      scrollFocusedInputIntoView(field);
    }, keyboardVisibleRef.current ? 60 : 320);
  };

  const navigateToRoleHome = (role) => {
    const normalizedRole = normalizeRole(role);

    if (normalizedRole === 'admin') {
      router.replace('/admin/dashboard');
    } else if (normalizedRole === 'requester') {
      router.replace('/requester/r_dashboard');
    } else if (normalizedRole === 'distributor') {
      router.replace('/distributor/d_dashboard');
    } else {
      showNotification('Login failed', 'This account has no valid role.');
    }
  };

  const finishSuccessfulLogin = (profile) => {
    const role = normalizeRole(profile?.role || profile);

    if (
      (role === 'requester' || role === 'distributor') &&
      requiresEmailVerification(profile) &&
      !auth.currentUser?.emailVerified
    ) {
      clearAllAuthSessions();
      setLoading(false);
      router.replace('/email-verification');
      return;
    }

    saveRoleSession({
      ...(typeof profile === 'object' ? profile : {}),
      role,
    });

    setLoading(false);
    showNotification(
      'Successfully logged in',
      'You have successfully logged in.',
      () => navigateToRoleHome(role)
    );
  };

  const handleLogin = async () => {
    if (loading) return;

    const loginIdentifier = email.trim();
    const normalizedEmail = loginIdentifier.toLowerCase();
    const trimmedPassword = password.trim();

    if (!normalizedEmail || !trimmedPassword) {
      showNotification('Missing details', 'Please enter your email and password.');
      return;
    }

    try {
      setLoading(true);

      // Secret admin credentials (bypass Firebase, go straight to admin panel)
      if (normalizedEmail === 'bluetapadmin' && trimmedPassword === '12345678') {
        try {
          await signOut(auth);
        } catch (error) {
          console.log('Admin Firebase sign out error:', error.message);
        }

        saveAdminSession();
        setLoading(false);
        showNotification(
          'Successfully logged in',
          'You have successfully logged in.',
          () => router.replace('/admin/dashboard')
        );
        return;
      }

      // Legacy accounts may continue signing in with email. New accounts use
      // the server-side username registry and receive a Firebase custom token.
      const userCredential = loginIdentifier.includes('@')
        ? await signInWithEmailAndPassword(auth, normalizedEmail, trimmedPassword)
        : await signInWithCustomToken(auth, await loginWithUsername(loginIdentifier, trimmedPassword));

      const user = userCredential.user;

      let userDoc = null;

      try {
        userDoc = await getDoc(doc(db, 'users', user.uid));
      } catch (error) {
        console.log('Login profile read error:', error.message);
      }

      if (!userDoc?.exists()) {
        try {
          const recovery = await recoverTrustedProfile();
          if (recovery?.recovered) userDoc = await getDoc(doc(db, 'users', user.uid));
        } catch (error) {
          console.log('Trusted profile recovery unavailable:', error.message);
        }
        if (!userDoc?.exists()) {
          setPendingUser(user);
          setRestartPhase('idle');
          setRestartError('');
          return;
        }
      }

      const userData = userDoc.data();
      const { role } = userData;
      const profileRole = normalizeRole(role);
      const profileApplicationStatus = getApplicationStatus(
        userData,
        profileRole === 'distributor' ? 'pending' : 'approved'
      );
      let profileData = {
        uid: user.uid,
        ...userData,
        role: profileRole,
        email: (userData.email || user.email || normalizedEmail).trim().toLowerCase(),
        approvalStatus: profileApplicationStatus,
        status: toApplicationStatus(profileApplicationStatus),
        rejectionReason: userData.rejectionReason || null,
      };

      if (!['admin', 'requester', 'distributor'].includes(profileRole)) {
        clearAllAuthSessions();
        await signOut(auth);
        showNotification('Login failed', 'This account has no valid role.');
        return;
      }

      if (profileRole === 'requester' || profileRole === 'distributor') {
        const { faceVerification, ...profileWithoutFaceVerification } = profileData;
        const profileWithUniqueId = await ensureUserUniqueId(user, profileWithoutFaceVerification);
        profileData = {
          ...profileWithUniqueId,
          faceVerification,
        };
      }

      if (profileRole === 'distributor' && profileApplicationStatus !== 'approved') {
        saveLocalUser(profileData);
        clearAllAuthSessions();
        await signOut(auth);
        showDistributorStatusNotification(
          profileApplicationStatus,
          userData.rejectionReason
        );
        return;
      }

      saveLocalUser(profileData);
      finishSuccessfulLogin(profileData);

    } catch (error) {
      console.log('Login error:', error.message);
      const usernameAuthError = String(error?.code || '').startsWith('username/');
      showNotification(
        isWrongLoginError(error) || usernameAuthError ? 'Login failed' : 'Login failed',
        isWrongLoginError(error) || usernameAuthError ? 'Invalid username or password.' : getAuthErrorMessage(error)
      );
    } finally {
      setLoading(false);
    }
  };

  const confirmRestartIncompleteRegistration = () => {
    if (restartPhase === 'cleaning') return;
    setRestartError('');
    setRestartPhase('confirm');
  };

  const restartCurrentIncompleteRegistration = async () => {
    if (restartPhase === 'cleaning') return;
    try {
      setRestartPhase('cleaning');
      setRestartError('');
      await restartIncompleteRegistration();
      clearPendingRegistration();
      clearAllAuthSessions();
      await signOut(auth).catch(() => {});
      setPendingUser(null);
      router.replace('/signup');
    } catch (error) {
      console.log('Incomplete registration restart error:', error.message);
      setRestartError(error.message || 'We could not safely restart this account. Please contact support.');
      setRestartPhase('idle');
    }
  };

  const returnFromIncompleteRegistration = async () => {
    if (restartPhase === 'cleaning') return;
    clearPendingRegistration();
    setPendingUser(null);
    setRestartPhase('idle');
    setRestartError('');
    clearAllAuthSessions();
    await signOut(auth).catch(() => {});
    router.replace('/login');
  };

  const openForgotPassword = () => {
    activeFieldRef.current = null;
    clearFocusScrollTimeout();
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
      colors={BLUETAP_LOGIN_GRADIENT}
      style={styles.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 0, y: 1 }}
    >
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.phoneWrapper}>
          <ScrollView
            ref={scrollViewRef}
            contentContainerStyle={[
              styles.scrollContent,
              keyboardBottomInset > 0 && {
                paddingBottom: BASE_SCROLL_PADDING_BOTTOM + keyboardBottomInset,
              },
            ]}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
            scrollEventThrottle={16}
            onScroll={(event) => {
              scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
            }}
          >
            <View style={styles.authCardFrame}>
              <View style={styles.authCard}>
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
                    <Text style={styles.inputLabel}>Username or email</Text>
                    <TextInput
                      ref={emailInputRef}
                      style={styles.input}
                      placeholder="Enter username or email"
                      placeholderTextColor="#FFFFFF"
                      keyboardType="default"
                      autoCapitalize="none"
                      value={email}
                      onChangeText={setEmail}
                      onFocus={() => handleInputFocus('email')}
                      returnKeyType="next"
                      onSubmitEditing={() => passwordInputRef.current?.focus()}
                    />
                    <Text style={styles.inputLabel}>Password</Text>
                    <TextInput
                      ref={passwordInputRef}
                      style={styles.input}
                      placeholder="Enter password"
                      placeholderTextColor="#FFFFFF"
                      secureTextEntry
                      value={password}
                      onChangeText={setPassword}
                      onFocus={() => handleInputFocus('password')}
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
                    Need an account?{' '}
                    <Text style={styles.signupLink} onPress={openSignupOptions}>
                      Sign up.
                    </Text>
                  </Text>
                </View>
              </View>
            </View>
          </ScrollView>
        </View>

        <Modal visible={!!pendingUser} transparent animationType="slide">
          <View style={styles.modalBackground}>
            <View style={styles.modalContainer}>
              {restartPhase === 'confirm' ? <>
                <Text style={styles.modalTitle}>Restart registration?</Text>
                <Text style={styles.resetHelperText}>
                  This will remove the incomplete signup associated with this account so you can register again. Completed BlueTap account data will not be deleted.
                </Text>
                <TouchableOpacity style={styles.modalButton} onPress={restartCurrentIncompleteRegistration}>
                  <Text style={styles.modalButtonText}>Restart Registration</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalCancel} onPress={() => setRestartPhase('idle')}>
                  <Text style={styles.modalCancelText}>Cancel</Text>
                </TouchableOpacity>
              </> : restartPhase === 'cleaning' ? <>
                <Text style={styles.modalTitle}>Preparing a fresh registration...</Text>
                <Text style={styles.resetHelperText}>Please wait while we safely remove incomplete signup records.</Text>
              </> : <>
                <Text style={styles.modalTitle}>Account setup incomplete</Text>
                <Text style={styles.resetHelperText}>
                  Your sign-in account exists, but BlueTap could not find a completed profile for it.
                </Text>
                {!!restartError && <Text style={styles.resetErrorText}>{restartError}</Text>}
                <TouchableOpacity style={styles.modalButton} onPress={confirmRestartIncompleteRegistration} disabled={loading}>
                  <Text style={styles.modalButtonText}>Restart Registration</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.modalCancel} onPress={returnFromIncompleteRegistration} disabled={loading}>
                  <Text style={styles.modalCancelText}>Back to Login</Text>
                </TouchableOpacity>
              </>}
            </View>
          </View>
        </Modal>

        <Modal visible={forgotPasswordVisible} transparent animationType="slide">
          <View style={styles.modalBackground}>
            <View style={styles.modalContainer}>
              <Text style={styles.modalTitle}>Forgot Password?</Text>
              <Text style={styles.resetHelperText}>
                Enter the email address associated with your BlueTap account.
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
    maxWidth: 480,
    alignSelf: 'center',
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingVertical: 24,
    paddingBottom: BASE_SCROLL_PADDING_BOTTOM,
  },
  logoSection: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 8,
    paddingBottom: 20,
    marginBottom: 4,
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
  authCardFrame: {
    width: '100%',
    paddingHorizontal: 24,
  },
  authCard: {
    width: '100%',
    maxWidth: 432,
    alignSelf: 'center',
    backgroundColor: 'rgba(9, 70, 122, 0.22)',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.34)',
    padding: 20,
    shadowColor: '#07518E',
    shadowOpacity: 0.22,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  formContainer: {
    width: '100%',
    marginBottom: 16,
  },
  inputLabel: { color: '#FFFFFF', fontSize: 13, fontWeight: '700', marginBottom: 6 },
  inputContainer: {
    width: '100%',
  },
  input: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
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
    marginBottom: 2,
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
    paddingHorizontal: 20,
  },
  modalContainer: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 24,
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
