import { useState, useEffect, useRef, useCallback } from 'react';
import { useReducedMotionPreference } from '../BlueTapThemeTransition';

export const TYPEWRITER_BASE_INTERVAL_MS = 28;
export const TYPEWRITER_MAX_DURATION_MS = 2400;
export const CURSOR_BLINK_INTERVAL_MS = 500;

/**
 * Calculates adaptive typewriter step and interval.
 * Short text: character-by-character at ~28ms.
 * Long text: adaptive chunking so the entire reply finishes in under ~2.4 seconds.
 * @param {number} textLength
 * @returns {{ intervalMs: number, step: number }}
 */
export function calculateTypewriterConfig(textLength) {
  if (!textLength || textLength <= 0) {
    return { intervalMs: TYPEWRITER_BASE_INTERVAL_MS, step: 1 };
  }
  const maxTicks = Math.floor(TYPEWRITER_MAX_DURATION_MS / TYPEWRITER_BASE_INTERVAL_MS);
  const step = Math.max(1, Math.ceil(textLength / Math.max(1, maxTicks)));
  return { intervalMs: TYPEWRITER_BASE_INTERVAL_MS, step };
}

/**
 * Hook managing presentation-only typewriter revelation for newly generated assistant responses.
 *
 * Invariants:
 * - Never modifies underlying message data or triggers storage persistence.
 * - Immediately displays full text if reduced motion is enabled or isAnimating is false.
 * - Screen readers receive complete text via accessibility properties.
 * - Cleanly cleans up timers and intervals on unmount or completion.
 */
export function useAssistantTypewriter({
  text = '',
  isAnimating = false,
  onComplete,
  onTick,
}) {
  const reduceMotion = useReducedMotionPreference();
  const safeText = typeof text === 'string' ? text : '';
  const shouldAnimate = Boolean(isAnimating && !reduceMotion && safeText.length > 0);

  const [displayedText, setDisplayedText] = useState(() => (shouldAnimate ? '' : safeText));
  const [isTyping, setIsTyping] = useState(() => shouldAnimate);
  const [cursorVisible, setCursorVisible] = useState(true);

  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  const completeImmediately = useCallback(() => {
    setIsTyping(false);
    setCursorVisible(false);
    setDisplayedText(safeText);
    onCompleteRef.current?.();
  }, [safeText]);

  useEffect(() => {
    if (!shouldAnimate) {
      setDisplayedText(safeText);
      setIsTyping(false);
      setCursorVisible(false);
      return;
    }

    let isMounted = true;
    let timerId = null;
    let blinkIntervalId = null;
    let currentIndex = 0;

    setDisplayedText('');
    setIsTyping(true);
    setCursorVisible(true);

    const { intervalMs, step } = calculateTypewriterConfig(safeText.length);

    // Subtle blinking cursor while typing
    blinkIntervalId = setInterval(() => {
      if (isMounted) {
        setCursorVisible((prev) => !prev);
      }
    }, CURSOR_BLINK_INTERVAL_MS);

    const tick = () => {
      if (!isMounted) return;

      currentIndex = Math.min(safeText.length, currentIndex + step);
      setDisplayedText(safeText.slice(0, currentIndex));
      onTickRef.current?.();

      if (currentIndex >= safeText.length) {
        setIsTyping(false);
        setCursorVisible(false);
        if (blinkIntervalId) clearInterval(blinkIntervalId);
        onCompleteRef.current?.();
        return;
      }

      timerId = setTimeout(tick, intervalMs);
    };

    timerId = setTimeout(tick, intervalMs);

    return () => {
      isMounted = false;
      if (timerId) clearTimeout(timerId);
      if (blinkIntervalId) clearInterval(blinkIntervalId);
    };
  }, [shouldAnimate, safeText]);

  return {
    displayedText,
    isTyping,
    cursorVisible,
    completeImmediately,
  };
}

export default useAssistantTypewriter;

\n