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
  Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { BLUETAP_LOGIN_GRADIENT } from '../constants/bluetapTheme';
import { auth, db } from '../firebase';
import { signInWithCustomToken, signOut } from 'firebase/auth';
import { saveLocalUser } from '../localUsers';
import {
  clearAllAuthSessions,
  getPostAuthenticationDestination,
  saveRoleSession,
} from '../services/authSession';
import { loginWithUsernameResult } from '../services/usernameAuth';
import { restartIncompleteRegistration } from '../services/profileRecovery';
import { completePasswordRecovery, requestPasswordRecovery, verifyPasswordRecovery } from '../services/passwordRecovery';
import { clearPendingRegistration } from '../services/emailVerification';
import { warmFaceServiceForSignup, warmLoginBackend } from '../services/apiWarmup';

const { createHiddenAdminEntryTracker } = require('../services/hiddenAdminEntry');
const { getPublicLoginErrorMessage } = require('../services/publicLoginErrors');

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const applicationPendingTitle = 'Application Pending';
const applicationPendingMessage =
  'Your distributor application is still under review.\n\nPlease wait for the administrator to approve your application before logging in.';
const getApplicationRejectedMessage = (rejectionReason) =>
  `Unfortunately, your distributor application has been rejected.\n\nReason:\n${rejectionReason || 'No rejection reason was provided.'}\n\nPlease submit a new application with valid and complete documents.`;
const distributorRegistrationMessage =
  'Your application has been submitted successfully.\n\nYour account is currently Pending Approval.\n\nPlease wait for the administrator to review and approve your application before you can log in.';

