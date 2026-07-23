import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

const requestFrame =
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame
    : (callback) => setTimeout(() => callback(Date.now()), 16);

const cancelFrame =
  typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;

const easeOutCubic = (value) => 1 - (1 - value) ** 3;

const getWebReducedMotion = () =>
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export const formatAdminNumber = (value) =>
  new Intl.NumberFormat('en-US').format(Math.max(Number(value || 0), 0));

export function useReducedMotionPreference() {
  const [reducedMotion, setReducedMotion] = useState(getWebReducedMotion);

  useEffect(() => {
    let mounted = true;
    const setPreference = (value) => {
      if (!mounted) return;
      setReducedMotion(typeof value === 'boolean' ? value : !!value?.matches);
    };

    AccessibilityInfo.isReduceMotionEnabled?.()
      .then(setPreference)
      .catch(() => {});

    const subscription = AccessibilityInfo.addEventListener?.(
      'reduceMotionChanged',
      setPreference
    );
    const media =
      Platform.OS === 'web' &&
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    media?.addEventListener?.('change', setPreference);
    media?.addListener?.(setPreference);

    return () => {
      mounted = false;
      subscription?.remove?.();
      media?.removeEventListener?.('change', setPreference);
      media?.removeListener?.(setPreference);
    };
  }, []);

  return reducedMotion;
}

export function useAnimatedNumber(
  targetValue,
  enabled,
  reducedMotion,
  { delay = 0, duration = 900 } = {}
) {
  const numericTarget = Math.max(Number(targetValue || 0), 0);
  const [displayValue, setDisplayValue] = useState(
    reducedMotion ? numericTarget : 0
  );
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!enabled) return undefined;

    if (reducedMotion) {
      hasAnimated.current = true;
      setDisplayValue(numericTarget);
      return undefined;
    }

    if (hasAnimated.current) {
      setDisplayValue(numericTarget);
      return undefined;
    }

    hasAnimated.current = true;
    let frameId = null;
    let timeoutId = null;
    let startTime = null;

    const step = (timestamp) => {
      if (startTime === null) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = easeOutCubic(progress);

      setDisplayValue(Math.round(numericTarget * eased));

      if (progress < 1) {
        frameId = requestFrame(step);
      }
    };

    timeoutId = setTimeout(() => {
      frameId = requestFrame(step);
    }, delay);

    return () => {
      clearTimeout(timeoutId);
      if (frameId !== null) {
        cancelFrame(frameId);
      }
    };
  }, [delay, duration, enabled, numericTarget, reducedMotion]);

  return displayValue;
}

export function useAnimatedValueSnapshot(animatedValue, fallback = 0) {
  const [value, setValue] = useState(fallback);

  useEffect(() => {
    if (!animatedValue?.addListener) return undefined;

    setValue(animatedValue.__getValue?.() ?? fallback);
    const listenerId = animatedValue.addListener((event) => {
      setValue(event.value);
    });

    return () => {
      animatedValue.removeListener(listenerId);
    };
  }, [animatedValue, fallback]);

  return value;
}
