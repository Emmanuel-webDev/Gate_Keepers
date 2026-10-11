import React, { useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { AppHeader } from '../../src/components/Header';
import { Body, Btn, fmt, H1, Mono, Row, Screen } from '../../src/components/ui';
import { useWallet } from '../../src/wallet/WalletProvider';
import { useOrganizer } from '../../src/organizer/OrganizerProvider';
import { api } from '../../src/lib/api';
import { tabScreenOptions } from '../../src/components/tabs';
import { c, f, r } from '../../src/lib/theme';

export default function OrganizerLayout() {
  const { ready, publicKey } = useWallet();
  const org = useOrganizer();
  if (ready && !publicKey) return <Redirect href="/" />;
  if (org.loading) return <Screen><AppHeader /><ActivityIndicator color={c.green} style={{ marginTop: 60 }} /></Screen>;
  if (!org.authed) return <Gate />;

  const icon = (name: any) => ({ color }: { color: any }) => <Ionicons name={name} size={24} color={color} />;
  return (
    <Tabs screenOptions={tabScreenOptions as any}>
      <Tabs.Screen name="scan" options={{ title: 'Scan', tabBarIcon: icon('scan-outline') }} />
      <Tabs.Screen name="mint" options={{ title: 'Mint', tabBarIcon: icon('add-circle-outline') }} />
      <Tabs.Screen name="bonds" options={{ title: 'Bonds', tabBarIcon: icon('shield-checkmark-outline') }} />
    </Tabs>
  );
}

/** Organizer mode is locked behind an on-chain SKR stake. */
function Gate() {
  const { publicKey } = useWallet();
  const org = useOrganizer();
  const [busy, setBusy] = useState<string | null>(null);
  const [bal, setBal] = useState<number | null>(null);

  React.useEffect(() => { if (publicKey) api.balance(publicKey.toBase58()).then((b) => setBal(b.balance)).catch(() => {}); }, [publicKey, busy]);

  const run = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try { await fn(); } catch (e: any) { Alert.alert('Something went wrong', e.message); } finally { setBusy(null); }
  };
  const short = bal !== null && bal < org.required;

  return (
    <Screen>
      <AppHeader />
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 10, gap: 14 }}>
        <Mono>Organizer access</Mono>
        <H1>Lock SKR to run the door.</H1>
        {org.sessionError ? (
          <View style={s.alert}>
            <Ionicons name="warning-outline" size={18} color="#FF5252" />
            <Text style={s.alertText}>{org.sessionError}</Text>
          </View>
        ) : null}
        <Body>Organizers mint tickets, scan at the gate and flag resales. A stake keeps fake organizers out. It comes back in full when you unstake.</Body>

        <View style={s.card}>
          <Row label="Required stake" value={`${fmt(org.required)} SKR`} strong />
          <Row label="Your balance" value={bal === null ? '…' : `${fmt(bal)} SKR`} />
          <View style={{ gap: 8, paddingTop: 14 }}>
            {['Mint cNFT tickets to any wallet', 'Scan and check in attendees', 'Slash or refund transfer bonds'].map((t) => (
              <View key={t} style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
                <Ionicons name="checkmark-circle" size={18} color={c.green} />
                <Text style={s.li}>{t}</Text>
              </View>
            ))}
          </View>
        </View>

        {org.staked ? (
          <Btn label="Unlock dashboard" onPress={() => run('login', org.login)} busy={busy === 'login'} icon={<Ionicons name="lock-open-outline" size={20} color={c.greenInk} />} />
        ) : (
          <>
            {short && (
              <Btn kind="dark" label="Get 1,000 test SKR" busy={busy === 'faucet'} onPress={() => run('faucet', async () => { await api.faucet(publicKey!.toBase58()); })} />
            )}
            <Btn label={`Lock ${fmt(org.required)} SKR`} onPress={() => run('stake', org.stake)} busy={busy === 'stake'} disabled={short} icon={<Ionicons name="lock-closed-outline" size={20} color={c.greenInk} />} />
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: c.surface, borderRadius: r.card, padding: 18, borderWidth: 1, borderColor: '#1F1F2B' },
  li: { color: c.text, fontFamily: f.semi, fontSize: 15 },
  alert: {
    backgroundColor: '#2A1818',
    borderColor: '#FF5252',
    borderWidth: 1,
    borderRadius: r.card,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  alertText: { color: '#FF8888', fontFamily: f.semi, fontSize: 14, flex: 1 },
});
