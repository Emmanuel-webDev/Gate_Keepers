import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { c, f, r } from '../lib/theme';
import { seatLabel } from './ui';

export type TabKind = 'general' | 'vip' | 'bond';
const TAB_TEXT: Record<TabKind, string> = { general: 'GENERAL', vip: 'VIP ACCESS', bond: 'BOND LOCKED' };

/** Ticket stub with the coloured side tab and punched notches. */
export function TicketCard({
  title, date, venue, seat, tab, chip, chipTone = 'green', onPress, checkedInAt,
}: {
  title: string; date: string; venue?: string; seat: string; tab: TabKind;
  chip: string; chipTone?: 'green' | 'purple'; onPress?: () => void;
  checkedInAt?: string | null;
}) {
  const [lineY, setLineY] = useState(0);
  const d = new Date(date);
  const when = isNaN(d.getTime()) ? '' : `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  
  let chipText = chip;
  let chipBg = chipTone === 'green' ? c.surface2 : c.purpleSoft;
  let chipFg = chipTone === 'green' ? c.green : c.purpleText;

  if (checkedInAt) {
    const cin = new Date(checkedInAt);
    const timeStr = !isNaN(cin.getTime())
      ? cin.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : '';
    chipText = timeStr ? `USED · ${timeStr}` : 'USED';
    chipBg = 'rgba(255, 255, 255, 0.08)';
    chipFg = c.mute;
  }

  const tabInner = <Text style={s.tabText} numberOfLines={1}>{TAB_TEXT[tab]}</Text>;
  const showVenue = !!venue && venue.trim() !== '' && venue.trim().toUpperCase() !== 'TBA';
  return (
    <Pressable onPress={onPress} disabled={!onPress || !!checkedInAt} style={[s.card, checkedInAt ? { opacity: 0.55 } : null]}>
      <View style={s.body}>
        <View style={{ padding: 20, paddingBottom: 16 }}>
          <Text style={s.title} numberOfLines={2}>{title}</Text>
          {!!when && <Text style={s.sub}>{when}</Text>}
          {showVenue && <Text style={s.sub}>{venue.trim()}</Text>}
        </View>
        <View onLayout={(e) => setLineY(e.nativeEvent.layout.y)} style={s.dash} />
        <View style={s.bottom}>
          <View>
            <Text style={s.seatLbl}>SEAT</Text>
            <Text style={s.seat}>{seatLabel(seat)}</Text>
          </View>
          <View style={[s.chip, { backgroundColor: chipBg }]}>
            <Text style={[s.chipText, { color: chipFg }]}>{chipText}</Text>
          </View>
        </View>
      </View>

      {tab === 'vip' ? (
        <LinearGradient colors={[c.purple, c.green]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.tab}>{tabInner}</LinearGradient>
      ) : (
        <View style={[s.tab, { backgroundColor: tab === 'bond' ? '#A35CFF' : c.green }]}>{tabInner}</View>
      )}

      {/* notches */}
      <View style={[s.notch, { left: -11, top: lineY - 10 }]} />
      <View style={[s.notch, { right: 46 - 11, top: lineY - 10 }]} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: { flexDirection: 'row', backgroundColor: c.surface, borderRadius: r.card, marginBottom: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#1F1F2B' },
  body: { flex: 1 },
  title: { color: c.text, fontFamily: f.heavy, fontSize: 23, letterSpacing: -0.4, marginBottom: 6 },
  sub: { color: c.mute, fontFamily: f.reg, fontSize: 15, lineHeight: 21 },
  dash: { marginHorizontal: 20, borderTopWidth: 1.5, borderStyle: 'dashed', borderColor: c.line },
  bottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', padding: 20, paddingTop: 14 },
  seatLbl: { color: c.mute, fontFamily: f.mono, fontSize: 11, letterSpacing: 1.3, marginBottom: 2 },
  seat: { color: c.text, fontFamily: f.monoM, fontSize: 28, letterSpacing: 0.5 },
  chip: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: r.pill },
  chipText: { fontFamily: f.bold, fontSize: 14 },
  tab: { width: 46, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  tabText: { width: 160, textAlign: 'center', transform: [{ rotate: '90deg' }], color: '#0A0A10', fontFamily: f.heavy, fontSize: 14, letterSpacing: 2.5 },
  notch: { position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: c.bg },
});
