import { AppHeader } from './Header';
import { c, f } from '../lib/theme';

export const tabScreenOptions = {
  header: () => <AppHeader />,
  sceneStyle: { backgroundColor: c.bg },
  tabBarStyle: { backgroundColor: '#0C0C12', borderTopColor: c.line, height: 78, paddingTop: 8, paddingBottom: 10 },
  tabBarItemStyle: { borderRadius: 16, marginHorizontal: 6 },
  tabBarActiveBackgroundColor: c.surface,
  tabBarActiveTintColor: c.green,
  tabBarInactiveTintColor: c.mute,
  tabBarLabelStyle: { fontFamily: f.bold, fontSize: 13 },
} as const;
