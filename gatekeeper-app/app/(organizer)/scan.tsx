import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { api, VerifyResult } from '../../src/lib/api';
import { Body, Btn, H1, Mono, Screen, seatLabel } from '../../src/components/ui';
import { c, f, r } from '../../src/lib/theme';

const FRAME_H = 340;

export default function Scan() {
  const [perm, ask] = useCameraPermissions();
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [count, setCount] = useState({ ok: 0, no: 0 });
  const lock = useRef(false);
  const line = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(line, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      Animated.timing(line, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [line]);

  const onScan = async ({ data }: { data: string }) => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    const t0 = Date.now();
    try {
      const res = await api.verify(data);
      setResult(res);
      setCount((n) => (res.approved ? { ...n, ok: n.ok + 1 } : { ...n, no: n.no + 1 }));
    } catch (e: any) {
      setResult({
        approved: false, headline: e.message, ms: Date.now() - t0,
        checks: [
          { key: 'parsed', label: 'QR payload parsed', state: 'skip' },
          { key: 'fresh', label: 'Signed in the last 60s', state: 'skip' },
          { key: 'owner', label: 'Signer owns the cNFT', state: 'skip' },
          { key: 'registered', label: 'Transfer registered', state: 'skip' },
          { key: 'unused', label: 'Not yet checked in', state: 'skip' },
        ],
      });
    } finally { setBusy(false); }
  };
  const next = () => { setResult(null); lock.current = false; };

  if (result) return <ResultScreen r={result} onNext={next} />;

  return (
    <Screen>
      <View style={{ padding: 20, paddingTop: 8, flex: 1 }}>
        <H1 style={{ marginBottom: 14 }}>Gate check-in</H1>
        <View style={s.frame}>
          {perm?.granted ? (
            <CameraView style={StyleSheet.absoluteFill} facing="back" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onScan} />
          ) : (
            <View style={s.perm}>
              <Body style={{ textAlign: 'center' }}>Camera access is needed to scan attendee passes.</Body>
              <Btn label="Allow camera" onPress={ask} style={{ alignSelf: 'stretch' }} />
            </View>
          )}
          {perm?.granted && (
            <>
              <Animated.View style={[s.scanLine, { transform: [{ translateY: line.interpolate({ inputRange: [0, 1], outputRange: [40, FRAME_H - 40] }) }] }]} />
              {(['tl', 'tr', 'bl', 'br'] as const).map((k) => <View key={k} style={[s.corner, s[k]]} />)}
              <View style={s.hint}>
                <Text style={s.hintText}>{busy ? 'Checking on-chain…' : "Point at an attendee's live pass"}</Text>
              </View>
            </>
          )}
        </View>

        <View style={s.stats}>
          <View style={s.stat}><Ionicons name="checkmark-circle" size={22} color={c.green} /><Text style={s.statN}>{count.ok}</Text><Mono>Approved</Mono></View>
          <View style={s.stat}><Ionicons name="close-circle" size={22} color={c.redText} /><Text style={s.statN}>{count.no}</Text><Mono>Rejected</Mono></View>
        </View>
        <Body style={{ marginTop: 14 }}>Each scan checks the signature, the 60-second window and the cNFT's current owner on Solana, then marks the ticket used.</Body>
      </View>
    </Screen>
  );
}

function ResultScreen({ r: res, onNext }: { r: VerifyResult; onNext: () => void }) {
  const ok = res.approved;
  const ink = ok ? c.greenInk : '#FFFFFF';
  return (
    <View style={{ flex: 1, backgroundColor: ok ? '#14F195' : c.red }}>
      <SafeAreaView style={{ flex: 1, padding: 22 }}>
        <Text style={[s.rLabel, { color: ink, opacity: 0.8 }]}>{res.label ?? 'GATEKEEPER PASS'}{res.ticket?.tier === 'VIP Access' ? ' · VIP' : ''}</Text>
        <Text style={[s.rBig, { color: ink }]}>{ok ? 'Approved' : 'Rejected'}</Text>
        <Text style={[s.rHead, { color: ink }]}>{res.headline}</Text>

        <View style={{ marginTop: 28, gap: 18 }}>
          {res.checks.map((k) => (
            <View key={k.label} style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start', opacity: k.state === 'skip' ? 0.5 : 1 }}>
              <Ionicons name={k.state === 'pass' ? 'checkmark' : k.state === 'fail' ? 'close' : 'remove'} size={24} color={ink} />
              <View style={{ flex: 1 }}>
                <Text style={[s.rCheck, { color: ink }]}>{k.label}</Text>
                {!!k.detail && <Text style={[s.rDetail, { color: ink, opacity: 0.8 }]}>{k.detail}</Text>}
              </View>
            </View>
          ))}
        </View>

        <View style={{ flex: 1 }} />
        <Text style={[s.rDetail, { color: ink, opacity: 0.75, textAlign: 'center', marginBottom: 12 }]}>
          verified in {res.ms} ms{res.ticket ? ` · seat ${seatLabel(res.ticket.seat)}` : ''}
        </Text>
        <Btn kind="dark" label="Next attendee" onPress={onNext} style={{ }} />
      </SafeAreaView>
    </View>
  );
}

const CORNER = 44;
const s = StyleSheet.create({
  frame: { height: FRAME_H, borderRadius: 26, overflow: 'hidden', backgroundColor: '#0F0F16', borderWidth: 1, borderColor: c.line },
  perm: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 16 },
  scanLine: { position: 'absolute', left: 28, right: 28, height: 3, borderRadius: 2, backgroundColor: c.green, shadowColor: c.green, shadowOpacity: 0.9, shadowRadius: 10, elevation: 6 },
  corner: { position: 'absolute', width: CORNER, height: CORNER, borderColor: '#fff', borderWidth: 4 },
  tl: { top: 16, left: 16, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 14 },
  tr: { top: 16, right: 16, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 14 },
  bl: { bottom: 16, left: 16, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 14 },
  br: { bottom: 16, right: 16, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 14 },
  hint: { position: 'absolute', bottom: 22, alignSelf: 'center', backgroundColor: 'rgba(8,8,12,0.7)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: r.pill },
  hintText: { color: c.text, fontFamily: f.semi, fontSize: 14 },
  stats: { flexDirection: 'row', gap: 12, marginTop: 18 },
  stat: { flex: 1, backgroundColor: c.surface, borderRadius: 18, padding: 16, gap: 4 },
  statN: { color: c.text, fontFamily: f.monoM, fontSize: 30 },
  rLabel: { fontFamily: f.mono, fontSize: 13, letterSpacing: 1.2 },
  rBig: { fontFamily: f.heavy, fontSize: 76, letterSpacing: -3, marginTop: 10 },
  rHead: { fontFamily: f.bold, fontSize: 26, lineHeight: 32, marginTop: 4 },
  rCheck: { fontFamily: f.bold, fontSize: 18 },
  rDetail: { fontFamily: f.mono, fontSize: 13, marginTop: 3 },
});
