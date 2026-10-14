const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '../../..');
const read = (...parts) => readFileSync(resolve(root, ...parts), 'utf8');

test('RequestFormPage Section 3 provides desktop web and mobile horizontal product scrolling with arrows and scrollbar', () => {
  const form = read('app', 'requester', 'requestform.jsx');
  const css = read('global.css');

  // 1. Scroll ref and state hooks
  assert.match(form, /const productsScrollRef = React\.useRef\(null\);/);
  assert.match(form, /const \[canScrollLeft, setCanScrollLeft\] = React\.useState\(false\);/);
  assert.match(form, /const \[canScrollRight, setCanScrollRight\] = React\.useState\(true\);/);

  // 2. Scroll handlers and step calculation
  assert.match(form, /const handleProductsScroll = React\.useCallback/);
  assert.match(form, /const scrollProducts = React\.useCallback/);
  assert.match(form, /const step = 272;/);

  // 3. Carousel arrow buttons rendered when products.length > 1
  assert.match(form, /selectedBranch && products\.length > 1/);
  assert.match(form, /styles\.carouselArrows/);
  assert.match(form, /accessibilityLabel="Previous product"/);
  assert.match(form, /accessibilityLabel="Next product"/);
  assert.match(form, /name="chevron-left"/);
  assert.match(form, /name="chevron-right"/);
  assert.match(form, /onPress=\{\(\) => scrollProducts\(-1\)\}/);
  assert.match(form, /onPress=\{\(\) => scrollProducts\(1\)\}/);

  // 4. Products ScrollView has ref, visible scroll indicator, and dataset tag
  assert.match(form, /<ScrollView[\s\S]*ref=\{productsScrollRef\}[\s\S]*horizontal[\s\S]*showsHorizontalScrollIndicator=\{true\}/);
  assert.match(form, /dataSet=\{\{\s*productScroll:\s*['"]true['"]\s*\}\}/);

  // 5. Custom scrollbar styles in global.css
  assert.match(css, /\[data-product-scroll='true'\]::-webkit-scrollbar/);
  assert.match(css, /\[data-product-scroll='true'\]::-webkit-scrollbar-thumb/);
});
