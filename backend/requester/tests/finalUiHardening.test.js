const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..', '..', '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('shared input motion is theme-safe, error-aware, disabled-safe, and reduced-motion-safe', () => {
  const css = read('global.css');
  assert.match(css, /\[data-bluetap-theme='dark'\]/);
  assert.match(css, /input:not\(:disabled\):not\(\[aria-invalid='true'\]\):hover/);
  assert.match(css, /input\[aria-invalid='true'\][\s\S]*--bluetap-input-error/);
  assert.match(css, /input:disabled[\s\S]*box-shadow: none !important/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /box-shadow 170ms ease-out/);
});

test('theme switch and clock night marks each pair the moon with one subtle star', () => {
  const switchVisual = read('components/ThemeSwitchVisual.jsx');
  const clock = read('components/LocalTimeCard.jsx');
  assert.match(switchVisual, /isDark && <Text style=\{styles\.moonStar\}>/);
  assert.match(clock, /!daytime && <BlueTapIcon name="star"/);
});

test('Distributor carousel exposes a bounded peek, contained inactive cards, final settlement, and icon arrows', () => {
  const dashboard = read('app/distributor/d_dashboard.jsx');
  assert.match(dashboard, /Math\.min\(24, Math\.max\(16,/);
  assert.match(dashboard, /outputRange: \[0\.8, 1\]/);
  assert.match(dashboard, /outputRange: \[0\.97, 1\]/);
  assert.match(dashboard, /pointerEvents=\{active \? 'auto' : 'none'\}/);
  assert.match(dashboard, /onMomentumScrollEnd=\{handleCarouselMomentumEnd\}/);
  assert.match(dashboard, /onScroll=\{handleCarouselScroll\}/);
  assert.match(dashboard, /onTouchEnd=\{handleCarouselTouchEnd\}/);
  assert.match(dashboard, /carouselInteractionRef/);
  assert.match(dashboard, /isCurrentCarouselOffset/);
  assert.match(dashboard, /name="chevron-left"/);
  assert.match(dashboard, /name="chevron-right"/);
  assert.match(dashboard, /showCarouselArrows = width >= 600 && activeRequestEntries\.length > 1/);
  assert.match(dashboard, /const commitCarouselIndex =/);
  assert.match(dashboard, /const moveCarousel =[\s\S]*commitCarouselIndex\(resolveCarouselStepIndex/);
  assert.match(dashboard, /const commitCarouselSwipe =[\s\S]*commitCarouselIndex\(nextIndex/);
  assert.match(dashboard, /const handleCarouselScroll =[\s\S]*scheduleCarouselOffsetCommit/);
});

test('Distributor delivery card uses compact spacing and semantic action hierarchy', () => {
  const dashboard = read('app/distributor/d_dashboard.jsx');
  const chatActions = read('components/chat/ChatOrderActions.jsx');
  assert.doesNotMatch(dashboard, /minHeight: 430/);
  assert.match(dashboard, /minHeight: 352/);
  assert.match(dashboard, /backgroundColor: colors\.successAction/);
  assert.match(dashboard, /backgroundColor: colors\.dangerSoft/);
  assert.match(chatActions, /softPrimary/);
  assert.doesNotMatch(dashboard, /summaryCard: \{\s*flex:/);
});
