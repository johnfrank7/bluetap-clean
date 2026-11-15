const test = require('node:test');
const assert = require('node:assert/strict');

test('only explicit missing routes suppress repeated requests, per server and route', async () => {
  const { missingEndpointError, rememberMissingEndpoint } = await import('../../../services/unavailableEndpoint.js');
  const url = 'https://example.test/api/requester/delivery-reports?limit=20';
  rememberMissingEndpoint(url, 404, { error: { reason: 'ORDER_NOT_FOUND' } });
  assert.equal(missingEndpointError(url), null);
  rememberMissingEndpoint(url, 404, { error: { reason: 'not-found' } });
  assert.equal(missingEndpointError(url.replace('limit=20', 'feed=review-completions')).code, 'ENDPOINT_UNAVAILABLE');
  assert.equal(missingEndpointError('https://other.test/api/requester/delivery-reports'), null);
  assert.equal(missingEndpointError('https://example.test/api/distributor/delivery-reviews'), null);
});
