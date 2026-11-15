const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const modalPath = resolve(__dirname, '../../../components/AdminBundlePromotionModal.jsx');
const modalSource = readFileSync(modalPath, 'utf8');

test('Admin Bundle Promotions Modal UI: Save Draft button uses neutral outline secondary style', () => {
  assert.match(modalSource, /accessibilityLabel="Save Draft"/, 'Must have explicit Save Draft accessibility label');
  assert.match(modalSource, /backgroundColor:\s*colors\.surface/, 'Save Draft must use neutral surface background');
  assert.match(modalSource, /borderColor:\s*colors\.border/, 'Save Draft must have clear border');
  assert.match(modalSource, /saving\s*\?\s*'Saving…'\s*:\s*'Save Draft'/, 'Button label must be Save Draft');
});

test('Admin Bundle Promotions Modal UI: Save & Publish uses success-green primary styling and communicates capability state', () => {
  assert.match(modalSource, /accessibilityLabel="Save & Publish"/, 'Must have explicit Save & Publish accessibility label');
  assert.match(modalSource, /colors\.successAction\s*\|\|\s*colors\.success/, 'Save & Publish must use success green token when enabled');
  assert.match(modalSource, /colors\.onSuccess\s*\|\|\s*'#FFFFFF'/, 'Save & Publish must use accessible contrast text');
  assert.match(modalSource, /disabled=\{saving\s*\|\|\s*!product\?\.promotionActivationAvailable\}/, 'Must disable when publication capability is unavailable');
  assert.match(modalSource, /Server publishing is disabled\. Use Save Draft to store your changes\./, 'Must explain disabled capability under buttons');
});

test('Admin Bundle Promotions Modal UI: Active promotion displays dedicated Promotion Management section with red danger Disable button', () => {
  assert.match(modalSource, /Promotion Management/, 'Must have dedicated Promotion Management section when active');
  assert.match(modalSource, /accessibilityLabel="Disable Promotion"/, 'Must have explicit Disable Promotion accessibility label');
  assert.match(modalSource, /colors\.dangerAction\s*\|\|\s*colors\.danger/, 'Disable Promotion must use strong red danger token');
  assert.match(modalSource, /colors\.onDanger\s*\|\|\s*'#FFFFFF'/, 'Disable Promotion must use high-contrast foreground');
  assert.match(modalSource, /Stops this promotion for new eligible orders\./, 'Must display supporting text for Disable action');
  assert.match(modalSource, /saving\s*\?\s*'Disabling…'\s*:\s*'Disable Promotion'/, 'Label must be Disable Promotion');
});

test('Admin Bundle Promotions Modal UI: State-specific footer prevents misleading actions when active', () => {
  assert.match(modalSource, /activeRecord\s*\?\s*\(\s*<View[^>]*justifyContent:\s*'flex-end'/, 'Active promotion footer must render separate container');
  assert.match(modalSource, /accessibilityLabel="Close"/, 'Active promotion footer must provide Close action');
  assert.ok(
    modalSource.includes('accessibilityLabel="Close"') &&
    modalSource.includes('accessibilityLabel="Save Draft"') &&
    modalSource.includes('accessibilityLabel="Save & Publish"'),
    'Component contains clean separation of active vs draft actions'
  );
});

test('Admin Bundle Promotions Modal UI: Preserves publish and disable confirmation dialogs with semantic styling', () => {
  assert.match(modalSource, /Save &amp; Publish Promotion\?/, 'Publish confirmation modal title preserved');
  assert.match(modalSource, /Disable promotion\?/, 'Disable confirmation modal title preserved');
  assert.match(modalSource, /confirmAction === 'disable' \? \(colors\.dangerAction \|\| colors\.danger/, 'Disable confirmation action uses danger styling');
});

test('Admin Bundle Promotions Modal UI: Responsive footer layout supports desktop row and mobile stacking', () => {
  assert.match(modalSource, /width\s*<\s*480\s*\?\s*'column-reverse'\s*:\s*'row'/, 'Footer buttons must stack cleanly on mobile');
});
