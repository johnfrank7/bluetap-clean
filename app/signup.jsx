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
import { useRouter } from 'expo-router';

import { auth } from '../firebase';
import { createUserWithEmailAndPassword, deleteUser, signOut } from 'firebase/auth';
import { serverTimestamp } from 'firebase/firestore';
import { saveLocalUser } from '../localUsers';
import { clearAllAuthSessions, saveRoleSession } from '../services/authSession';
import { saveUserProfileWithUniqueId } from '../services/uniqueIds';

const barangayOptions = [
  'Awihao',
  'Bagakay',
  'Bato',
  'Biga',
  'Bulongan',
  'Bunga',
  'Cabitoonan',
  'Calongcalong',
  'Cambang-ug',
  'Camp 8',
  'Canlumampao',
  'Cantabaco',
  'Capitan Claudio',
  'Carmen',
  'Daanglungsod',
  'Don Andres Soriano',
  'Dumlog',
  'Gen. Climaco',
  'Ibo',
  'Ilihan',
  'Juan Climaco, Sr.',
  'Landahan',
  'Loay',
  'Luray II',
  'Matab-ang',
  'Media Once',
  'Pangamihan',
  'Poblacion',
  'Poog',
  'Putingbato',
  'Sagay',
  'Sam-ang',
  'Sangi',
  'Santo Niño',
  'Subayon',
  'Talavera',
  'Tubod',
  'Tungkay',
];

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const distributorRegistrationMessage =
  'Your application has been submitted successfully.\n\nYour account is currently Pending Approval.\n\nPlease wait for the administrator to review and approve your application before you can log in.';

const authErrorMessages = {
  'auth/email-already-in-use': 'This email is already registered. Please log in instead.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/weak-password': 'Password must be at least 8 characters.',
  'auth/network-request-failed': 'Network error. Please check your connection and try again.',
  'permission-denied': 'The account was created, but Firestore blocked saving the profile. Please check Firestore rules.',
};

const getAuthErrorMessage = (error) =>
  authErrorMessages[error?.code] || error?.message || 'Something went wrong. Please try again.';

const isValidEmail = (value) => emailPattern.test(value.trim().toLowerCase());

const validateSignupFields = (values) => {
  const nextErrors = {};

  if (!values.firstName.trim()) {
    nextErrors.firstName = 'First name is required.';
  }

  if (!values.lastName.trim()) {
    nextErrors.lastName = 'Last name is required.';
  }

  if (!values.email.trim() || !isValidEmail(values.email)) {
    nextErrors.email = 'Please enter a valid email address.';
  }

  if (!values.phone.trim()) {
    nextErrors.phone = 'Phone number is required.';
  }

  if (!values.barangay.trim()) {
    nextErrors.barangay = 'Please select your barangay.';
  }

  if (!values.password.trim()) {
    nextErrors.password = 'Password is required.';
  } else if (values.password.trim().length < 8) {
    nextErrors.password = 'Password must be at least 8 characters.';
  }

  if (!values.confirmPassword) {
    nextErrors.confirmPassword = 'Confirm password is required.';
  } else if (values.password !== values.confirmPassword) {
    nextErrors.confirmPassword = 'Passwords do not match.';
  }

  return nextErrors;
};

const hasValidationErrors = (errors) => Object.keys(errors).length > 0;
const BASE_SCROLL_PADDING_BOTTOM = 20;
const DEFAULT_KEYBOARD_GAP = 24;
const LOWER_FORM_KEYBOARD_GAP = 112;
const lowerFormFields = ['password', 'confirmPassword'];

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
  lowerFormFields.includes(field) ? LOWER_FORM_KEYBOARD_GAP : DEFAULT_KEYBOARD_GAP;

