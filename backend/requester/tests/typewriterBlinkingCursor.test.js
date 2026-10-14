const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '../../..');
const read = (...parts) => readFileSync(resolve(root, ...parts), 'utf8');

test('Phase 13B.3 speed constants meet exact requirements', () => {
  const dashboard = read('app', 'requester', 'r_dashboard.jsx');

  // 1. SPEED
  assert.match(dashboard, /const GREETING_TYPING_SPEED = 65;/);
  assert.match(dashboard, /const GREETING_BACKSPACING_SPEED = 25;/);
  assert.match(dashboard, /const GREETING_ERASE_PAUSE = 250;/);
});

test('Phase 13B.3 message timing and hold duration meet exact requirements', () => {
  const dashboard = read('app', 'requester', 'r_dashboard.jsx');

  // 3. MESSAGE TIMING
  assert.match(dashboard, /const GREETING_DEFAULT_HOLD = 5000;/);
  assert.match(dashboard, /const GREETING_PROMO_HOLD = 3000;/);
  assert.match(dashboard, /'Need water\? Order now!'/);
  assert.match(dashboard, /'Fresh water, one tap away!'/);

  // Hold duration evaluated per phrase index: 0 is default (5000ms), 1 & 2 are promo (3000ms)
  assert.match(dashboard, /return index === 0 \? GREETING_DEFAULT_HOLD : GREETING_PROMO_HOLD;/);

  // Measured after final character is typed
  assert.match(dashboard, /if \(charIndex >= currentPhrase\.length\) \{\s*isDeleting = true;\s*startBlinking\(\);\s*schedule\(tick, getHoldDuration\(phraseIndex\)\);\s*return;\s*\}/);
});

test('Phase 13B.3 blinking cursor lifecycle: steady while typing/erasing, blinks smoothly during resting phase', () => {
  const dashboard = read('app', 'requester', 'r_dashboard.jsx');

  // 2. BLINKING CURSOR
  assert.match(dashboard, /const GREETING_CURSOR_BLINK_INTERVAL = 500;/);

  // Initial steady cursor
  assert.match(dashboard, /const \[cursorVisible, setCursorVisible\] = useState\(true\);/);

  // Smooth blinking during hold/resting phase
  assert.match(dashboard, /blinkIntervalId = setInterval\(\(\) => \{\s*setCursorVisible\(\(prev\) => !prev\);\s*\}, GREETING_CURSOR_BLINK_INTERVAL\);/);

  // Stop blinking and steady cursor when erasing begins
  assert.match(dashboard, /const stopBlinking = \(\) => \{\s*if \(blinkIntervalId\) \{\s*clearInterval\(blinkIntervalId\);\s*blinkIntervalId = null;\s*\}\s*if \(isMounted\) \{\s*setCursorVisible\(true\);\s*\}\s*\};/);

  // Stop blinking when transition to erase happens
  assert.match(dashboard, /if \(blinkIntervalId\) \{\s*stopBlinking\(\);\s*\}/);

  // Cursor cleanup on unmount prevents memory leaks
  assert.match(dashboard, /if \(blinkIntervalId\) \{\s*clearInterval\(blinkIntervalId\);\s*\}/);

  // Cursor styling is thin ('300') and preserves layout without shift
  assert.match(dashboard, /greetingCursor:[\s\S]{0,80}fontWeight:\s*'300'/);
  assert.match(dashboard, /greetingCursorHidden:[\s\S]{0,40}opacity:\s*0/);
});

test('Phase 13B.3 stability: clock updates do not restart animation and reduced-motion is respected', () => {
  const dashboard = read('app', 'requester', 'r_dashboard.jsx');

  // TextRef is used so clock update doesn't trigger effect re-run
  assert.match(dashboard, /const textRef = useRef\(text\);/);
  assert.match(dashboard, /textRef\.current = text;/);

  // Effect only depends on reduceMotion, not text
  assert.match(dashboard, /\}, \[reduceMotion\]\);/);

  // Reduced motion support
  assert.match(dashboard, /if \(reduceMotion\) \{\s*setDisplayed\(text\);\s*setCursorVisible\(false\);\s*return;\s*\}/);
  assert.match(dashboard, /!reduceMotion && \([\s\S]{0,100}greetingCursor/);

  // Single-line layout stabilization
  assert.match(dashboard, /numberOfLines=\{1\}/);
  assert.match(dashboard, /ellipsizeMode="tail"/);
});

\n