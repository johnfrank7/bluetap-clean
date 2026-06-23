import { StatusBar } from 'expo-status-bar';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

export default function CoverPage() {
  const router = useRouter();

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.content}>
        <View style={styles.logoContainer}>
          
          <View style={styles.pinContainer}>
            <Image
              source={require('../assets/icons/bluetapwhitelogo.png')}
              style={styles.locationPin}
              resizeMode="contain"
            />
          </View>
        </View>
        

        <Text style={styles.appName}>
          BlueTap
        </Text>
        
        <Text style={styles.tagline}>
          Water Within Reach
        </Text>
        
        <TouchableOpacity style={styles.enterButton} onPress={() => router.push('/login')}>
          <Text style={styles.enterButtonText}>Enter</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#187BCD',
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 50,
  },
  logoContainer: {
    position: 'relative',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  waterDroplet: {
    width: 128,
    height: 128,
  },
  pinContainer: {
    position: 'absolute',
    bottom: 16,
  },
  locationPin: {
    width: 160,
    height: 160,
  },
  appName: {
    color: '#FFFFFF',
    fontSize: 48,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  tagline: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '300',
    textAlign: 'center',
    marginBottom: 48,
  },
  enterButton: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 48,
    paddingVertical: 16,
    borderRadius: 30,
    marginTop: 32,
  },
  enterButtonText: {
    color: '#007AFF',
    fontSize: 18,
    fontWeight: '600',
  },
});