export default function SignupPage() {
  const router = useRouter();
  const [modalVisible, setModalVisible] = React.useState(true);
  const [selectedAccountType, setSelectedAccountType] = React.useState(null);
  const [loading, setLoading] = React.useState(false);

  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [barangay, setBarangay] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirmPassword, setConfirmPassword] = React.useState('');
  const [showBarangays, setShowBarangays] = React.useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = React.useState(false);
  const [formErrors, setFormErrors] = React.useState({});
  const [notification, setNotification] = React.useState(null);
  const [keyboardBottomInset, setKeyboardBottomInset] = React.useState(0);
  const scrollViewRef = React.useRef(null);
  const inputRefs = React.useRef({});
  const activeFieldRef = React.useRef(null);
  const keyboardFrameRef = React.useRef(null);
  const keyboardVisibleRef = React.useRef(false);
  const scrollOffsetRef = React.useRef(0);
  const focusScrollTimeoutRef = React.useRef(null);
  const passwordMeetsMinimum = password.trim().length >= 8;

  const clearFocusScrollTimeout = React.useCallback(() => {
    if (focusScrollTimeoutRef.current) {
      clearTimeout(focusScrollTimeoutRef.current);
      focusScrollTimeoutRef.current = null;
    }
  }, []);

  const scrollFocusedInputIntoView = React.useCallback((field, keyboardFrame) => {
    if (!field) return;

    const inputRef = inputRefs.current[field];

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

  const closeNotification = () => {
    const onConfirm = notification?.onConfirm;
    setNotification(null);
    onConfirm?.();
  };

  const getFormValues = (overrides = {}) => ({
    firstName,
    lastName,
    email,
    phone,
    barangay,
    password,
    confirmPassword,
    ...overrides,
  });

  const updateValidation = (nextValues) => {
    const nextErrors = validateSignupFields(nextValues);
    setFormErrors(nextErrors);
    return nextErrors;
  };

  const handleFieldChange = (field, value, setter) => {
    setter(value);

    if (hasAttemptedSubmit) {
      updateValidation(getFormValues({ [field]: value }));
    }
  };

  const handleFieldBlur = () => {
    if (hasAttemptedSubmit) {
      updateValidation(getFormValues());
    }
  };

  const getVisibleError = (field) => {
    if (!hasAttemptedSubmit || !formErrors[field]) return '';
    return formErrors[field];
  };

  const fieldBorderStyle = (field) =>
    getVisibleError(field) ? styles.inputError : null;

  const assignInputRef = (field) => (node) => {
    inputRefs.current[field] = node;
  };

  const handleInputFocus = (field) => {
    activeFieldRef.current = field;
    clearFocusScrollTimeout();

    focusScrollTimeoutRef.current = setTimeout(() => {
      scrollFocusedInputIntoView(field);
    }, keyboardVisibleRef.current ? 60 : 320);
  };

  const selectBarangay = (selectedBarangay) => {
    setBarangay(selectedBarangay);
    setShowBarangays(false);

    if (hasAttemptedSubmit) {
      updateValidation(getFormValues({ barangay: selectedBarangay }));
    }
  };

  const handleContinue = async () => {
    if (loading) return;

    setHasAttemptedSubmit(true);

    const nextErrors = updateValidation(getFormValues());

    if (hasValidationErrors(nextErrors)) {
      showNotification(
        'Check sign-up details',
        'Please correct the highlighted fields before continuing.'
      );
      return;
    }

    if (!selectedAccountType) {
      setModalVisible(true);
      return;
    }

    await registerAccount(selectedAccountType);
  };

  const handleAccountType = (type) => {
    setSelectedAccountType(type);
    setModalVisible(false);
  };

  const closeAccountTypeSelection = () => {
    setModalVisible(false);

    if (!selectedAccountType) {
      router.replace('/login');
    }
  };

  const registerAccount = async (type) => {
    let createdUser = null;

    try {
      setLoading(true);

      const normalizedEmail = email.trim().toLowerCase();
      const trimmedBarangay = barangay.trim();
      const nextErrors = updateValidation(getFormValues());

      if (hasValidationErrors(nextErrors)) {
        setHasAttemptedSubmit(true);
        setLoading(false);
        return;
      }

      const userCredential = await createUserWithEmailAndPassword(
        auth,
        normalizedEmail,
        password
      );

      const user = userCredential.user;
      createdUser = user;
      const isDistributor = type === 'distributor';
      const userData = {
        uid: user.uid,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: (user.email || normalizedEmail).trim().toLowerCase(),
        phone: phone.trim(),
        barangay: trimmedBarangay,
        address: trimmedBarangay,
        role: type,
        approvalStatus: isDistributor ? 'pending' : 'approved',
        status: isDistributor ? 'Pending' : 'Approved',
        rejectionReason: null,
      };

      const savedProfile = await saveUserProfileWithUniqueId(user.uid, type, {
        ...userData,
        createdAt: serverTimestamp(),
      });
      const savedUserData = {
        ...userData,
        unique_id: savedProfile.unique_id,
      };

      saveLocalUser(savedUserData);

      if (type === 'requester') {
        saveRoleSession(savedUserData);
        router.replace('/requester/r_dashboard');
      } else {
        clearAllAuthSessions();
        await signOut(auth);
        setLoading(false);
        showNotification(
          'Registration Submitted',
          distributorRegistrationMessage,
          () => router.replace('/login')
        );
      }

    } catch (error) {
      console.log('Signup error:', error.message);
      clearAllAuthSessions();
      if (createdUser) {
        try {
          await deleteUser(createdUser);
        } catch (deleteError) {
          console.log('Signup cleanup error:', deleteError.message);
          try {
            await signOut(auth);
          } catch (signOutError) {
            console.log('Signup sign out cleanup error:', signOutError.message);
          }
        }
      }
      showNotification('Signup failed', getAuthErrorMessage(error));
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
            nestedScrollEnabled
            scrollEventThrottle={16}
            onScroll={(event) => {
              scrollOffsetRef.current = event.nativeEvent.contentOffset.y;
            }}
          >

            <View style={styles.dripContainer}>
              <Image source={require('../assets/icons/meltdrop.png')} style={styles.dripImage} resizeMode="cover" />
            </View>

            <View style={styles.logoSection}>
              <Text style={styles.appName}>BlueTap</Text>
              <Text style={styles.tagline}>Water Within Reach</Text>
            </View>

            <View style={styles.formContainer}>
              <View style={styles.inputContainer}>
                <View style={styles.fieldGroup}>
                  <TextInput
                    ref={assignInputRef('firstName')}
                    style={[styles.input, fieldBorderStyle('firstName')]}
                    placeholder="Enter first name"
                    placeholderTextColor="#FFFFFF"
                    value={firstName}
                    onBlur={() => handleFieldBlur('firstName')}
                    onFocus={() => handleInputFocus('firstName')}
                    onChangeText={(value) => handleFieldChange('firstName', value, setFirstName)}
                  />
                  {!!getVisibleError('firstName') && (
                    <Text style={styles.validationText}>{getVisibleError('firstName')}</Text>
                  )}
                </View>

                <View style={styles.fieldGroup}>
                  <TextInput
                    ref={assignInputRef('lastName')}
                    style={[styles.input, fieldBorderStyle('lastName')]}
                    placeholder="Enter last name"
                    placeholderTextColor="#FFFFFF"
                    value={lastName}
                    onBlur={() => handleFieldBlur('lastName')}
                    onFocus={() => handleInputFocus('lastName')}
                    onChangeText={(value) => handleFieldChange('lastName', value, setLastName)}
                  />
                  {!!getVisibleError('lastName') && (
                    <Text style={styles.validationText}>{getVisibleError('lastName')}</Text>
                  )}
                </View>

                <View style={styles.fieldGroup}>
                  <TextInput
                    ref={assignInputRef('email')}
                    style={[styles.input, fieldBorderStyle('email')]}
                    placeholder="Enter email"
                    placeholderTextColor="#FFFFFF"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={email}
                    onBlur={() => handleFieldBlur('email')}
                    onFocus={() => handleInputFocus('email')}
                    onChangeText={(value) => handleFieldChange('email', value, setEmail)}
                  />
                  {!!getVisibleError('email') && (
                    <Text style={styles.validationText}>{getVisibleError('email')}</Text>
                  )}
                </View>

                <View style={styles.fieldGroup}>
                  <TextInput
                    ref={assignInputRef('phone')}
                    style={[styles.input, fieldBorderStyle('phone')]}
                    placeholder="Enter phone number"
                    placeholderTextColor="#FFFFFF"
                    keyboardType="phone-pad"
                    value={phone}
                    onBlur={() => handleFieldBlur('phone')}
                    onFocus={() => handleInputFocus('phone')}
                    onChangeText={(value) => handleFieldChange('phone', value, setPhone)}
                  />
                  {!!getVisibleError('phone') && (
                    <Text style={styles.validationText}>{getVisibleError('phone')}</Text>
                  )}
                </View>

                <View style={styles.fieldGroup}>
                  <TouchableOpacity
                    style={[styles.input, styles.selectInput, fieldBorderStyle('barangay')]}
                    onPress={() => setShowBarangays((isVisible) => !isVisible)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.selectText, !barangay && styles.placeholderText]}>
                      {barangay || 'Select Barangay'}
                    </Text>
                  </TouchableOpacity>
                  {!!getVisibleError('barangay') && (
                    <Text style={styles.validationText}>{getVisibleError('barangay')}</Text>
                  )}
                  {showBarangays && (
                    <ScrollView
                      style={styles.dropdownOptions}
                      nestedScrollEnabled
                      showsVerticalScrollIndicator={false}
                    >
                      {barangayOptions.map((option) => (
                        <TouchableOpacity
                          key={option}
                          style={styles.dropdownOption}
                          onPress={() => selectBarangay(option)}
                        >
                          <Text style={styles.dropdownOptionText}>{option}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}
                </View>

                <View style={styles.fieldGroup}>
                  <TextInput
                    ref={assignInputRef('password')}
                    style={[
                      styles.input,
                      getVisibleError('password') && styles.inputError,
                      hasAttemptedSubmit &&
                        passwordMeetsMinimum &&
                        !getVisibleError('password') &&
                        styles.inputValid,
                    ]}
                    placeholder="Enter password"
                    placeholderTextColor="#FFFFFF"
                    secureTextEntry
                    value={password}
                    onBlur={() => handleFieldBlur('password')}
                    onFocus={() => handleInputFocus('password')}
                    onChangeText={(value) => handleFieldChange('password', value, setPassword)}
                  />
                  {!!getVisibleError('password') && password.length === 0 && (
                    <Text style={styles.validationText}>{getVisibleError('password')}</Text>
                  )}
                  {hasAttemptedSubmit && password.length > 0 && !passwordMeetsMinimum && (
                    <Text style={styles.validationText}>
                      {'\u274C'} Password must be at least 8 characters.
                    </Text>
                  )}
                  {hasAttemptedSubmit && passwordMeetsMinimum && (
                    <Text style={styles.validationSuccessText}>
                      {'\u2705'} Password meets the minimum requirement.
                    </Text>
                  )}
                </View>

                <View style={styles.fieldGroup}>
                  <TextInput
                    ref={assignInputRef('confirmPassword')}
                    style={[
                      styles.input,
                      fieldBorderStyle('confirmPassword'),
                      hasAttemptedSubmit &&
                        confirmPassword.length > 0 &&
                        passwordMeetsMinimum &&
                        password === confirmPassword &&
                        styles.inputValid,
                    ]}
                    placeholder="Confirm password"
                    placeholderTextColor="#FFFFFF"
                    secureTextEntry
                    value={confirmPassword}
                    onBlur={() => handleFieldBlur('confirmPassword')}
                    onFocus={() => handleInputFocus('confirmPassword')}
                    onChangeText={(value) =>
                      handleFieldChange('confirmPassword', value, setConfirmPassword)
                    }
                  />
                  {!!getVisibleError('confirmPassword') && (
                    <Text style={styles.validationText}>
                      {getVisibleError('confirmPassword')}
                    </Text>
                  )}
                </View>
              </View>
            </View>

            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={[styles.continueButton, loading && styles.buttonDisabled]}
                onPress={handleContinue}
                disabled={loading}
              >
                <Text style={styles.continueButtonText}>
                  {loading ? 'PLEASE WAIT...' : 'CONTINUE'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.loginContainer}>
              <Text style={styles.loginText}>
                Already have an account?{' '}
                <Text style={styles.loginLink} onPress={() => router.push('/login')}>
                  Log in.
                </Text>
              </Text>
            </View>

          </ScrollView>
        </View>

        <Modal visible={modalVisible} transparent animationType="slide">
          <View style={styles.modalBackground}>
            <View style={styles.modalContainer}>
              <Text style={styles.modalTitle}>Choose Account Type</Text>

              <TouchableOpacity
                style={styles.modalButton}
                onPress={() => handleAccountType('requester')}
                disabled={loading}
              >
                <Text style={styles.modalButtonText}>Requester</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.modalButton}
                onPress={() => handleAccountType('distributor')}
                disabled={loading}
              >
                <Text style={styles.modalButtonText}>Distributor</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.modalCancel} onPress={closeAccountTypeSelection}>
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
  gradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { flex: 1, width: '100%' },
  phoneWrapper: { width: '100%', maxWidth: 375, alignSelf: 'center', flex: 1 },
  scrollContent: { flexGrow: 1, paddingBottom: BASE_SCROLL_PADDING_BOTTOM },
  dripContainer: { width: '100%', height: 120, alignItems: 'center', overflow: 'hidden' },
  dripImage: { width: '100%', height: '100%' },
  logoSection: { alignItems: 'center', justifyContent: 'center', paddingVertical: 20, marginBottom: 20 },
  appName: { color: '#FFFFFF', fontSize: 36, fontWeight: 'bold', marginBottom: 6 },
  tagline: { color: '#FFFFFF', fontSize: 16, fontWeight: '300' },
  formContainer: { width: '100%', paddingHorizontal: 24, marginBottom: 16 },

  inputContainer: {
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  input: {
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.5)',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
    color: '#FFFFFF',
  },
  fieldGroup: { marginBottom: 12 },
  inputError: {
    borderColor: '#FFCDD2',
    backgroundColor: 'rgba(211, 47, 47, 0.14)',
  },
  inputValid: {
    borderColor: '#C8E6C9',
  },
  validationText: {
    color: '#FFCDD2',
    fontSize: 12,
    marginTop: 4,
  },
  validationSuccessText: {
    color: '#C8E6C9',
    fontSize: 12,
    marginTop: 4,
  },
  selectInput: {
    justifyContent: 'center',
    minHeight: 42,
  },
  selectText: {
    color: '#FFFFFF',
    fontSize: 15,
  },
  placeholderText: {
    color: '#FFFFFF',
  },
  dropdownOptions: {
    maxHeight: 160,
    marginTop: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.45)',
    borderRadius: 10,
    backgroundColor: 'rgba(24, 123, 205, 0.96)',
  },
  dropdownOption: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.15)',
  },
  dropdownOptionText: {
    color: '#FFFFFF',
    fontSize: 14,
  },
  buttonContainer: { width: '100%', paddingHorizontal: 24, marginBottom: 16 },
  continueButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    paddingVertical: 12,
    width: '100%',
    alignItems: 'center',
  },
  continueButtonText: { color: '#187BCD', fontSize: 16, fontWeight: 'bold' },
  buttonDisabled: { opacity: 0.7 },
  loginContainer: { alignItems: 'center', paddingHorizontal: 24, marginBottom: 20 },
  loginText: { color: 'rgba(255, 255, 255, 0.7)', fontSize: 13 },
  loginLink: { color: '#FFFFFF', fontWeight: 'bold' },
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
  modalTitle: { fontSize: 18, fontWeight: 'bold', marginBottom: 20 },
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
  modalButtonText: { color: '#fff', fontWeight: 'bold' },
  modalCancel: { marginTop: 10 },
  modalCancelText: { color: '#187BCD', fontWeight: 'bold' },
});
