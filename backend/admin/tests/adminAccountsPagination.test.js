const assert = require('node:assert/strict');
const test = require('node:test');

const { ACCOUNTS_PER_PAGE, accountPageMeta, accountPageNumbers, accountPageSlice, clampAccountPage, totalAccountPages } = require('../../../services/adminAccountsPagination');

test('Accounts & Audit pagination keeps exactly ten filtered accounts per page and clamps safely', () => {
  const accounts = Array.from({ length: 21 }, (_, index) => ({ uid: `account-${index + 1}` }));
  assert.equal(ACCOUNTS_PER_PAGE, 10);
  assert.equal(totalAccountPages(0), 1);
  assert.equal(totalAccountPages(1), 1);
  assert.equal(totalAccountPages(10), 1);
  assert.equal(totalAccountPages(11), 2);
  assert.equal(totalAccountPages(20), 2);
  assert.equal(totalAccountPages(21), 3);
  assert.equal(clampAccountPage(4, 11), 2);
  assert.deepEqual(accountPageMeta(21, 3), { currentPage: 3, totalPages: 3, start: 20, end: 21 });
  assert.deepEqual(accountPageSlice(accounts, 1).accounts.map((account) => account.uid), accounts.slice(0, 10).map((account) => account.uid));
  assert.deepEqual(accountPageSlice(accounts, 2).accounts.map((account) => account.uid), accounts.slice(10, 20).map((account) => account.uid));
  assert.deepEqual(accountPageSlice(accounts, 3).accounts.map((account) => account.uid), ['account-21']);
});

test('Accounts & Audit page numbers stay compact while retaining first, last, and nearby pages', () => {
  assert.deepEqual(accountPageNumbers(2, 4), [1, 2, 3, 4]);
  assert.deepEqual(accountPageNumbers(6, 12), [1, 'ellipsis-start', 5, 6, 7, 'ellipsis-end', 12]);
});
