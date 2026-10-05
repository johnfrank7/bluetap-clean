import { Stack } from 'expo-router';
import { View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import WebUpdateBanner from '../components/WebUpdateBanner';
import { BlueTapThemeProvider, useBlueTapTheme } from '../components/BlueTapTheme';
import { BlueTapThemeTransitionProvider } from '../components/BlueTapThemeTransition';
import '../global.css';

function ThemedApplication() {
  const { isDark } = useBlueTapTheme();

  return (
    <View dataSet={{ bluetapTheme: isDark ? 'dark' : 'light' }} style={{ flex: 1 }}>
      <Stack
        screenOptions={{
          headerShown: false,
        }}
      />
      <WebUpdateBanner />
    </View>
  );
}

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <BlueTapThemeTransitionProvider>
          <BlueTapThemeProvider>
            <ThemedApplication />
          </BlueTapThemeProvider>
        </BlueTapThemeTransitionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
