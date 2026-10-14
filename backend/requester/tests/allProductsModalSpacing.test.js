const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const test = require('node:test');

const root = resolve(__dirname, '../../..');
const read = (...parts) => readFileSync(resolve(root, ...parts), 'utf8');

test('All Products modal provides proper content container spacing and item containment', () => {
  const dashboard = read('app', 'requester', 'r_dashboard.jsx');
  const productCard = read('components', 'ProductCard.jsx');

  // Verify ScrollView uses contentContainerStyle for inner items spacing
  assert.match(
    dashboard,
    /contentContainerStyle=\{styles\.allProductsContentContainer\}/,
    'ScrollView must provide contentContainerStyle for proper item layout and spacing'
  );

  // Verify allProductsContentContainer styles define gap, paddingBottom, and top room
  assert.match(
    dashboard,
    /allProductsContentContainer:\s*\{[^}]*gap:\s*18/,
    'allProductsContentContainer must define gap to space product cards evenly'
  );
  assert.match(
    dashboard,
    /allProductsContentContainer:\s*\{[^}]*paddingBottom:\s*24/,
    'allProductsContentContainer must provide generous bottom padding for scrolling'
  );

  // Verify wrapper centers and spans full width
  assert.match(
    dashboard,
    /allProductsItemWrapper:\s*\{[^}]*width:\s*'100%'/,
    'allProductsItemWrapper must span 100% width'
  );
  assert.match(
    dashboard,
    /allProductsItemWrapper:\s*\{[^}]*alignItems:\s*'center'/,
    'allProductsItemWrapper must center the product card'
  );

  // Verify ProductCard accepts optional custom style
  assert.match(
    productCard,
    /export default function ProductCard\(\{.*style.*\}\)/,
    'ProductCard must accept an optional style prop'
  );

  // Verify ProductCard content container and button spacing
  assert.match(
    productCard,
    /content:\{[^}]*paddingHorizontal:16,[^}]*paddingTop:12,[^}]*paddingBottom:16/,
    'ProductCard content must have balanced 16px lateral/bottom and 12px top padding'
  );
  assert.match(
    productCard,
    /metaBlock:\{[^}]*marginTop:10/,
    'ProductCard metaBlock must provide breathing room below product details'
  );
  assert.match(
    productCard,
    /button:\{[^}]*minHeight:44/,
    'ProductCard action button must meet 44px touch target height'
  );
});
