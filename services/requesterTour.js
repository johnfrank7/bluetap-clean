const TUTORIAL_STEPS = [
  { route: '/requester/r_dashboard', target: 'home', icon: 'home', title: 'Home', description: 'Browse products and see your current request on Home.' },
  { route: '/requester/r_request', target: 'add', icon: 'add', title: 'Add a request', description: 'Choose this action to start a water order.' },
  { route: '/requester/r_request', target: 'orders', icon: 'requests', title: 'My orders', description: 'Check active orders and their delivery status here.' },
  { route: '/requester/r_request', target: 'notifications', icon: 'notifications', title: 'Notifications', description: 'Open notifications for order updates and delivery reports.' },
  { route: '/requester/r_profile', target: 'profile', icon: 'profile', title: 'Profile and settings', description: 'Manage your details and password, or reopen this guide from settings.' },
];

// The form follows its real order: location, provider, products, container, review.
const ORDER_WALKTHROUGH = [
  { target: 'order-location', title: 'Delivery location', description: 'Choose your delivery location to find nearby providers.' },
  { target: 'order-provider', title: 'Choose a provider', description: 'Select an available water station near your delivery location.' },
  { target: 'order-products', title: 'Products and quantity', description: 'Choose products, then adjust their quantities in the selected items.' },
  { target: 'order-container', title: 'Container type', description: 'Choose New Container or Exchange for this request.' },
  { target: 'order-review', title: 'Review your request', description: 'Check your delivery details, items and estimated price. Review and confirm only when you are ready.' },
];
const HISTORY_WALKTHROUGH = [
  { route: '/requester/r_request', target: 'history-tab', icon: 'history', title: 'Order history', description: 'History shows your completed and past orders.' },
  { route: '/requester/r_request', target: 'history-content', icon: 'history', title: 'Past orders', description: 'Review past orders here. If you have none yet, this view is empty.' },
];
const TOUR_STOPS = TUTORIAL_STEPS.flatMap((step, mainIndex) => [
  { ...step, mainIndex },
  ...(mainIndex === 1 ? ORDER_WALKTHROUGH.map((item, subIndex) => ({ ...item, route: '/requester/requestform', icon: 'add', mainIndex, subIndex })) : []),
  ...(mainIndex === 2 ? HISTORY_WALKTHROUGH.map((item) => ({ ...item, mainIndex })) : []),
]);

function savedTourStop(value) {
  if (typeof value !== 'string') return -1;
  const versioned = /^v3:(\d+)$/.exec(value);
  if (versioned) {
    const index = Number(versioned[1]);
    return index < TOUR_STOPS.length ? index : -1;
  }
  const previous = /^v2:(\d+)$/.exec(value);
  if (previous) {
    const index = Number(previous[1]);
    return index < 10 ? index + (index >= 8 ? HISTORY_WALKTHROUGH.length : 0) : -1;
  }
  // Older sessions stored a five-step index; keep them on the same main step.
  if (/^\d+$/.test(value)) return TOUR_STOPS.findIndex((stop) => stop.mainIndex === Number(value));
  return -1;
}

// Do not take the user away from an order form or another screen they opened
// while following the guide; those screens may contain unsaved work.
function canNavigateFromTour(pathname) {
  return TUTORIAL_STEPS.some((step) => step.route === pathname);
}

function tourPlacement(width, height, cardHeight, rect) {
  const cardWidth = Math.min(340, Math.max(200, width - 24));
  const center = rect ? rect.x + rect.width / 2 : width / 2;
  const left = Math.max(12, Math.min(width - cardWidth - 12, center - cardWidth / 2));
  const below = rect ? rect.y + rect.height + cardHeight + 22 < height : false;
  const top = rect ? Math.max(12, Math.min(height - cardHeight - 12, below ? rect.y + rect.height + 14 : rect.y - cardHeight - 14)) : Math.max(12, height - cardHeight - 100);
  return { cardWidth, left, top, below, arrowLeft: Math.max(16, Math.min(cardWidth - 32, center - left - 8)) };
}
// Reserve room for the tooltip when a section is taller than the viewport.
function clipTourSection(rect, width, height, cardHeight) {
  if (!rect) return null;
  const left = Math.max(0, rect.x), right = Math.min(width, rect.x + rect.width);
  let top = Math.max(64, rect.y), bottom = Math.min(height - 84, rect.y + rect.height);
  if (right <= left || bottom <= top) return null;
  const roomBelow = height - cardHeight - 24;
  const roomAbove = cardHeight + 24;
  if (bottom - top > height - cardHeight - 48) {
    if (top < roomBelow - 40) bottom = Math.min(bottom, roomBelow);
    else top = Math.max(top, roomAbove);
  }
  return bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}
function spotlightHole(rect, width, height) {
  return rect ? { left: Math.max(0, rect.x - 5), top: Math.max(0, rect.y - 5), right: Math.min(width, rect.x + rect.width + 5), bottom: Math.min(height, rect.y + rect.height + 5) } : null;
}
function spotlightShadeRegions(holes, width, height) {
  const valid = holes.filter((hole) => hole && hole.right > hole.left && hole.bottom > hole.top);
  const boundaries = [...new Set([0, height, ...valid.flatMap((hole) => [hole.top, hole.bottom])])].sort((a, b) => a - b);
  const regions = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const top = boundaries[i], bottom = boundaries[i + 1];
    const intervals = valid.filter((hole) => hole.top < bottom && hole.bottom > top).map((hole) => [hole.left, hole.right]).sort((a, b) => a[0] - b[0]);
    let left = 0;
    for (const [start, end] of intervals) {
      if (start > left) regions.push({ left, top, width: start - left, height: bottom - top });
      left = Math.max(left, end);
    }
    if (left < width) regions.push({ left, top, width: width - left, height: bottom - top });
  }
  return regions;
}
function spotlightPath(hole, width, height, secondHole = null) {
  if (!secondHole) return `M0 0H${width}V${height}H0Z${hole ? ` M${hole.left} ${hole.top}H${hole.right}V${hole.bottom}H${hole.left}Z` : ''}`;
  return spotlightShadeRegions([hole, secondHole], width, height).map((r) => `M${r.left} ${r.top}h${r.width}v${r.height}h-${r.width}Z`).join(' ');
}
module.exports = { TUTORIAL_STEPS, ORDER_WALKTHROUGH, HISTORY_WALKTHROUGH, TOUR_STOPS, savedTourStop, canNavigateFromTour, tourPlacement, clipTourSection, spotlightHole, spotlightPath, spotlightShadeRegions };
