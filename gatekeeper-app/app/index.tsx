import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useWallet } from '../src/wallet/WalletProvider';
import { Logo } from '../src/components/Header';
import { TicketCard } from '../src/components/TicketCard';
import { Body, Btn, Mono, Screen } from '../src/components/ui';
import { c, f } from '../src/lib/theme';

export default function Landing() {
  const { ready, publicKey, supported, connect } = useWallet();
  const [busy, setBusy] = useState(false);
  if (!ready) return <Screen />;
  if (publicKey) return <Redirect href="/(attendee)/tickets" />;

  const go = async () => {
    setBusy(true);
    try { await connect(); } catch (e: any) { Alert.alert('Could not connect', e.message); } finally { setBusy(false); }
  };

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, flexGrow: 1 }} showsVerticalScrollIndicator={false}>
          <Logo />
          <View style={s.stack}>
            <View style={[s.back, { transform: [{ rotate: '-5deg' }] }]}>
              <TicketCard title="Breakpoint Main Stage" date="2026-10-17T18:00:00" venue="Main Hall" seat="VIP-0007" tab="vip" chip="VIP pass" />
            </View>
            <View style={[s.front, { transform: [{ rotate: '-3deg' }] }]}>
              <TicketCard title="Accelerate Builders Night" date="2026-10-24T19:30:00" venue="Rooftop Lounge" seat="GA-0014" tab="general" chip="Tap for pass" />
            </View>
          </View>

          <View style={{ flex: 1 }} />
          <Mono>Solana Seeker · Devnet</Mono>
          <Text style={s.h}>Face value.</Text>
          <Text style={s.h}>
            <Text style={{ color: '#8A6BFF' }}>Full </Text>
            <Text style={{ color: '#35B7C9' }}>stop</Text>
            <Text style={{ color: c.green }}>.</Text>
          </Text>
          <Body style={{ fontSize: 18, lineHeight: 26, marginTop: 6, marginBottom: 22 }}>
            Tickets live as cNFTs in your wallet. Your phone signs the pass, live.
          </Body>
          <Btn label="Connect wallet" onPress={go} busy={busy} disabled={!supported} icon={<Ionicons name="wallet-outline" size={20} color={c.greenInk} />} />
          {!supported && <Body style={{ marginTop: 12, textAlign: 'center', fontSize: 13 }}>This build can't reach wallet apps. Install the GateKeeper APK from EAS (Expo Go doesn't support wallets).</Body>}
        </ScrollView>
      </SafeAreaView>
    </Screen>
  );
}

const s = StyleSheet.create({
  stack: { height: 330, marginTop: 14 },
  back: { position: 'absolute', top: 0, left: 8, right: -6, opacity: 0.85 },
  front: { position: 'absolute', top: 110, left: -8, right: 12 },
  h: { color: c.text, fontFamily: f.heavy, fontSize: 56, letterSpacing: -2, lineHeight: 60 },
});
