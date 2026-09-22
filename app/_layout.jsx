import { Stack } from 'expo-router';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import WebUpdateBanner from '../components/WebUpdateBanner';
import { BlueTapThemeProvider } from '../components/BlueTapTheme';
import '../global.css';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <BlueTapThemeProvider>
          <View style={{ flex: 1 }}>
            <Stack
              screenOptions={{
                headerShown: false,
              }}
            />
            <WebUpdateBanner />
          </View>
        </BlueTapThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
