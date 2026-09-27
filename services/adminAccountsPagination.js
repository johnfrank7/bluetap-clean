const ACCOUNTS_PER_PAGE = 10;

function totalAccountPages(accountCount) {
  return Math.max(1, Math.ceil(Math.max(0, Number(accountCount) || 0) / ACCOUNTS_PER_PAGE));
}

function clampAccountPage(page, accountCount) {
  return Math.min(Math.max(1, Number(page) || 1), totalAccountPages(accountCount));
}

function accountPageMeta(accountCount, page) {
  const count = Math.max(0, Number(accountCount) || 0);
  const currentPage = clampAccountPage(page, count);
  const totalPages = totalAccountPages(count);
  const start = (currentPage - 1) * ACCOUNTS_PER_PAGE;
  const end = Math.min(start + ACCOUNTS_PER_PAGE, count);
  return { currentPage, totalPages, start, end };
}

function accountPageSlice(accounts, page) {
  const list = Array.isArray(accounts) ? accounts : [];
  const meta = accountPageMeta(list.length, page);
  return { ...meta, accounts: list.slice(meta.start, meta.end) };
}

function accountPageNumbers(currentPage, totalPages) {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages = [1];
  if (currentPage > 4) pages.push('ellipsis-start');
  for (let page = Math.max(2, currentPage - 1); page <= Math.min(totalPages - 1, currentPage + 1); page += 1) pages.push(page);
  if (currentPage < totalPages - 3) pages.push('ellipsis-end');
  pages.push(totalPages);
  return pages;
}

module.exports = { ACCOUNTS_PER_PAGE, accountPageMeta, accountPageNumbers, accountPageSlice, clampAccountPage, totalAccountPages };
