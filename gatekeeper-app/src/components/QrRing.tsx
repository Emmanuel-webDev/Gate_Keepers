import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import QRCode from 'react-native-qrcode-svg';
import { c } from '../lib/theme';

const SIZE = 300, STROKE = 7, RX = 38;
const W = SIZE - STROKE;
const PERIM = 2 * (W + W) - 8 * RX + 2 * Math.PI * RX;

/** QR inside a rounded ring that drains as the code ages. progress: 1 -> 0 */
export function QrRing({ value, progress }: { value: string; progress: number }) {
  return (
    <View style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={SIZE} height={SIZE} style={{ position: 'absolute' }}>
        <Defs>
          <LinearGradient id="g" x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={c.purple} />
            <Stop offset="0.55" stopColor="#4DA3F5" />
            <Stop offset="1" stopColor={c.green} />
          </LinearGradient>
        </Defs>
        <Rect x={STROKE / 2} y={STROKE / 2} width={W} height={W} rx={RX} fill="none" stroke="#1B1B26" strokeWidth={STROKE} />
        <Rect
          x={STROKE / 2} y={STROKE / 2} width={W} height={W} rx={RX} fill="none"
          stroke="url(#g)" strokeWidth={STROKE} strokeLinecap="round"
          strokeDasharray={`${Math.max(0, progress) * PERIM} ${PERIM}`}
        />
      </Svg>
      <View style={{ backgroundColor: '#F1F0F8', padding: 14, borderRadius: 26 }}>
        {!!value && <QRCode value={value} size={206} ecl="L" backgroundColor="#F1F0F8" color="#0A0A10" quietZone={0} />}
      </View>
    </View>
  );
}
