const DISPATCH_PAGE_SIZE = 5;

/**
 * Calculate total pages for dispatch queue. Minimum 1 page.
 */
function totalDispatchPages(totalOrders, pageSize = DISPATCH_PAGE_SIZE) {
  const count = Math.max(0, Number(totalOrders) || 0);
  const size = Math.max(1, Number(pageSize) || DISPATCH_PAGE_SIZE);
  return Math.max(1, Math.ceil(count / size));
}

/**
 * Clamp requested page into valid [1, totalPages] range.
 */
function clampDispatchPage(page, totalOrders, pageSize = DISPATCH_PAGE_SIZE) {
  const maxPage = totalDispatchPages(totalOrders, pageSize);
  return Math.min(Math.max(1, Number(page) || 1), maxPage);
}

/**
 * Calculate pagination metadata for the dispatch queue.
 */
function dispatchPageMeta(totalOrders, page, pageSize = DISPATCH_PAGE_SIZE) {
  const count = Math.max(0, Number(totalOrders) || 0);
  const size = Math.max(1, Number(pageSize) || DISPATCH_PAGE_SIZE);
  const totalPages = totalDispatchPages(count, size);
  const safePage = clampDispatchPage(page, count, size);
  const start = (safePage - 1) * size;
  const end = Math.min(start + size, count);
  const startIndex = count === 0 ? 0 : start + 1;
  const endIndex = end;

  return {
    currentPage: safePage,
    safePage,
    totalPages,
    start,
    end,
    startIndex,
    endIndex,
    totalOrders: count,
    pageSize: size,
    hasNext: safePage < totalPages,
    hasPrev: safePage > 1,
  };
}

/**
 * Slice an array of orders according to current page and page size.
 */
function dispatchPageSlice(orders, page, pageSize = DISPATCH_PAGE_SIZE) {
  const list = Array.isArray(orders) ? orders : [];
  const meta = dispatchPageMeta(list.length, page, pageSize);
  return {
    ...meta,
    pagedOrders: list.slice(meta.start, meta.end),
  };
}

/**
 * Compute compact array of page numbers with ellipsis for pagination navigation.
 */
function dispatchPageNumbers(currentPage, totalPages) {
  const total = Math.max(1, Number(totalPages) || 1);
  const current = Math.min(Math.max(1, Number(currentPage) || 1), total);

  if (total <= 5) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }

  const pages = [1];
  let start = Math.max(2, current - 1);
  let end = Math.min(total - 1, current + 1);

  if (current <= 2) {
    end = Math.min(total - 1, 4);
  }
  if (current >= total - 1) {
    start = Math.max(2, total - 3);
  }

  if (start > 2) {
    pages.push('ellipsis-start');
  }

  for (let i = start; i <= end; i += 1) {
    pages.push(i);
  }

  if (end < total - 1) {
    pages.push('ellipsis-end');
  }

  pages.push(total);
  return pages;
}

module.exports = {
  DISPATCH_PAGE_SIZE,
  totalDispatchPages,
  clampDispatchPage,
  dispatchPageMeta,
  dispatchPageSlice,
  dispatchPageNumbers,
};
