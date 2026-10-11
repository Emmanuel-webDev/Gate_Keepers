import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useWallet } from '../../src/wallet/WalletProvider';
import { api, BondView, Config } from '../../src/lib/api';
import { Body, Btn, fmt, H1, Mono, Pill, Screen, short } from '../../src/components/ui';
import { c, f, r } from '../../src/lib/theme';

export default function Skr() {
  const { publicKey } = useWallet();
  const [bal, setBal] = useState<number | null>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [bonds, setBonds] = useState<BondView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    try {
      const w = publicKey.toBase58();
      const [b, cf, bd] = await Promise.all([api.balance(w), api.config(), api.transfers(w)]);
      setBal(b.balance); setCfg(cf); setBonds(bd);
    } catch (e: any) { Alert.alert('Could not load', e.message); } finally { setLoading(false); }
  }, [publicKey]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const faucet = async () => {
    if (!publicKey) return;
    setBusy(true);
    try { await api.faucet(publicKey.toBase58()); await load(); }
    catch (e: any) { Alert.alert('Faucet failed', e.message); } finally { setBusy(false); }
  };

  const tone = (st: BondView['status']) => (st === 'slashed' ? 'red' : st === 'returned' ? 'green' : 'purple');
  const word = (st: BondView['status']) => (st === 'locked' ? 'locked' : st);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.green} />}>
        <Mono>{cfg?.mock === false ? 'SKR · mainnet' : 'Mock SKR · devnet'}</Mono>
        <Text style={s.big}>{bal === null ? '…' : fmt(bal)}</Text>
        <Body>Available for bonds and VIP burns</Body>
        {cfg?.mock !== false && (
          <View style={{ marginTop: 16 }}>
            <Btn kind="dark" label="Get 1,000 test SKR" onPress={faucet} busy={busy} />
          </View>
        )}

        <H1 style={{ fontSize: 24, marginTop: 28, marginBottom: 12, letterSpacing: -0.4 }}>Anti-scalping bonds</H1>
        {bonds.length === 0 && (
          <Body>None yet. Transfer a ticket and {cfg?.bondAmount ?? 250} SKR sits in escrow until the new holder checks in.</Body>
        )}
        {bonds.map((b) => (
          <View key={b.assetId + b.ts} style={s.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={s.name} numberOfLines={1}>{b.eventName}</Text>
              <Pill text={`${fmt(b.amount)} SKR ${word(b.status)}`} tone={tone(b.status)} />
            </View>
            <Text style={s.meta}>to {short(b.to)} · {fmt(b.priceSkr)} SKR</Text>
          </View>
        ))}
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  big: { color: c.text, fontFamily: f.monoM, fontSize: 84, letterSpacing: -3, marginTop: 4, marginBottom: 2 },
  card: { backgroundColor: c.surface, borderRadius: r.card, padding: 18, marginBottom: 12, gap: 14, borderWidth: 1, borderColor: '#1F1F2B' },
  name: { flex: 1, color: c.text, fontFamily: f.bold, fontSize: 18, marginRight: 10 },
  meta: { color: c.mute, fontFamily: f.mono, fontSize: 13 },
});
