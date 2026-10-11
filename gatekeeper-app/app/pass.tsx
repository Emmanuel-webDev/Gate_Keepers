import { Buffer } from 'buffer';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { VersionedTransaction } from '@solana/web3.js';
import { useWallet } from '../src/wallet/WalletProvider';
import { api, Config, Ticket } from '../src/lib/api';
import { buildQr, ensureSession, Session } from '../src/lib/qr';
import { signAndRelay } from '../src/lib/tx';
import { QrRing } from '../src/components/QrRing';
import { Body, Btn, fmt, Mono, Row, Screen, seatLabel, Sheet } from '../src/components/ui';
import { c, f, r } from '../src/lib/theme';

const CYCLE_MS = 45_000; // the gate accepts a code for 60 s; we re-sign every 45 s

const decode = (b: string) => VersionedTransaction.deserialize(Buffer.from(b, 'base64'));
const encode = (t: VersionedTransaction) => Buffer.from(t.serialize()).toString('base64');
const fmtHHMM = (iso: string) => {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function Pass() {
  const { t } = useLocalSearchParams<{ t: string }>();
  const ticket: Ticket = JSON.parse(t);
  const router = useRouter();
  const { publicKey, signMessage, signTransactions } = useWallet();
  const wallet = publicKey!.toBase58();

  const [session, setSession] = useState<Session | null>(null);
  const [err, setErr] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [qr, setQr] = useState({ payload: '', sig: '', at: 0 });
  const [now, setNow] = useState(Date.now());
  const [tier, setTier] = useState(ticket.tier);
  const [checkedInAt, setCheckedInAt] = useState<string | null>(ticket.checkedInAt ?? null);
  const [sheet, setSheet] = useState<null | 'transfer' | 'vip'>(null);
  const [cfg, setCfg] = useState<Config | null>(null);
  const [bal, setBal] = useState<number | null>(null);

  useEffect(() => {
    if (checkedInAt) return;
    const interval = setInterval(async () => {
      try {
        const res = await api.ticket(ticket.assetId);
        if (res.checkedInAt) {
          setCheckedInAt(res.checkedInAt);
        }
      } catch {
        // ignore polling network errors
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [checkedInAt, ticket.assetId]);

  useEffect(() => {
    if (checkedInAt && sheet) {
      setSheet(null);
    }
  }, [checkedInAt, sheet]);

  const unlock = useCallback(async () => {
    setUnlocking(true); setErr('');
    try { setSession(await ensureSession(wallet, signMessage)); }
    catch (e: any) { setErr(e.message ?? 'Your wallet did not sign'); }
    finally { setUnlocking(false); }
  }, [wallet, signMessage]);
  useEffect(() => { unlock(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const resign = useCallback(() => {
    if (!session) return;
    setQr({ ...buildQr(session, ticket.assetId), at: Date.now() });
  }, [session, ticket.assetId]);

  const atRef = useRef(0);
  atRef.current = qr.at;
  useEffect(() => {
    if (!session || checkedInAt) return;
    resign();
    const id = setInterval(() => {
      setNow(Date.now());
      if (Date.now() - atRef.current >= CYCLE_MS) resign();
    }, 250);
    return () => clearInterval(id);
  }, [session, resign, checkedInAt]);

  useEffect(() => { api.config().then(setCfg).catch(() => {}); }, []);
  useEffect(() => { if (sheet) api.balance(wallet).then((b) => setBal(b.balance)).catch(() => {}); }, [sheet, wallet]);

  const left = Math.max(0, Math.ceil((CYCLE_MS - (now - qr.at)) / 1000));
  const progress = qr.at ? Math.max(0, 1 - (now - qr.at) / CYCLE_MS) : 0;
  const isVip = tier === 'VIP Access';
  const d = new Date(ticket.date);

  return (
    <Screen>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 130 }} showsVerticalScrollIndicator={false}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Mono>{isVip ? 'VIP access' : 'General admission'} · {seatLabel(ticket.seat)}</Mono>
              <Text style={s.title}>{ticket.name}</Text>
            </View>
            <Pressable onPress={() => router.back()} style={s.close} hitSlop={10}>
              <Ionicons name="close" size={22} color={c.text} />
            </Pressable>
          </View>

          {checkedInAt ? (
            <View style={s.checkedInBox}>
              <View style={s.checkedInCircle}>
                <Ionicons name="checkmark-circle" size={44} color={c.green} />
              </View>
              <Text style={s.checkedInTitle}>Checked in at {fmtHHMM(checkedInAt)}</Text>
              <Text style={s.checkedInSub}>This pass has been verified and used at the gate.</Text>
            </View>
          ) : session ? (
            <View style={{ alignItems: 'center', marginTop: 14 }}>
              <QrRing value={qr.payload} progress={progress} />
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 18 }}>
                <Text style={s.secs}>{left}s</Text>
                <Text style={s.secsLbl}>until your phone re-signs</Text>
              </View>
              {!!qr.sig && <Text style={s.sig}>sig {qr.sig.slice(0, 12)}…</Text>}
              <Pressable onPress={resign} style={s.resign}>
                <Ionicons name="refresh" size={18} color={c.text} />
                <Text style={s.resignText}>Re-sign now</Text>
              </Pressable>
            </View>
          ) : (
            <View style={s.locked}>
              <Ionicons name="lock-closed-outline" size={34} color={c.mute} />
              <Body style={{ textAlign: 'center' }}>Approve once in your wallet to switch on your live entry pass.</Body>
              <Btn label="Unlock pass" onPress={unlock} busy={unlocking} style={{ alignSelf: 'stretch' }} />
              {!!err && <Text style={{ color: c.redText, textAlign: 'center', fontFamily: f.semi }}>{err}</Text>}
            </View>
          )}

          <View style={{ marginTop: 26 }}>
            <View style={s.line}>
              <Text style={s.lineL}>{d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · {d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</Text>
              <Text style={s.lineR}>{ticket.venue}</Text>
            </View>
            <Row label="Face value" value={`${fmt(ticket.faceValueSkr)} SKR`} />
          </View>
        </ScrollView>

        <View style={s.actions}>
          <Btn kind="dark" label="Transfer" disabled={!!checkedInAt} onPress={() => setSheet('transfer')} icon={<Ionicons name="paper-plane-outline" size={20} color={c.text} />} style={{ flex: 1 }} />
          {isVip ? (
            <Btn kind="ghost" label="VIP active" disabled onPress={() => {}} style={{ flex: 1 }} icon={<Ionicons name="checkmark-circle" size={20} color={c.green} />} />
          ) : (
            <Btn kind="grad" label="Go VIP" disabled={!!checkedInAt} onPress={() => setSheet('vip')} icon={<Ionicons name="sparkles" size={20} color="#fff" />} style={{ flex: 1 }} />
          )}
        </View>
      </SafeAreaView>

      <Sheet visible={sheet === 'transfer'} onClose={() => setSheet(null)}>
        <TransferSheet
          ticket={ticket} wallet={wallet} bondAmount={cfg?.bondAmount ?? 250} balance={bal}
          sign={signTransactions}
          onDone={() => { setSheet(null); router.back(); }}
        />
      </Sheet>
      <Sheet visible={sheet === 'vip'} onClose={() => setSheet(null)}>
        <VipSheet
          ticket={ticket} wallet={wallet} burn={cfg?.vipAmount ?? 500} balance={bal}
          sign={signTransactions}
          onDone={() => { setTier('VIP Access'); setSheet(null); }}
        />
      </Sheet>
    </Screen>
  );
}

type Signer = (txs: VersionedTransaction[]) => Promise<VersionedTransaction[]>;

function TransferSheet({ ticket, wallet, bondAmount, balance, sign, onDone }: {
  ticket: Ticket; wallet: string; bondAmount: number; balance: number | null; sign: Signer; onDone: () => void;
}) {
  const [to, setTo] = useState('');
  const [price, setPrice] = useState(String(ticket.faceValueSkr));
  const [busy, setBusy] = useState(false);
  const p = Number(price);
  const over = Number.isFinite(p) && p > ticket.faceValueSkr;
  const bad = !Number.isFinite(p) || p < 0 || over || to.trim().length < 32;

  const send = async () => {
    setBusy(true);
    try {
      const prep = await api.prepareTransfer(ticket.assetId, wallet, to.trim(), p);
      const [bondTx, transferTx] = await sign([decode(prep.bondTx), decode(prep.transferTx)]);
      await api.relay(encode(bondTx)); // 1) bond into escrow
      try {
        await api.relay(encode(transferTx)); // 2) ticket moves
      } catch (e: any) {
        await api.rollbackTransfer(ticket.assetId, wallet).catch(() => {});
        throw new Error(`The ticket did not transfer, so your bond was refunded. (${e.message})`);
      }
      Alert.alert('Ticket sent', `${fmt(prep.bondAmount)} SKR is held in escrow. You get it back when they check in.`, [{ text: 'OK', onPress: onDone }]);
    } catch (e: any) { Alert.alert('Transfer failed', e.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      <Text style={s.sheetTitle}>Transfer at face value</Text>
      <Body>Your SKR bond comes back when they check in.</Body>
      <Mono>Recipient</Mono>
      <TextInput value={to} onChangeText={setTo} placeholder="Wallet address" placeholderTextColor={c.mute} autoCapitalize="none" autoCorrect={false} style={s.input} />
      <Text style={[s.cap, { marginTop: -4 }]}>Only transfers made here are honored at the gate.</Text>
      <Mono>Asking price (SKR)</Mono>
      <TextInput value={price} onChangeText={setPrice} keyboardType="decimal-pad" style={s.input} />
      <Text style={[s.cap, over && { color: c.redText }]}>{over ? `Over the cap. Max ${fmt(ticket.faceValueSkr)} SKR` : `Cap: ${fmt(ticket.faceValueSkr)} SKR face value`}</Text>
      <Row label="Bond locked" value={`${fmt(bondAmount)} SKR`} />
      <Row label="SKR after" value={balance === null ? '…' : fmt(balance - bondAmount)} strong />
      <Btn label="Lock bond & send" onPress={send} busy={busy} disabled={bad} icon={<Ionicons name="shield-checkmark-outline" size={20} color={c.greenInk} />} />
    </>
  );
}

function VipSheet({ ticket, wallet, burn, balance, sign, onDone }: {
  ticket: Ticket; wallet: string; burn: number; balance: number | null; sign: Signer; onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const { tx } = await api.prepareVip(ticket.assetId, wallet);
      await signAndRelay(sign, [tx]);
      Alert.alert('VIP unlocked', `${fmt(burn)} SKR burned. Your pass now scans as VIP.`);
      onDone();
    } catch (e: any) { Alert.alert('Upgrade failed', e.message); }
    finally { setBusy(false); }
  };
  return (
    <>
      <View style={s.fire}><Ionicons name="flame-outline" size={26} color={c.text} /></View>
      <Text style={s.sheetTitle}>Burn {fmt(burn)} SKR for VIP</Text>
      <Body>Marks this ticket VIP on-chain. No refund.</Body>
      <Row label={`Seat ${seatLabel(ticket.seat)}`} value="General → VIP Access" strong />
      <Row label="SKR after" value={balance === null ? '…' : fmt(balance - burn)} strong />
      <Btn kind="grad" label="Burn & upgrade" onPress={go} busy={busy} icon={<Ionicons name="flame-outline" size={20} color="#fff" />} />
    </>
  );
}

const s = StyleSheet.create({
  title: { color: c.text, fontFamily: f.heavy, fontSize: 30, letterSpacing: -0.8, marginTop: 6 },
  close: { width: 46, height: 46, borderRadius: 14, backgroundColor: c.surface2, alignItems: 'center', justifyContent: 'center' },
  secs: { color: c.green, fontFamily: f.monoM, fontSize: 40 },
  secsLbl: { color: c.mute, fontFamily: f.reg, fontSize: 16 },
  sig: { color: c.mute, fontFamily: f.mono, fontSize: 13, marginTop: 10 },
  resign: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: c.surface2, paddingHorizontal: 18, paddingVertical: 12, borderRadius: r.btn, marginTop: 14 },
  resignText: { color: c.text, fontFamily: f.bold, fontSize: 15 },
  locked: { alignItems: 'center', gap: 16, backgroundColor: c.surface, borderRadius: r.card, padding: 26, marginTop: 20 },
  line: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12 },
  lineL: { color: c.mute, fontFamily: f.reg, fontSize: 15 },
  lineR: { color: c.text, fontFamily: f.bold, fontSize: 15 },
  actions: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 12, padding: 20, paddingBottom: 28, backgroundColor: 'rgba(8,8,12,0.94)' },
  sheetTitle: { color: c.text, fontFamily: f.heavy, fontSize: 26, letterSpacing: -0.5 },
  input: { backgroundColor: '#0B0B11', color: c.text, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 16, fontFamily: f.mono, fontSize: 15, borderWidth: 1, borderColor: c.line },
  cap: { color: c.mute, fontFamily: f.reg, fontSize: 14 },
  fire: { width: 56, height: 56, borderRadius: 18, backgroundColor: '#5B3DC4', alignItems: 'center', justifyContent: 'center' },
  checkedInBox: { alignItems: 'center', backgroundColor: c.surface, borderRadius: r.card, padding: 32, marginTop: 20, borderWidth: 1, borderColor: 'rgba(74, 222, 128, 0.25)' },
  checkedInCircle: { width: 72, height: 72, borderRadius: 36, backgroundColor: 'rgba(74, 222, 128, 0.12)', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  checkedInTitle: { color: c.green, fontFamily: f.heavy, fontSize: 22, letterSpacing: -0.4, textAlign: 'center' },
  checkedInSub: { color: c.mute, fontFamily: f.reg, fontSize: 14, textAlign: 'center', marginTop: 8 },
});
