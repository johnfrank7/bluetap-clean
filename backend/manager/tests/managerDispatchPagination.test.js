const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DISPATCH_PAGE_SIZE,
  totalDispatchPages,
  clampDispatchPage,
  dispatchPageMeta,
  dispatchPageSlice,
  dispatchPageNumbers,
} = require('../../../services/managerDispatchPagination');

test('DISPATCH_PAGE_SIZE is 5 by default', () => {
  assert.equal(DISPATCH_PAGE_SIZE, 5);
});

test('Pagination calculations for 0 orders', () => {
  const meta = dispatchPageMeta(0, 1);
  assert.equal(meta.totalPages, 1);
  assert.equal(meta.currentPage, 1);
  assert.equal(meta.startIndex, 0);
  assert.equal(meta.endIndex, 0);
  assert.equal(meta.totalOrders, 0);
  assert.equal(meta.hasPrev, false);
  assert.equal(meta.hasNext, false);

  const slice = dispatchPageSlice([], 1);
  assert.deepEqual(slice.pagedOrders, []);
  assert.deepEqual(dispatchPageNumbers(1, 1), [1]);
});

test('Pagination calculations for 1 order', () => {
  const orders = [{ id: 'order-1' }];
  const meta = dispatchPageMeta(orders.length, 1);
  assert.equal(meta.totalPages, 1);
  assert.equal(meta.currentPage, 1);
  assert.equal(meta.startIndex, 1);
  assert.equal(meta.endIndex, 1);
  assert.equal(meta.totalOrders, 1);
  assert.equal(meta.hasPrev, false);
  assert.equal(meta.hasNext, false);

  const slice = dispatchPageSlice(orders, 1);
  assert.deepEqual(slice.pagedOrders, orders);
  assert.deepEqual(dispatchPageNumbers(1, 1), [1]);
});

test('Pagination calculations for 5 orders (exact 1 full page)', () => {
  const orders = Array.from({ length: 5 }, (_, i) => ({ id: `order-${i + 1}` }));
  const meta = dispatchPageMeta(orders.length, 1);
  assert.equal(meta.totalPages, 1);
  assert.equal(meta.currentPage, 1);
  assert.equal(meta.startIndex, 1);
  assert.equal(meta.endIndex, 5);
  assert.equal(meta.hasPrev, false);
  assert.equal(meta.hasNext, false);

  const slice = dispatchPageSlice(orders, 1);
  assert.equal(slice.pagedOrders.length, 5);
  assert.equal(slice.pagedOrders[0].id, 'order-1');
  assert.equal(slice.pagedOrders[4].id, 'order-5');
  assert.deepEqual(dispatchPageNumbers(1, 1), [1]);
});

test('Pagination calculations for 6 orders (spills to 2 pages)', () => {
  const orders = Array.from({ length: 6 }, (_, i) => ({ id: `order-${i + 1}` }));

  // Page 1
  const metaPage1 = dispatchPageMeta(orders.length, 1);
  assert.equal(metaPage1.totalPages, 2);
  assert.equal(metaPage1.currentPage, 1);
  assert.equal(metaPage1.startIndex, 1);
  assert.equal(metaPage1.endIndex, 5);
  assert.equal(metaPage1.hasPrev, false);
  assert.equal(metaPage1.hasNext, true);

  const slice1 = dispatchPageSlice(orders, 1);
  assert.equal(slice1.pagedOrders.length, 5);
  assert.equal(slice1.pagedOrders[0].id, 'order-1');
  assert.equal(slice1.pagedOrders[4].id, 'order-5');

  // Page 2
  const metaPage2 = dispatchPageMeta(orders.length, 2);
  assert.equal(metaPage2.totalPages, 2);
  assert.equal(metaPage2.currentPage, 2);
  assert.equal(metaPage2.startIndex, 6);
  assert.equal(metaPage2.endIndex, 6);
  assert.equal(metaPage2.hasPrev, true);
  assert.equal(metaPage2.hasNext, false);

  const slice2 = dispatchPageSlice(orders, 2);
  assert.equal(slice2.pagedOrders.length, 1);
  assert.equal(slice2.pagedOrders[0].id, 'order-6');

  assert.deepEqual(dispatchPageNumbers(1, 2), [1, 2]);
});

