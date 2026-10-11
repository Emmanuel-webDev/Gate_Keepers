import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWallet } from '../../src/wallet/WalletProvider';
import { tabScreenOptions } from '../../src/components/tabs';

export default function AttendeeLayout() {
  const { ready, publicKey } = useWallet();
  if (ready && !publicKey) return <Redirect href="/" />;
  const icon = (name: any) => ({ color }: { color: any }) => <Ionicons name={name} size={24} color={color} />;
  return (
    <Tabs screenOptions={tabScreenOptions as any}>
      <Tabs.Screen name="tickets" options={{ title: 'Tickets', tabBarIcon: icon('ticket-outline') }} />
      <Tabs.Screen name="skr" options={{ title: 'SKR', tabBarIcon: icon('link-outline') }} />
    </Tabs>
  );
}