const isValidEmail = (value) => emailPattern.test(value.trim().toLowerCase());
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
    profile?.approvalStatus || profile?.status || profile?.accountStatus || defaultStatus
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
  const { signup, passwordChanged } = useLocalSearchParams();
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
  const [showPassword, setShowPassword] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const loginInFlight = React.useRef(false);
  const loginRequestId = React.useRef(0);
  const loginSucceeded = React.useRef(false);
  const [pendingUser, setPendingUser] = React.useState(null);
  const [restartPhase, setRestartPhase] = React.useState('idle');
  const [restartError, setRestartError] = React.useState('');
  const [forgotPasswordVisible, setForgotPasswordVisible] = React.useState(false);
  const [resetEmail, setResetEmail] = React.useState('');
  const [resetEmailError, setResetEmailError] = React.useState('');
  const [resetLoading, setResetLoading] = React.useState(false);
  const [recoveryStep, setRecoveryStep] = React.useState('email');
  const [recoverySessionId, setRecoverySessionId] = React.useState('');
  const [recoveryMaskedEmail, setRecoveryMaskedEmail] = React.useState('');
  const [recoveryAuthorization, setRecoveryAuthorization] = React.useState('');
  const [recoveryCode, setRecoveryCode] = React.useState('');
  const [recoveryPassword, setRecoveryPassword] = React.useState('');
  const [recoveryPasswordConfirm, setRecoveryPasswordConfirm] = React.useState('');
  const [notification, setNotification] = React.useState(null);
  const [keyboardBottomInset, setKeyboardBottomInset] = React.useState(0);
  const isLoginSuccessVisible = notification?.title === 'Successfully logged in';
  const adminEntryTracker = React.useMemo(() => createHiddenAdminEntryTracker({
    onTrigger: () => router.push('/admin/login'),
  }), [router]);

  React.useEffect(() => () => adminEntryTracker.reset(), [adminEntryTracker]);

  React.useEffect(() => { warmLoginBackend(); }, []);

  React.useEffect(() => {
    if (signup === 'true') {
      router.replace('/signup');
    }
  }, [router, signup]);

  React.useEffect(() => {
    if (passwordChanged === 'true') {
      setNotification({ title: 'Password changed', message: 'Your Admin password was changed. Sign in with your new password.', onConfirm: null });
    }
  }, [passwordChanged]);

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

  const showNotification = (title, message, onConfirm, actionLabel = '') => {
    setNotification({ title, message, onConfirm, actionLabel });
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
    warmFaceServiceForSignup();
    router.push('/signup');
  };

  const handleInputFocus = (field) => {
    activeFieldRef.current = field;
    clearFocusScrollTimeout();

    focusScrollTimeoutRef.current = setTimeout(() => {
      scrollFocusedInputIntoView(field);
    }, keyboardVisibleRef.current ? 60 : 320);
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
    const destination = getPostAuthenticationDestination(profile);
    console.info('[public-login]', {
      stage: 'LOGIN_ROUTE_ROLE',
      uid: profile?.uid || auth.currentUser?.uid || '',
      role,
    });
    console.info('[public-login]', {
      stage: 'LOGIN_ROUTE_DESTINATION',
      uid: profile?.uid || auth.currentUser?.uid || '',
      destination,
    });

    setLoading(false);
    router.replace(destination);
  };

  const handleLogin = async () => {
    if (loading || loginInFlight.current) return;

    const loginIdentifier = email.trim();
    const normalizedEmail = loginIdentifier.toLowerCase();
    const enteredPassword = password;

    if (!normalizedEmail || !enteredPassword) {
      showNotification('Missing details', 'Please enter your username or email and password.');
      return;
    }

    const requestSequence = typeof loginRequestId === 'undefined' ? { current: 0 } : loginRequestId;
    const successState = typeof loginSucceeded === 'undefined' ? { current: false } : loginSucceeded;
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    successState.current = false;
    let authenticatedUser = null;
    loginInFlight.current = true;
    try {
      setLoading(true);
      if (typeof setNotification === 'function') setNotification(null);
      const startedAt = Date.now();
      console.info('[public-login]', { stage: 'LOGIN_REQUEST_STARTED' });

      // Public sign-in always begins without any authorization state from a
      // previous account. This also invalidates the UID-bound privileged cache.
      clearAllAuthSessions();
      if (auth.currentUser) {
        await signOut(auth);
      }

      // Both identifiers use password verification and public-role checks on
      // the backend before establishing the matching Firebase client session.
      const loginResult = await loginWithUsernameResult(loginIdentifier, enteredPassword, { portal: 'public' });
      const userCredential = await signInWithCustomToken(auth, loginResult.customToken);

      const user = userCredential.user;
      authenticatedUser = user;
      console.info('[public-login]', { stage: 'LOGIN_AUTH_UID', uid: user.uid });
      console.info('[public-login]', { stage: 'LOGIN_AUTH_COMPLETED', durationMs: Date.now() - startedAt });

      const responseProfile = loginResult.profile;
      console.info('[public-login]', {
        stage: 'LOGIN_PROFILE_UID',
        uid: responseProfile?.uid || '',
      });
      console.info('[public-login]', {
        stage: 'LOGIN_PROFILE_ROLE',
        uid: responseProfile?.uid || '',
        role: normalizeRole(responseProfile?.role),
      });
      if (!responseProfile || responseProfile.uid !== user.uid) {
        console.warn('[public-login]', {
          stage: 'USERNAME_UID_MISMATCH',
          authenticatedUid: user.uid,
          profileUid: responseProfile?.uid || '',
        });
        throw Object.assign(new Error('Account mapping invalid'), { code: 'ACCOUNT_MAPPING_INVALID' });
      }

      // The backend just authenticated this UID and loaded this profile before
      // minting the custom token. A second client Firestore read could fail or
      // race after successful authentication and used to overwrite success.
      const userData = responseProfile;
      if (
        !userData ||
        userData.uid !== user.uid ||
        normalizeRole(userData.role) !== normalizeRole(responseProfile.role)
      ) {
        throw Object.assign(new Error('Account setup incomplete'), { code: 'ACCOUNT_SETUP_INCOMPLETE' });
      }
      console.info('[public-login]', { stage: 'LOGIN_PROFILE_LOADED', durationMs: Date.now() - startedAt });
      const { role } = userData;
      const profileRole = normalizeRole(role);
      if (profileRole === 'admin' || profileRole === 'manager') {
        throw Object.assign(new Error('Privileged portal required'), { code: 'PRIVILEGED_LOGIN_REQUIRED' });
      }
      const profileApplicationStatus = getApplicationStatus(
        userData,
        profileRole === 'distributor' ? 'pending' : 'approved'
      );
      let profileData = {
        ...userData,
        uid: user.uid,
        role: profileRole,
        email: (userData.email || user.email || normalizedEmail).trim().toLowerCase(),
        approvalStatus: profileApplicationStatus,
        status: toApplicationStatus(profileApplicationStatus),
        rejectionReason: userData.rejectionReason || null,
      };

      if (!['requester', 'distributor'].includes(profileRole)) {
        throw Object.assign(new Error('Account setup incomplete'), { code: 'ACCOUNT_SETUP_INCOMPLETE' });
      }

      saveLocalUser(profileData);
      successState.current = true;
      finishSuccessfulLogin(profileData);
      console.info('[public-login]', { stage: 'LOGIN_ROUTED', durationMs: Date.now() - startedAt });

    } catch (error) {
      if (requestId !== requestSequence.current || successState.current) return;
      if (auth.currentUser && (!authenticatedUser || auth.currentUser.uid === authenticatedUser.uid)) {
        clearAllAuthSessions();
        await signOut(auth).catch(() => {});
      }
      const privileged = error?.code === 'PRIVILEGED_LOGIN_REQUIRED' || error?.code === 'username/privileged-login-required';
      showNotification('Login failed', getPublicLoginErrorMessage(error), privileged ? () => router.replace('/manager/login') : undefined, privileged ? 'Go to Manager Login' : '');
    } finally {
      if (requestId === requestSequence.current) {
        loginInFlight.current = false;
        setLoading(false);
      }
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
    setRecoveryStep('email'); setRecoverySessionId(''); setRecoveryMaskedEmail(''); setRecoveryAuthorization(''); setRecoveryCode(''); setRecoveryPassword(''); setRecoveryPasswordConfirm('');
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

      const result = await requestPasswordRecovery(normalizedEmail);
      setRecoverySessionId(result.recoverySessionId);
      setRecoveryMaskedEmail(result.maskedEmail || normalizedEmail);
      setRecoveryStep('verify');
    } catch (error) {
      const message = error?.message || 'Password recovery is temporarily unavailable. Please try again.';
      setResetEmailError(message);
    } finally {
      setResetLoading(false);
    }
  };

  const verifyRecoveryCode = async () => {
    if (!/^\d{6}$/.test(recoveryCode)) { setResetEmailError('Enter the six-digit code from your email.'); return; }
    try { setResetLoading(true); setResetEmailError(''); const result = await verifyPasswordRecovery(recoverySessionId, recoveryCode); setRecoveryAuthorization(result.resetAuthorization); setRecoveryStep('password'); }
    catch (error) { setResetEmailError(error?.message || 'That code is invalid or expired.'); }
    finally { setResetLoading(false); }
  };

  const completeRecovery = async () => {
    if (recoveryPassword !== recoveryPasswordConfirm) { setResetEmailError('Passwords do not match.'); return; }
    try { setResetLoading(true); setResetEmailError(''); await completePasswordRecovery(recoverySessionId, recoveryAuthorization, recoveryPassword); setRecoveryStep('done'); }
    catch (error) { setResetEmailError(error?.message || 'Password recovery is temporarily unavailable. Please try again.'); }
    finally { setResetLoading(false); }
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
                <TouchableOpacity
                  style={styles.backButton}
                  onPress={() => router.replace('/')}
                  accessibilityRole="button"
                  accessibilityLabel="Back to landing page"
                >
                  <Text style={styles.backButtonIcon}>‹</Text>
                  <Text style={styles.backButtonText}>Back to home</Text>
                </TouchableOpacity>

                <View style={styles.logoSection}>
                  <Pressable
                    onPress={() => adminEntryTracker.tap()}
                    accessibilityRole="image"
                    accessibilityLabel="BlueTap logo"
                  >
                    <Image
                      accessible={false}
                      source={require('../assets/icons/bluetapwhitelogo.png')}
                      style={styles.logo}
                      resizeMode="contain"
                    />
                  </Pressable>
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
                    <View style={styles.passwordField}>
                      <TextInput
                        ref={passwordInputRef}
                        style={styles.passwordFieldInput}
                        placeholder="Enter password"
                        placeholderTextColor="#FFFFFF"
                        secureTextEntry={!showPassword}
                        value={password}
                        onChangeText={setPassword}
                        onFocus={() => handleInputFocus('password')}
                        returnKeyType="done"
                        onSubmitEditing={handleLogin}
                      />
                      <TouchableOpacity
                        accessibilityRole="button"
                        accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
                        onPress={() => setShowPassword((visible) => !visible)}
                        style={styles.passwordVisibility}
                      >
                        <Text style={styles.passwordVisibilityText}>{showPassword ? 'Hide' : 'Show'}</Text>
                      </TouchableOpacity>
                    </View>
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
              <Text style={styles.modalTitle}>{recoveryStep === 'email' ? 'Reset your password' : recoveryStep === 'verify' ? 'Check your email' : recoveryStep === 'password' ? 'Create a new password' : 'Password changed'}</Text>
              <Text style={styles.resetHelperText}>{recoveryStep === 'email' ? 'Enter the email linked to your BlueTap account.' : recoveryStep === 'verify' ? `We sent a verification code to ${recoveryMaskedEmail}.` : recoveryStep === 'password' ? 'Choose a new password with uppercase, lowercase, and a number.' : 'Your password was changed. Sign in with your new password.'}</Text>
              {recoveryStep === 'email' ? <TextInput style={[styles.resetInput, !!resetEmailError && styles.resetInputError]} placeholder="Email address" placeholderTextColor="#90A4AE" keyboardType="email-address" autoCapitalize="none" value={resetEmail} onChangeText={setResetEmail} /> : null}
              {recoveryStep === 'verify' ? <TextInput style={[styles.resetInput, !!resetEmailError && styles.resetInputError]} placeholder="6-digit code" placeholderTextColor="#90A4AE" keyboardType="number-pad" maxLength={6} value={recoveryCode} onChangeText={(value) => setRecoveryCode(value.replace(/\D/g, ''))} /> : null}
              {recoveryStep === 'password' ? <><TextInput style={[styles.resetInput, !!resetEmailError && styles.resetInputError]} placeholder="New password" placeholderTextColor="#90A4AE" secureTextEntry value={recoveryPassword} onChangeText={setRecoveryPassword} /><TextInput style={styles.resetInput} placeholder="Confirm new password" placeholderTextColor="#90A4AE" secureTextEntry value={recoveryPasswordConfirm} onChangeText={setRecoveryPasswordConfirm} /></> : null}
              {!!resetEmailError && <Text style={styles.resetErrorText}>{resetEmailError}</Text>}
              {recoveryStep !== 'done' ? <TouchableOpacity style={[styles.modalButton, resetLoading && styles.buttonDisabled]} onPress={recoveryStep === 'email' ? handlePasswordReset : recoveryStep === 'verify' ? verifyRecoveryCode : completeRecovery} disabled={resetLoading}><Text style={styles.modalButtonText}>{resetLoading ? 'Please wait…' : recoveryStep === 'email' ? 'Send verification code' : recoveryStep === 'verify' ? 'Verify code' : 'Save new password'}</Text></TouchableOpacity> : <TouchableOpacity style={styles.modalButton} onPress={closeForgotPassword}><Text style={styles.modalButtonText}>Back to sign in</Text></TouchableOpacity>}
              {recoveryStep === 'verify' ? <TouchableOpacity style={styles.modalCancel} onPress={handlePasswordReset} disabled={resetLoading}><Text style={styles.modalCancelText}>Resend code</Text></TouchableOpacity> : null}
              {recoveryStep !== 'done' ? <TouchableOpacity style={styles.modalCancel} onPress={closeForgotPassword} disabled={resetLoading}><Text style={styles.modalCancelText}>Cancel</Text></TouchableOpacity> : null}
            </View>
          </View>
        </Modal>

        <Modal visible={!!notification} transparent animationType="fade">
          <View style={styles.modalBackground}>
            <View style={styles.modalContainer}>
              <Text style={styles.modalTitle}>{notification?.title}</Text>
              <Text style={styles.notificationMessage}>{notification?.message}</Text>

              <TouchableOpacity style={styles.modalButton} onPress={closeNotification}>
                <Text style={styles.modalButtonText}>{notification?.actionLabel || 'OK'}</Text>
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
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    marginLeft: -8,
    marginBottom: 2,
    borderRadius: 10,
  },
  backButtonIcon: {
    color: '#FFFFFF',
    fontSize: 31,
    fontWeight: '400',
    lineHeight: 30,
    marginRight: 4,
    marginTop: -2,
  },
  backButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
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
  passwordField: {
    minHeight: 45,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: 10,
    marginBottom: 12,
  },
  passwordFieldInput: {
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: '#FFFFFF',
  },
  passwordVisibility: {
    minWidth: 58,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  passwordVisibilityText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
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
