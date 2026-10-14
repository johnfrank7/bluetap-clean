const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const babel = require('@babel/core');

function loadTypewriterModule() {
  const fullPath = path.resolve(__dirname, '../../../components/assistant/useAssistantTypewriter.js');
  const code = fs.readFileSync(fullPath, 'utf8');
  const transformed = babel.transformSync(code, {
    presets: ['babel-preset-expo'],
    filename: fullPath,
  }).code;

  const mod = { exports: {} };
  const mockRequire = (id) => {
    if (id === 'react') return require('react');
    if (id.includes('BlueTapThemeTransition')) {
      return { useReducedMotionPreference: () => false };
    }
    if (!id.startsWith('.')) return require(id);
    return {};
  };

  const fn = new Function('require', 'module', 'exports', transformed);
  fn(mockRequire, mod, mod.exports);
  return mod.exports;
}

const {
  calculateTypewriterConfig,
  TYPEWRITER_BASE_INTERVAL_MS,
  TYPEWRITER_MAX_DURATION_MS,
  CURSOR_BLINK_INTERVAL_MS,
} = loadTypewriterModule();

test('calculateTypewriterConfig: short messages reveal character-by-character at base interval', () => {
  const shortText = 'Your order is on the way.'; // 25 chars
  const config = calculateTypewriterConfig(shortText.length);
  assert.equal(config.intervalMs, TYPEWRITER_BASE_INTERVAL_MS);
  assert.equal(config.step, 1);
  const totalDuration = shortText.length * config.intervalMs;
  assert.ok(totalDuration < 1500, `Duration ${totalDuration}ms should be under 1.5s`);
});

test('calculateTypewriterConfig: long messages use adaptive chunking and cap duration under ~2.4s', () => {
  const longText = 'We found 3 nearby water stations in your area. Station 1 delivers within 2.5km, Station 2 offers 24-pack containers, and Station 3 is open until 7:00 PM today. Please select an option to continue.'.repeat(3); // ~590 chars
  const config = calculateTypewriterConfig(longText.length);
  assert.equal(config.intervalMs, TYPEWRITER_BASE_INTERVAL_MS);
  assert.ok(config.step > 1, 'Long message must use adaptive chunking step > 1');

  const totalTicks = Math.ceil(longText.length / config.step);
  const totalDuration = totalTicks * config.intervalMs;
  assert.ok(
    totalDuration <= TYPEWRITER_MAX_DURATION_MS + 100,
    `Duration ${totalDuration}ms must finish within ~${TYPEWRITER_MAX_DURATION_MS}ms`
  );
});

test('calculateTypewriterConfig: handles empty and falsy text safely', () => {
  const zeroConfig = calculateTypewriterConfig(0);
  assert.equal(zeroConfig.step, 1);
  const nullConfig = calculateTypewriterConfig(null);
  assert.equal(nullConfig.step, 1);
});

test('AssistantMessageBubble source contract: integrates typewriter hook, tap-to-complete, and deferred cards/actions', () => {
  const bubblePath = path.resolve(__dirname, '../../../components/assistant/AssistantMessageBubble.jsx');
  const source = fs.readFileSync(bubblePath, 'utf8');

  // Integrates useAssistantTypewriter hook
  assert.match(source, /useAssistantTypewriter/);
  assert.match(source, /displayedText/);
  assert.match(source, /isTyping/);
  assert.match(source, /cursorVisible/);
  assert.match(source, /completeImmediately/);

  // Tap-to-complete interaction on assistantBubble
  assert.match(source, /onPress=\{isTyping \? completeImmediately : undefined\}/);
  assert.match(source, /disabled=\{!isTyping\}/);

  // Deferred revealing: cards and actions hidden while typing, revealed when typing completes
  assert.match(source, /\{!isTyping && Array\.isArray\(message\.cards\)/);
  assert.match(source, /\{!isTyping && visibleActions\.length > 0/);

  // Blinking cursor rendering inline
  assert.match(source, /\{isTyping && \(\s*<Text/);
  assert.match(source, /!cursorVisible && styles\.cursorHidden/);

  // Accessibility: complete message provided to screen readers
  assert.match(source, /accessible accessibilityLabel=\{message\.text\}/);
  assert.match(source, /accessibilityElementsHidden=\{isTyping\}/);
});

test('AssistantScreen source contract: tracks newly generated reply by stable ID and manages scroll', () => {
  const screenPath = path.resolve(__dirname, '../../../components/assistant/AssistantScreen.jsx');
  const source = fs.readFileSync(screenPath, 'utf8');

  // State tracks currently animating message ID
  assert.match(source, /const \[animatingMessageId, setAnimatingMessageId\] = useState\(null\);/);

  // On new engine response, newly generated message ID is tracked
  assert.match(source, /const newMsgId = `asst-\$\{Date\.now\(\)\}`;/);
  assert.match(source, /setAnimatingMessageId\(newMsgId\);/);

  // Previous running animation is cancelled/completed on new query submission
  assert.match(source, /handleSendQuery = useCallback\(\s*async \(userInput/);
  assert.match(source, /setAnimatingMessageId\(null\);/);

  // Reset conversation clears animating state
  assert.match(source, /handleResetConversation = useCallback/);

  // Passes animation props to bubble
  assert.match(source, /isAnimating=\{animatingMessageId === item\.id\}/);
  assert.match(source, /onAnimationComplete=\{handleAnimationComplete\}/);
  assert.match(source, /onAnimationTick=\{handleAnimationTick\}/);

  // Smart near-bottom scroll tracking
  assert.match(source, /isNearBottomRef/);
  assert.match(source, /handleScroll/);
  assert.match(source, /scrollEventThrottle=\{32\}/);
});

test('Assistant storage integrity: message persistence is decoupled from typing presentation state', () => {
  const screenPath = path.resolve(__dirname, '../../../components/assistant/AssistantScreen.jsx');
  const source = fs.readFileSync(screenPath, 'utf8');

  // Full assistantMsg with complete response.message is stored in state immediately
  assert.match(
    source,
    /const assistantMsg = \{\s*id: newMsgId,\s*role: 'assistant',\s*text: response\.message/
  );
  // messages array contains complete text, so saveDailyAssistantChat writes full transcript
  assert.match(
    source,
    /saveDailyAssistantChat\(\{\s*userId: effectiveUserId,\s*role,\s*messages\s*\}\)/
  );
});

test('Reduced motion contract: useAssistantTypewriter respects user accessibility settings', () => {
  const hookPath = path.resolve(__dirname, '../../../components/assistant/useAssistantTypewriter.js');
  const source = fs.readFileSync(hookPath, 'utf8');

  assert.match(source, /useReducedMotionPreference/);
  assert.match(source, /const shouldAnimate = Boolean\(isAnimating && !reduceMotion/);
  assert.match(source, /if \(!shouldAnimate\) \{\s*setDisplayedText\(safeText\);\s*setIsTyping\(false\)/);
});
