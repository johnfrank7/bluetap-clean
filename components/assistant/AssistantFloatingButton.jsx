import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import BlueTapBrandMark from '../BlueTapBrandMark';
import useSingleFlightNavigation from '../useSingleFlightNavigation';
import { getAssistantVisibility, subscribeAssistantVisibility } from '../../services/assistant/assistantStorage';

export default function AssistantFloatingButton({ role, colors }) {
  const { navigateOnce } = useSingleFlightNavigation();
  const [visible, setVisible] = React.useState(false);
  React.useEffect(() => {
    let active = true;
    let changed = false;
    setVisible(false);
    const unsubscribe = subscribeAssistantVisibility((changedRole, next) => {
      if (changedRole === role) { changed = true; setVisible(next); }
    });
    getAssistantVisibility(role).then((next) => { if (active && !changed) setVisible(next); });
    return () => { active = false; unsubscribe(); };
  }, [role]);
  if (!visible) return null;
  return <Pressable accessibilityRole="button" accessibilityLabel="Open BlueTap Assistant"
    onPress={() => navigateOnce(`/${role}/bluetap_AI`)}
    style={({ hovered, focused, pressed }) => [styles.button,
      { backgroundColor: hovered ? colors.primarySoft : colors.surface, borderColor: colors.primaryAction },
      focused && styles.focused, pressed && styles.pressed]}>
    <BlueTapBrandMark size={30} color={colors.iconInteractive || colors.primary} />
  </Pressable>;
}

const styles = StyleSheet.create({
  button: { width: 54, height: 54, borderRadius: 27, borderWidth: 2, alignItems: 'center', justifyContent: 'center', elevation: 10 },
  focused: { borderWidth: 3 },
  pressed: { opacity: 0.82 },
});
