const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { parse } = require('@babel/parser');

function getProjection(file) {
  const source = readFileSync(resolve(__dirname, '../../../', file), 'utf8');
  const tree = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const declaration = tree.program.body.flatMap((node) => node.declarations || []).find((node) => node.id?.name === 'getDetailsRequestData');
  assert.ok(declaration);
  return new Function('getAmountNumber', 'formatDisplayUniqueId', 'normalizeStatus', `return (${source.slice(declaration.init.start, declaration.init.end)})`)(
    (value) => Number(String(value ?? '').replace(/[^\d.]/g, '')) || 0,
    (value, fallback) => value || fallback,
    (value) => String(value).toLowerCase(),
  );
}

for (const file of ['app/distributor/d_requests.jsx', 'app/distributor/d_scheduled_requests.jsx', 'app/distributor/d_history.jsx']) {
  test(`${file} preserves saved item amounts and fee`, async () => {
    const project = getProjection(file);
    const items = [{ productName: 'Refill', quantity: 3, unitPrice: 20, subtotal: 60 }];
    const result = project({ id: 'order', status: 'scheduled', productName: 'Refill', quantity: '3', amountDue: '₱72.50', amountPaid: '₱72.50', totalAmount: 72.5, items, subtotalAtOrder: 60, deliveryFeeAtOrder: 12.5 });
    assert.deepEqual(result.items, items);
    assert.equal(result.subtotalAtOrder, 60);
    assert.equal(result.deliveryFeeAtOrder, 12.5);
    const authoritative = { pricingSnapshot: { schemaVersion: 1, payableCentavos: 7250 } };
    assert.equal(project({ id: 'order', pricingDetailsSource: authoritative }).pricingDetailsSource, authoritative);
    const legacy = project({ id: 'old', productName: 'Refill', quantity: '3', amountDue: '₱72.50', amountPaid: '₱72.50', totalAmount: 72.5 });
    assert.equal(legacy.items[0].unitPrice, undefined);
    assert.equal(legacy.items[0].subtotal, undefined);
    const { normalizeRequestDetails } = await import('../../../services/orderNormalizer.js');
    const normalized = normalizeRequestDetails(legacy);
    assert.equal(normalized.subtotalAtOrder, undefined);
    assert.equal(normalized.deliveryFeeAtOrder, undefined);
    assert.equal(normalized.grandTotal, 72.5);
  });
}
