const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { parse } = require('@babel/parser');

test('Requester Order Details retains authoritative subtotal and delivery fee', async () => {
  const requestSource = readFileSync(resolve(__dirname, '../../../services/requests.js'), 'utf8');
  const requestTree = parse(requestSource, { sourceType: 'module' });
  const requestDeclaration = requestTree.program.body.flatMap((node) => node.declarations || [])
    .find((node) => node.id?.name === 'normalizeRequest');
  assert.ok(requestDeclaration?.init, 'Requester realtime order normalization exists');
  const normalizeRequest = new Function('normalizeItems', 'normalizeAmount', 'formatDeliveryFailureReason',
    `return (${requestSource.slice(requestDeclaration.init.start, requestDeclaration.init.end)});`)(
    (order) => order.items, (value) => Number(value || 0), () => '',
  );
  const source = readFileSync(resolve(__dirname, '../../../app/requester/r_request.jsx'), 'utf8');
  const tree = parse(source, { sourceType: 'module', plugins: ['jsx'] });
  const declaration = tree.program.body.flatMap((node) => node.declarations || [])
    .find((node) => node.id?.name === 'getDetailsRequestData');
  assert.ok(declaration?.init, 'Requester details projection exists');
  const projection = new Function('getRequestId', 'formatDateValue', 'getProductSummary',
    'getQuantityText', 'getTotalAmount', 'findLocalUserForAuthRole', 'auth', 'getRequestItems',
    `return (${source.slice(declaration.init.start, declaration.init.end)});`)(
    (order) => order.id, () => 'Oct 26, 2026', () => 'Water', () => '1',
    (order) => order.totalAtOrder, () => null, { currentUser: null }, (order) => order.items,
  );
  const order = {
    id: 'emulator-order', status: 'delivery_failed', product_name: 'Water',
    subtotalAtOrder: 35, deliveryFeeAtOrder: 5, totalAtOrder: 40,
    items: [{ productNameSnapshot: 'Water', unitPriceAtOrder: 35, totalAtOrder: 35, quantity: 1 }],
  };
  const details = projection(normalizeRequest(order.id, order));
  const { normalizeRequestDetails } = await import('../../../services/orderNormalizer.js');
  const normalized = normalizeRequestDetails(details);
  assert.equal(normalized.subtotalAtOrder, 35);
  assert.equal(normalized.deliveryFeeAtOrder, 5);
  assert.equal(normalized.grandTotal, 40);
  const discounted = projection(normalizeRequest(order.id, {
    ...order, discountAmount: 4, discountReason: 'Approved credit', totalAtOrder: 36,
  }));
  const discountedDetails = normalizeRequestDetails(discounted);
  assert.equal(discountedDetails.discountAmount, 4);
  assert.equal(discountedDetails.discountReason, 'Approved credit');
  assert.equal(discountedDetails.grandTotal, 36);
});
