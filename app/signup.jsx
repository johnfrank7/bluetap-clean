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
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';

export default function SignupPage() {
  const router = useRouter();
  const [modalVisible, setModalVisible] = React.useState(false);

  const [firstName, setFirstName] = React.useState('');
  const [lastName, setLastName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [phone, setPhone] = React.useState('');
  const [address, setAddress] = React.useState('');
  const [password, setPassword] = React.useState('');

  const handleContinue = () => {
    setModalVisible(true);
  };

  const handleAccountType = async (type) => {
    try {
      setModalVisible(false);

      const userCredential = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      const user = userCredential.user;

      await setDoc(doc(db, 'users', user.uid), {
        firstName: firstName,
        lastName: lastName,
        email: user.email,
        phone: phone,
        address: address,
        role: type,
        createdAt: serverTimestamp(),
      });

      if (type === 'requester') {
        router.replace('/requester/r_dashboard');
      } else {
        router.replace('/distributor/d_dashboard');
      }

    } catch (error) {
      console.log('Signup error:', error.message);
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
              <TouchableOpacity style={styles.continueButton} onPress={handleContinue}>
                <Text style={styles.continueButtonText}>CONTINUE</Text>
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

              <TouchableOpacity style={styles.modalButton} onPress={() => handleAccountType('requester')}>
                <Text style={styles.modalButtonText}>Requester</Text>
              </TouchableOpacity>

              <TouchableOpacity style={styles.modalButton} onPress={() => handleAccountType('distributor')}>
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
