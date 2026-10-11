import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { api, BondView } from '../../src/lib/api';
import { useOrganizer } from '../../src/organizer/OrganizerProvider';
import { Body, Btn, fmt, H1, Mono, Pill, Screen, seatLabel, short } from '../../src/components/ui';
import { c, f, r } from '../../src/lib/theme';

/** Every bond currently in escrow. Slashing = "flag as resale"; the buyer's ticket stays valid. */
export default function Bonds() {
  const org = useOrganizer();
  const [bonds, setBonds] = useState<BondView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setBonds(await api.orgBonds()); } catch (e: any) { Alert.alert('Could not load bonds', e.message); } finally { setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const resolve = (b: BondView, slash: boolean) => {
    const go = async () => {
      setBusy(b.assetId + slash);
      try { await api.orgResolve(b.assetId, slash); await load(); }
      catch (e: any) { Alert.alert('Failed', e.message); } finally { setBusy(null); }
    };
    if (!slash) return go();
    Alert.alert('Flag as resale?', `${fmt(b.amount)} SKR from ${short(b.seller)} goes to the treasury. The buyer's ticket stays valid.`, [
      { text: 'Cancel', style: 'cancel' }, { text: 'Slash bond', style: 'destructive', onPress: go },
    ]);
  };

  const leave = () => Alert.alert('Unstake?', `You get your ${fmt(org.required)} SKR back and organizer tools lock again.`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Unstake', onPress: async () => { try { await org.unstake(); } catch (e: any) { Alert.alert('Unstake failed', e.message); } } },
  ]);

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.green} />}>
        <Mono>Escrow</Mono>
        <H1 style={{ marginBottom: 12 }}>Bonds held</H1>
        {bonds.length === 0 && <Body>No bonds in escrow. They appear here when attendees transfer tickets, and clear when the buyer checks in.</Body>}
        {bonds.map((b) => (
          <View key={b.assetId + b.ts} style={s.card}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={s.name} numberOfLines={1}>{b.eventName} · {seatLabel(b.seat)}</Text>
              <Pill text={`${fmt(b.amount)} SKR`} tone="purple" />
            </View>
            <Text style={s.meta}>{short(b.seller)} → {short(b.to)} · asked {fmt(b.priceSkr)} SKR</Text>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Btn kind="danger" label="Flag as resale" onPress={() => resolve(b, true)} busy={busy === b.assetId + true} style={{ flex: 1.3 }} />
              <Btn kind="dark" label="Refund" onPress={() => resolve(b, false)} busy={busy === b.assetId + false} style={{ flex: 1 }} />
            </View>
          </View>
        ))}
        <View style={{ marginTop: 24 }}>
          <Btn kind="ghost" label="Unstake and leave organizer mode" onPress={leave} />
        </View>
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: c.surface, borderRadius: r.card, padding: 18, marginBottom: 12, gap: 14, borderWidth: 1, borderColor: '#1F1F2B' },
  name: { flex: 1, color: c.text, fontFamily: f.bold, fontSize: 17, marginRight: 10 },
  meta: { color: c.mute, fontFamily: f.mono, fontSize: 12 },
});
