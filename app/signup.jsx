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
import { createUserWithEmailAndPassword, deleteUser, signOut } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { saveLocalUser } from '../localUsers';

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

  return nextErrors;
};

const hasValidationErrors = (errors) => Object.keys(errors).length > 0;

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
  const [showBarangays, setShowBarangays] = React.useState(false);
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = React.useState(false);
  const [formErrors, setFormErrors] = React.useState({});
  const [notification, setNotification] = React.useState(null);
  const passwordMeetsMinimum = password.trim().length >= 8;

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
      };

      saveLocalUser(userData);

      try {
        await setDoc(doc(db, 'users', user.uid), {
          ...userData,
          createdAt: serverTimestamp(),
        });
      } catch (error) {
        console.log('Signup profile save error:', error.message);

        if (!isDistributor) {
          throw error;
        }
      }

      if (type === 'requester') {
        router.replace('/requester/r_dashboard');
      } else {
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
      if (createdUser && type !== 'distributor') {
        try {
          await deleteUser(createdUser);
        } catch (deleteError) {
          console.log('Signup cleanup error:', deleteError.message);
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
          <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>

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
                    style={[styles.input, fieldBorderStyle('firstName')]}
                    placeholder="Enter first name"
                    placeholderTextColor="#FFFFFF"
                    value={firstName}
                    onBlur={() => handleFieldBlur('firstName')}
                    onChangeText={(value) => handleFieldChange('firstName', value, setFirstName)}
                  />
                  {!!getVisibleError('firstName') && (
                    <Text style={styles.validationText}>{getVisibleError('firstName')}</Text>
                  )}
                </View>

                <View style={styles.fieldGroup}>
                  <TextInput
                    style={[styles.input, fieldBorderStyle('lastName')]}
                    placeholder="Enter last name"
                    placeholderTextColor="#FFFFFF"
                    value={lastName}
                    onBlur={() => handleFieldBlur('lastName')}
                    onChangeText={(value) => handleFieldChange('lastName', value, setLastName)}
                  />
                  {!!getVisibleError('lastName') && (
                    <Text style={styles.validationText}>{getVisibleError('lastName')}</Text>
                  )}
                </View>

                <View style={styles.fieldGroup}>
                  <TextInput
                    style={[styles.input, fieldBorderStyle('email')]}
                    placeholder="Enter email"
                    placeholderTextColor="#FFFFFF"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    value={email}
                    onBlur={() => handleFieldBlur('email')}
                    onChangeText={(value) => handleFieldChange('email', value, setEmail)}
                  />
                  {!!getVisibleError('email') && (
                    <Text style={styles.validationText}>{getVisibleError('email')}</Text>
                  )}
                </View>

                <View style={styles.fieldGroup}>
                  <TextInput
                    style={[styles.input, fieldBorderStyle('phone')]}
                    placeholder="Enter phone number"
                    placeholderTextColor="#FFFFFF"
                    keyboardType="phone-pad"
                    value={phone}
                    onBlur={() => handleFieldBlur('phone')}
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
  scrollContent: { flexGrow: 1, paddingBottom: 20 },
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
