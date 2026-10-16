import { Animated, Easing } from 'react-native';

export const LIQUID_REFINE_MS = 1850;
export const LIQUID_FINISH_MS = 2200;

// Presentation only: completion never controls application readiness or routing.
export function startLiquidFormation(progress, breathing, onRefined) {
  let active = true;
  progress.setValue(0);
  breathing.setValue(1);
  const formation = Animated.timing(progress, {
    toValue: LIQUID_REFINE_MS,
    duration: LIQUID_REFINE_MS,
    easing: Easing.linear,
    useNativeDriver: true,
    isInteraction: false,
  });
  const hold = Animated.delay(LIQUID_FINISH_MS - LIQUID_REFINE_MS);
  const breathe = Animated.loop(Animated.sequence([
    Animated.timing(breathing, {
      toValue: 1.025, duration: 2000, easing: Easing.inOut(Easing.sin),
      useNativeDriver: true, isInteraction: false,
    }),
    Animated.timing(breathing, {
      toValue: 1, duration: 2000, easing: Easing.inOut(Easing.sin),
      useNativeDriver: true, isInteraction: false,
    }),
  ]));
  formation.start(({ finished }) => {
    if (!active || !finished) return;
    onRefined();
    hold.start(({ finished: held }) => {
      if (active && held) breathe.start();
    });
  });
  return () => {
    active = false;
    formation.stop();
    hold.stop();
    breathe.stop();
    progress.stopAnimation();
    breathing.stopAnimation();
  };
}
