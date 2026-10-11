import React from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, TextStyle, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { c, f, r } from '../lib/theme';

export const short = (a: string) => `${a.slice(0, 4)}…${a.slice(-4)}`;
export const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
export const seatLabel = (s: string) => s.replace('-', ' ');

/** Night background with the purple (top-left) and green (bottom-right) glow from the designs. */
export function Glow() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <LinearGradient colors={['rgba(153,69,255,0.32)', 'rgba(153,69,255,0)']} start={{ x: 0, y: 0 }} end={{ x: 0.7, y: 0.45 }} style={StyleSheet.absoluteFill} />
      <LinearGradient colors={['rgba(20,241,149,0)', 'rgba(20,241,149,0.16)']} start={{ x: 0.3, y: 0.55 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
    </View>
  );
}

export const Screen = ({ children, style }: { children?: React.ReactNode; style?: ViewStyle }) => (
  <View style={[{ flex: 1, backgroundColor: c.bg }, style]}>
    <Glow />
    {children}
  </View>
);

export const Mono = ({ children, style }: { children: React.ReactNode; style?: TextStyle }) => (
  <Text style={[s.mono, style]}>{children}</Text>
);
export const H1 = ({ children, style }: { children: React.ReactNode; style?: TextStyle }) => (
  <Text style={[s.h1, style]}>{children}</Text>
);
export const Body = ({ children, style }: { children: React.ReactNode; style?: TextStyle }) => (
  <Text style={[s.body, style]}>{children}</Text>
);

type BtnKind = 'green' | 'dark' | 'grad' | 'danger' | 'ghost';
export function Btn({
  label, onPress, kind = 'green', busy, disabled, icon, style,
}: {
  label: string; onPress: () => void; kind?: BtnKind; busy?: boolean; disabled?: boolean;
  icon?: React.ReactNode; style?: ViewStyle;
}) {
  const fg = kind === 'green' ? c.greenInk : kind === 'grad' ? '#fff' : c.text;
  const inner = busy ? <ActivityIndicator color={fg} /> : (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {icon}
      <Text style={[s.btnText, { color: fg }]}>{label}</Text>
    </View>
  );
  const base: ViewStyle = { borderRadius: r.btn, paddingVertical: 17, alignItems: 'center', justifyContent: 'center' };
  return (
    <Pressable onPress={onPress} disabled={busy || disabled} style={({ pressed }) => [{ opacity: disabled ? 0.45 : pressed ? 0.88 : 1 }, style]}>
      {kind === 'grad' ? (
        <LinearGradient colors={[c.purple, c.green]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={base}>{inner}</LinearGradient>
      ) : (
        <View
          style={[base, {
            backgroundColor: kind === 'green' ? c.green : kind === 'danger' ? c.red : kind === 'dark' ? c.surface2 : 'transparent',
            borderWidth: kind === 'ghost' ? 1 : 0, borderColor: c.line,
          }]}
        >{inner}</View>
      )}
    </Pressable>
  );
}

export function Pill({ text, tone }: { text: string; tone: 'green' | 'purple' | 'red' | 'mute' }) {
  const t = {
    green: [c.greenSoft, c.green], purple: [c.purpleSoft, c.purpleText], red: [c.redSoft, c.redText], mute: [c.surface2, c.mute],
  }[tone];
  return (
    <View style={{ backgroundColor: t[0], paddingHorizontal: 12, paddingVertical: 6, borderRadius: r.pill }}>
      <Text style={{ color: t[1], fontFamily: f.bold, fontSize: 13 }}>{text}</Text>
    </View>
  );
}

export function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={s.row}>
      <Text style={s.rowLabel}>{label}</Text>
      <Text style={[s.rowValue, strong && { fontFamily: f.bold }]}>{value}</Text>
    </View>
  );
}

/** Bottom sheet used for Transfer and VIP. */
export function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={s.scrim} onPress={onClose} />
      <View style={s.sheet}>
        <View style={s.handle} />
        {children}
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  mono: { color: c.mute, fontFamily: f.mono, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase' },
  h1: { color: c.text, fontFamily: f.heavy, fontSize: 34, letterSpacing: -0.8 },
  body: { color: c.mute, fontFamily: f.reg, fontSize: 15, lineHeight: 22 },
  btnText: { fontFamily: f.bold, fontSize: 17 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 13, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.line },
  rowLabel: { color: c.mute, fontFamily: f.reg, fontSize: 15 },
  rowValue: { color: c.text, fontFamily: f.monoM, fontSize: 15 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: { backgroundColor: '#14141C', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 22, paddingBottom: 30, gap: 14, borderWidth: 1, borderColor: c.line },
  handle: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: c.line, marginBottom: 4 },
});