test('Pagination calculations for 10 orders (exact 2 full pages)', () => {
  const orders = Array.from({ length: 10 }, (_, i) => ({ id: `order-${i + 1}` }));

  // Page 1
  const slice1 = dispatchPageSlice(orders, 1);
  assert.equal(slice1.totalPages, 2);
  assert.equal(slice1.currentPage, 1);
  assert.equal(slice1.startIndex, 1);
  assert.equal(slice1.endIndex, 5);
  assert.equal(slice1.pagedOrders.length, 5);
  assert.equal(slice1.pagedOrders[0].id, 'order-1');
  assert.equal(slice1.pagedOrders[4].id, 'order-5');

  // Page 2
  const slice2 = dispatchPageSlice(orders, 2);
  assert.equal(slice2.totalPages, 2);
  assert.equal(slice2.currentPage, 2);
  assert.equal(slice2.startIndex, 6);
  assert.equal(slice2.endIndex, 10);
  assert.equal(slice2.pagedOrders.length, 5);
  assert.equal(slice2.pagedOrders[0].id, 'order-6');
  assert.equal(slice2.pagedOrders[4].id, 'order-10');

  assert.deepEqual(dispatchPageNumbers(2, 2), [1, 2]);
});

test('Pagination calculations for 23 orders (5 pages)', () => {
  const orders = Array.from({ length: 23 }, (_, i) => ({ id: `order-${i + 1}` }));

  // Total pages
  assert.equal(totalDispatchPages(orders.length), 5);

  // Page 1
  const slice1 = dispatchPageSlice(orders, 1);
  assert.equal(slice1.currentPage, 1);
  assert.equal(slice1.startIndex, 1);
  assert.equal(slice1.endIndex, 5);
  assert.equal(slice1.pagedOrders.length, 5);
  assert.equal(slice1.pagedOrders[0].id, 'order-1');
  assert.equal(slice1.pagedOrders[4].id, 'order-5');
  assert.equal(slice1.hasPrev, false);
  assert.equal(slice1.hasNext, true);

  // Page 3
  const slice3 = dispatchPageSlice(orders, 3);
  assert.equal(slice3.currentPage, 3);
  assert.equal(slice3.startIndex, 11);
  assert.equal(slice3.endIndex, 15);
  assert.equal(slice3.pagedOrders.length, 5);
  assert.equal(slice3.pagedOrders[0].id, 'order-11');
  assert.equal(slice3.pagedOrders[4].id, 'order-15');
  assert.equal(slice3.hasPrev, true);
  assert.equal(slice3.hasNext, true);

  // Page 5 (last page)
  const slice5 = dispatchPageSlice(orders, 5);
  assert.equal(slice5.currentPage, 5);
  assert.equal(slice5.startIndex, 21);
  assert.equal(slice5.endIndex, 23);
  assert.equal(slice5.pagedOrders.length, 3);
  assert.equal(slice5.pagedOrders[0].id, 'order-21');
  assert.equal(slice5.pagedOrders[2].id, 'order-23');
  assert.equal(slice5.hasPrev, true);
  assert.equal(slice5.hasNext, false);

  assert.deepEqual(dispatchPageNumbers(1, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(dispatchPageNumbers(3, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(dispatchPageNumbers(5, 5), [1, 2, 3, 4, 5]);
});

test('Pagination clamping prevents stale or out-of-bound pages when queue shrinks', () => {
  // If user was on page 5 with 23 orders, but queue drops to 8 orders (2 pages)
  assert.equal(clampDispatchPage(5, 8), 2);
  assert.equal(clampDispatchPage(99, 8), 2);
  assert.equal(clampDispatchPage(-5, 8), 1);
  assert.equal(clampDispatchPage(0, 8), 1);

  // If queue drops to 0 orders
  assert.equal(clampDispatchPage(3, 0), 1);
});

test('Compact page number window with ellipsis for 10 pages', () => {
  // Near start: [1, 2, 3, 4, 'ellipsis-end', 10]
  assert.deepEqual(dispatchPageNumbers(1, 10), [1, 2, 3, 4, 'ellipsis-end', 10]);
  assert.deepEqual(dispatchPageNumbers(2, 10), [1, 2, 3, 4, 'ellipsis-end', 10]);

  // Middle: [1, 'ellipsis-start', 4, 5, 6, 'ellipsis-end', 10]
  assert.deepEqual(dispatchPageNumbers(5, 10), [1, 'ellipsis-start', 4, 5, 6, 'ellipsis-end', 10]);

  // Near end: [1, 'ellipsis-start', 7, 8, 9, 10]
  assert.deepEqual(dispatchPageNumbers(9, 10), [1, 'ellipsis-start', 7, 8, 9, 10]);
  assert.deepEqual(dispatchPageNumbers(10, 10), [1, 'ellipsis-start', 7, 8, 9, 10]);
});
