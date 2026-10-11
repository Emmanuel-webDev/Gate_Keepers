import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { PublicKey } from '@solana/web3.js';
import { api, Tier } from '../../src/lib/api';
import { Btn, fmt, H1, Mono, Screen, short } from '../../src/components/ui';
import { c, f } from '../../src/lib/theme';

type OrgEvent = { id: string; name: string; faceValueSkr: number; minted: number; capacity: number };

const isAddr = (s: string) => { try { new PublicKey(s); return true; } catch { return false; } };

export default function Mint() {
  const [events, setEvents] = useState<OrgEvent[]>([]);
  const [name, setName] = useState('');
  const [cap, setCap] = useState('');
  const [face, setFace] = useState('');
  const [venue, setVenue] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [tier, setTier] = useState<Tier>('General');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try { setEvents(await api.orgEvents()); } catch (err: any) { Alert.alert('Could not load', err.message); }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const nm = name.trim();
  const nameOk = nm.length >= 3 && nm.length <= 60;
  const existing = events.find((e) => e.name.trim().toLowerCase() === nm.toLowerCase());
  const capN = Number(cap), faceN = Number(face);
  const capOk = /^\d+$/.test(cap.trim()) && capN >= 1 && capN <= 131072;
  const faceOk = face.trim() !== '' && Number.isFinite(faceN) && faceN > 0;
  const toT = to.trim();
  const toOk = toT.length > 0 && isAddr(toT);
  const soldOut = !!existing && existing.minted >= existing.capacity;

  const dateT = date.trim();
  const timeT = time.trim();
  let parsedDate: Date | null = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateT) && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(timeT)) {
    const [y, m, d] = dateT.split('-').map(Number);
    const [hh, mm] = timeT.split(':').map(Number);
    const candidate = new Date(y, m - 1, d, hh, mm, 0);
    if (
      candidate.getFullYear() === y &&
      candidate.getMonth() === m - 1 &&
      candidate.getDate() === d &&
      candidate.getHours() === hh &&
      candidate.getMinutes() === mm &&
      !isNaN(candidate.getTime())
    ) {
      parsedDate = candidate;
    }
  }
  const dateOk = parsedDate !== null && parsedDate.getTime() > Date.now();
  const dateTouched = dateT.length > 0 || timeT.length > 0;

  const ready = nameOk && toOk && !soldOut && (existing ? true : capOk && faceOk && dateOk);

  const mint = async () => {
    setBusy(true);
    try {
      const res = existing
        ? await api.mint(toT, existing.id, tier)
        : await api.mintNew(toT, nm, capN, faceN, tier, venue.trim(), parsedDate!.toISOString());
      Alert.alert('Ticket minted', `${res.seat} sent to ${short(toT)}.${res.assetId ? `\nAsset ${short(res.assetId)}` : ''}`);
      setTo('');
      if (!existing) {
        setCap('');
        setFace('');
        setVenue('');
        setDate('');
        setTime('');
      }
      await load();
    } catch (e: any) { Alert.alert('Mint failed', e.message); } finally { setBusy(false); }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ padding: 20, paddingTop: 8, gap: 12 }} keyboardShouldPersistTaps="handled">
        <H1>Mint tickets</H1>

        <Mono style={{ marginTop: 8 }}>Event name</Mono>
        <TextInput value={name} onChangeText={setName} maxLength={60} placeholder="Name your event" placeholderTextColor={c.mute} style={s.input} />
        {events.length > 0 && (
          <View style={s.chips}>
            {events.map((e) => (
              <Pressable key={e.id} onPress={() => setName(e.name)} style={[s.chip, existing?.id === e.id && s.chipOn]}>
                <Text style={[s.chipText, existing?.id === e.id && { color: '#0A0A10' }]}>{e.name}</Text>
              </Pressable>
            ))}
          </View>
        )}
        {existing && (
          <Text style={soldOut ? s.err : s.mono}>{soldOut ? 'Sold out' : `Minted ${fmt(existing.minted)} / ${fmt(existing.capacity)}`}</Text>
        )}
        {!existing && nameOk && (
          <>
            <Mono style={{ marginTop: 8 }}>Capacity (tickets)</Mono>
            <TextInput value={cap} onChangeText={setCap} keyboardType="number-pad" placeholder="1 - 131072" placeholderTextColor={c.mute} style={s.input} />
            <Mono style={{ marginTop: 8 }}>Face value (SKR)</Mono>
            <TextInput value={face} onChangeText={setFace} keyboardType="decimal-pad" placeholder="e.g. 25" placeholderTextColor={c.mute} style={s.input} />
            <Mono style={{ marginTop: 8 }}>Venue or city</Mono>
            <TextInput value={venue} onChangeText={setVenue} placeholder="e.g. Landmark Centre or Online (optional)" placeholderTextColor={c.mute} style={s.input} />
            <Mono style={{ marginTop: 8 }}>Event date & time</Mono>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TextInput
                value={date}
                onChangeText={setDate}
                placeholder="YYYY-MM-DD"
                placeholderTextColor={c.mute}
                maxLength={10}
                style={[s.input, { flex: 3 }]}
              />
              <TextInput
                value={time}
                onChangeText={setTime}
                placeholder="HH:MM"
                placeholderTextColor={c.mute}
                maxLength={5}
                style={[s.input, { flex: 2 }]}
              />
            </View>
            {dateTouched && !dateOk && (
              <Text style={s.err}>Date and time must be in the future (YYYY-MM-DD, HH:MM)</Text>
            )}
          </>
        )}

        <Mono style={{ marginTop: 8 }}>Tier</Mono>
        <View style={s.chips}>
          {(['General', 'VIP Access'] as Tier[]).map((t) => (
            <Pressable key={t} onPress={() => setTier(t)} style={[s.chip, tier === t && s.chipOn]}>
              <Text style={[s.chipText, tier === t && { color: '#0A0A10' }]}>{t}</Text>
            </Pressable>
          ))}
        </View>

        <Mono style={{ marginTop: 8 }}>Recipient</Mono>
        <TextInput value={to} onChangeText={setTo} autoCapitalize="none" autoCorrect={false} placeholder="Enter a valid Solana address" placeholderTextColor={c.mute} style={s.input} />
        {toT.length > 0 && !toOk && <Text style={s.err}>Invalid Solana address</Text>}
        <Btn label={soldOut ? 'Sold out' : 'Mint cNFT ticket'} onPress={mint} busy={busy} disabled={!ready} style={{ marginTop: 6 }} />
      </ScrollView>
    </Screen>
  );
}

const s = StyleSheet.create({
  mono: { color: c.mute, fontFamily: f.mono, fontSize: 14 },
  err: { color: '#F26D6D', fontFamily: f.mono, fontSize: 13 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  chip: { backgroundColor: c.surface2, paddingHorizontal: 18, paddingVertical: 13, borderRadius: 14 },
  chipOn: { backgroundColor: '#F4F3FA' },
  chipText: { color: c.text, fontFamily: f.bold, fontSize: 15 },
  input: { backgroundColor: c.surface, color: c.text, borderRadius: 16, paddingHorizontal: 16, paddingVertical: 18, fontFamily: f.mono, fontSize: 14, borderWidth: 1, borderColor: c.line },
});
