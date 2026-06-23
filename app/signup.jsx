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
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';

import { auth, db } from '../firebase';
import { createUserWithEmailAndPassword, deleteUser, signOut } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { saveLocalUser } from '../localUsers';

const authErrorMessages = {
  'auth/email-already-in-use': 'This email is already registered. Please log in instead.',
  'auth/invalid-email': 'Please enter a valid email address.',
  'auth/weak-password': 'Password should be at least 6 characters.',
  'auth/network-request-failed': 'Network error. Please check your connection and try again.',
  'permission-denied': 'The account was created, but Firestore blocked saving the profile. Please check Firestore rules.',
};

const getAuthErrorMessage = (error) =>
  authErrorMessages[error?.code] || error?.message || 'Something went wrong. Please try again.';

export default function SignupPage() {
  const router = useRouter();
  const [modalVisible, setModalVisible] = React.useState(false);
  const [loading, setLoading] = React.useState(false);

  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [password, setPassword] = React.useState('');

  const handleContinue = () => {
    if (
      !firstName.trim() ||
      !lastName.trim() ||
      !email.trim() ||
      !phone.trim() ||
      !address.trim() ||
      !password.trim()
    ) {
      Alert.alert('Missing details', 'Please complete all fields before continuing.');
      return;
    }

    setModalVisible(true);
  };

  const handleAccountType = async (type) => {
    let createdUser = null;

    try {
      setModalVisible(false);
      setLoading(true);

      const normalizedEmail = email.trim().toLowerCase();

      const userCredential = await createUserWithEmailAndPassword(
        auth,
        normalizedEmail,
        password.trim()
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
        address: address.trim(),
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
        Alert.alert(
          'Registration submitted',
          'Your distributor account is pending admin approval. You can log in after it is accepted.'
        );
        router.replace('/login');
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
      Alert.alert('Signup failed', getAuthErrorMessage(error));
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
                <TextInput style={styles.input} placeholder="Enter first name" placeholderTextColor="#FFFFFF" onChangeText={setFirstName} />
                <TextInput style={styles.input} placeholder="Enter last name" placeholderTextColor="#FFFFFF" onChangeText={setLastName} />
                <TextInput style={styles.input} placeholder="Enter email" placeholderTextColor="#FFFFFF" keyboardType="email-address" autoCapitalize="none" onChangeText={setEmail} />
                <TextInput style={styles.input} placeholder="Enter phone number" placeholderTextColor="#FFFFFF" keyboardType="phone-pad" onChangeText={setPhone} />
                <TextInput style={styles.input} placeholder="Enter home address" placeholderTextColor="#FFFFFF" onChangeText={setAddress} />
                <TextInput style={styles.input} placeholder="Enter password" placeholderTextColor="#FFFFFF" secureTextEntry onChangeText={setPassword} />
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

              <TouchableOpacity style={styles.modalCancel} onPress={() => setModalVisible(false)}>
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
    marginBottom: 12,
    color: '#FFFFFF',
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
