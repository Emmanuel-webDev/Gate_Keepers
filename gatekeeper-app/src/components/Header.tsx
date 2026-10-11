import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useSegments } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWallet } from '../wallet/WalletProvider';
import { c, f, r } from '../lib/theme';
import { short } from './ui';

export function Logo() {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <Image
        source={require('../../assets/logo.png')}
        style={s.logo}
        resizeMode="cover"
      />
      <Text style={s.brand}>GateKeeper</Text>
    </View>
  );
}

/** Logo + Attendee/Organizer switch + connected wallet pill. */
export function AppHeader() {
  const router = useRouter();
  const seg = useSegments();
  const { publicKey, walletName, disconnect } = useWallet();
  const organizer = seg[0] === '(organizer)';

  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: 'transparent' }}>
      <View style={s.wrap}>
        <View style={s.top}>
          <Logo />
          <View style={s.toggle}>
            {(['Attendee', 'Organizer'] as const).map((t) => {
              const on = (t === 'Organizer') === organizer;
              return (
                <Pressable key={t} onPress={() => router.replace(t === 'Organizer' ? '/(organizer)/scan' : '/(attendee)/tickets')} style={[s.seg, on && s.segOn]}>
                  <Text style={[s.segText, on && { color: '#0A0A10' }]}>{t}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
        {publicKey && (
          <View style={s.pill}>
            <View style={s.dot} />
            <Text style={s.wname}>{walletName}</Text>
            <Text style={s.addr}>{short(publicKey.toBase58())}</Text>
            <View style={{ flex: 1 }} />
            <Pressable hitSlop={12} onPress={async () => { await disconnect(); router.replace('/'); }}>
              <Ionicons name="log-out-outline" size={22} color={c.mute} />
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  wrap: { paddingHorizontal: 20, paddingBottom: 10, gap: 12 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 6 },
  logo: { width: 36, height: 36, borderRadius: 10 },
  brand: { color: c.text, fontFamily: f.heavy, fontSize: 20, letterSpacing: -0.4 },
  toggle: { flexDirection: 'row', backgroundColor: c.surface, borderRadius: r.pill, padding: 4 },
  seg: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: r.pill },
  segOn: { backgroundColor: '#F4F3FA' },
  segText: { color: c.mute, fontFamily: f.bold, fontSize: 14 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: c.surface, borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.green },
  wname: { color: c.text, fontFamily: f.bold, fontSize: 15 },
  addr: { color: c.mute, fontFamily: f.mono, fontSize: 13 },
});
