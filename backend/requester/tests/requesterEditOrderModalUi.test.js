const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '../../..');
const read = (relPath) => readFileSync(resolve(root, relPath), 'utf8');

test('RequesterEditOrderModal enforces solid theme surfaces and separate backdrop', () => {
  const modalCode = read('components/RequesterEditOrderModal.jsx');

  // Layering architecture: separate backdrop Pressable and solid modal surface
  assert.match(modalCode, /<View style={styles\.rootOverlay}>/);
  assert.match(modalCode, /<Pressable[^>]*style=\{[^}]*styles\.backdrop/);
  assert.match(modalCode, /accessibilityViewIsModal/);
  assert.match(modalCode, /style=\{[^}]*styles\.modalCard/);

  // High overlay layering above floating chat (zIndex: 90) and bottom nav (zIndex: 20)
  assert.match(modalCode, /zIndex:\s*9999/);
  assert.match(modalCode, /elevation:\s*24/);

  // Fully opaque modal surface in light (#FFFFFF) and dark (colors.surface)
  assert.match(modalCode, /backgroundColor:\s*isDark \? colors\.surface : '#FFFFFF'/);
  assert.doesNotMatch(modalCode, /colors\.card/);
  assert.doesNotMatch(modalCode, /colors\.backgroundSecondary/);

  // Ordered product item cards with wrapping safety
  assert.match(modalCode, /styles\.itemCard/);
  assert.match(modalCode, /styles\.itemInfo/);
  assert.match(modalCode, /minWidth:\s*0/);
  assert.match(modalCode, /flexShrink:\s*1/);
  assert.match(modalCode, /styles\.qtyControlRow/);

  // Solid inputs with theme-safe placeholders and bounded height
  assert.match(modalCode, /isDark \? colors\.input : '#F8FAFC'/);
  assert.match(modalCode, /placeholderTextColor=\{isDark \? colors\.muted : '#94A3B8'\}/);
  assert.match(modalCode, /maxHeight:\s*96/);

  // Distinct solid price summary card
  assert.match(modalCode, /isDark \? colors\.surfaceAlt : '#F0F8FF'/);
  assert.match(modalCode, /styles\.priceSummaryBox/);

  // Reachable 44px min-touch footer with narrow stacking support
  assert.match(modalCode, /styles\.footer/);
  assert.match(modalCode, /styles\.footerStacked/);
  assert.match(modalCode, /styles\.btnFullWidth/);
  assert.match(modalCode, /minHeight:\s*44/);

  // Unsaved changes guard preservation
  assert.match(modalCode, /useUnsavedChangesGuard/);
  assert.match(modalCode, /confirmLeave/);
  assert.match(modalCode, /<UnsavedModal \/>/);
});
