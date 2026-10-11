import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Clipboard from 'expo-clipboard';
import { useWallet } from '../../src/wallet/WalletProvider';
import { api, BondView, Ticket } from '../../src/lib/api';
import { TicketCard } from '../../src/components/TicketCard';
import { Body, Btn, H1, Mono, Screen, short } from '../../src/components/ui';
import { c } from '../../src/lib/theme';

export default function Tickets() {
  const { publicKey } = useWallet();
  const router = useRouter();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [sent, setSent] = useState<BondView[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!publicKey) return;
    setLoading(true);
    try {
      const w = publicKey.toBase58();
      const [t, b] = await Promise.all([api.tickets(w), api.transfers(w)]);
      setTickets(t); setSent(b.filter((x) => x.status === 'locked')); setLoaded(true);
    } catch (e: any) { Alert.alert('Could not load tickets', e.message); }
    finally { setLoading(false); }
  }, [publicKey]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingTop: 8, paddingBottom: 110 }}
        showsVerticalScrollIndicator={true}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={c.green} />}
      >
        <H1 style={{ marginBottom: 14 }}>My tickets</H1>

        {tickets.map((t) => (
          <TicketCard
            key={t.assetId} title={t.name} date={t.date} venue={t.venue} seat={t.seat}
            tab={t.tier === 'VIP Access' ? 'vip' : 'general'} chip="Tap for pass"
            checkedInAt={t.checkedInAt}
            onPress={t.checkedInAt ? undefined : () => router.push({ pathname: '/pass', params: { t: JSON.stringify(t) } })}
          />
        ))}

        {loaded && tickets.length === 0 && (
          <View style={{ gap: 14, marginVertical: 10 }}>
            <Body>No tickets in this wallet yet. Ask an organizer to mint one to your address, or become an organizer and mint your own.</Body>
            <Btn kind="dark" label={`Copy my address (${short(publicKey!.toBase58())})`} onPress={() => { Clipboard.setStringAsync(publicKey!.toBase58()); Alert.alert('Address copied'); }} />
          </View>
        )}

        {sent.length > 0 && (
          <>
            <Mono style={{ marginTop: 6, marginBottom: 12 }}>Transferred · bond held</Mono>
            {sent.map((b) => (
              <TicketCard key={b.assetId + b.ts} title={b.eventName} date={b.date} venue={b.venue} seat={b.seat} tab="bond" chip={`Sent to ${short(b.to)}`} chipTone="purple" />
            ))}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}
