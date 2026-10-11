import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Manrope_400Regular, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold } from '@expo-google-fonts/manrope';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { WalletProvider } from '../src/wallet/WalletProvider';
import { OrganizerProvider } from '../src/organizer/OrganizerProvider';
import { c } from '../src/lib/theme';

export default function Root() {
  const [loaded] = useFonts({
    Manrope_400Regular, Manrope_600SemiBold, Manrope_700Bold, Manrope_800ExtraBold,
    JetBrainsMono_400Regular, JetBrainsMono_500Medium,
  });
  if (!loaded) return null;
  return (
    <WalletProvider>
      <OrganizerProvider>
        <StatusBar style="light" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
          <Stack.Screen name="pass" options={{ presentation: 'modal', animation: 'slide_from_bottom' }} />
        </Stack>
      </OrganizerProvider>
    </WalletProvider>
  );
}
