const test = require('node:test');
const assert = require('node:assert/strict');
const { TUTORIAL_STEPS, ORDER_WALKTHROUGH, HISTORY_WALKTHROUGH, TOUR_STOPS, savedTourStop, canNavigateFromTour, tourPlacement, clipTourSection, spotlightHole, spotlightPath, spotlightShadeRegions } = require('../../../services/requesterTour');

test('two spotlight openings stay clear even if their bounds overlap', () => {
  const first = { left: 20, top: 10, right: 80, bottom: 60 };
  const second = { left: 60, top: 40, right: 90, bottom: 90 };
  const regions = spotlightShadeRegions([first, second], 100, 100);
  const shaded = (x, y) => regions.some((r) => x >= r.left && x < r.left + r.width && y >= r.top && y < r.top + r.height);
  assert.equal(shaded(30, 20), false);
  assert.equal(shaded(70, 50), false);
  assert.equal(shaded(85, 80), false);
  assert.equal(shaded(10, 50), true);
  assert.equal(shaded(95, 95), true);
  assert.ok(spotlightPath(first, 100, 100, second).includes('Z'));
});

test('spotlight leaves a bounded opening around the target and dims the rest', () => {
  const hole = spotlightHole({ x: -2, y: 10, width: 40, height: 30 }, 320, 640);
  assert.deepEqual(hole, { left: 0, top: 5, right: 43, bottom: 45 });
  assert.equal(spotlightPath(hole, 320, 640), 'M0 0H320V640H0Z M0 5H43V45H0Z');
  assert.equal(spotlightPath(null, 320, 640), 'M0 0H320V640H0Z');
});

test('order walkthrough follows real form targets while retaining five main sections', () => {
  assert.deepEqual(ORDER_WALKTHROUGH.map((step) => step.target), ['order-location', 'order-provider', 'order-products', 'order-container', 'order-review']);
  assert.equal(TOUR_STOPS.length, 12);
  assert.ok(TOUR_STOPS.slice(2, 7).every((step) => step.mainIndex === 1 && step.route === '/requester/requestform'));
});

test('saved progress resumes walkthrough and remains compatible with older five-step sessions', () => {
  assert.equal(savedTourStop('v3:4'), 4);
  assert.equal(savedTourStop('v2:8'), 10);
  assert.equal(savedTourStop('v2:9'), 11);
  assert.equal(savedTourStop('2'), 7);
  assert.equal(savedTourStop('4'), 11);
  for (const invalid of ['v2:10', 'v3:12', '-1', 'abc', '', null]) assert.equal(savedTourStop(invalid), -1);
});

test('history remains inside My Orders and precedes notifications', () => {
  assert.deepEqual(HISTORY_WALKTHROUGH.map((step) => step.target), ['history-tab', 'history-content']);
  assert.deepEqual(TOUR_STOPS.slice(7, 11).map((step) => step.target), ['orders', 'history-tab', 'history-content', 'notifications']);
  assert.ok(TOUR_STOPS.slice(7, 10).every((step) => step.mainIndex === 2));
});

test('large section spotlight stays in the viewport and leaves room for the tooltip', () => {
  for (const width of [320, 390, 768, 1440]) {
    const clipped = clipTourSection({ x: 20, y: 50, width: width - 40, height: 1000 }, width, 720, 176);
    assert.ok(clipped.y >= 0 && clipped.y + clipped.height <= 720);
    const card = tourPlacement(width, 720, 176, clipped);
    assert.ok(card.top >= clipped.y + clipped.height || card.top + 176 <= clipped.y);
  }
  assert.equal(clipTourSection({ x: 20, y: -500, width: 200, height: 100 }, 320, 720, 176), null);
});

test('the guide does not navigate away from an order form or an unrelated screen', () => {
  assert.equal(canNavigateFromTour('/requester/requestform'), false);
  assert.equal(canNavigateFromTour('/requester/r_request'), true);
  assert.equal(canNavigateFromTour('/requester/r_profile'), true);
});

test('Requester tour targets only existing Requester routes and does not promise recurring schedules', () => {
  assert.equal(TUTORIAL_STEPS.length, 5);
  assert.deepEqual(TUTORIAL_STEPS.map((step) => step.route), ['/requester/r_dashboard', '/requester/r_request', '/requester/r_request', '/requester/r_request', '/requester/r_profile']);
  assert.doesNotMatch(JSON.stringify(TUTORIAL_STEPS), /recurring|calendar/i);
});

test('tour placement keeps a compact card on screen and points toward top and bottom targets', () => {
  for (const width of [320, 390, 768, 1440]) {
    for (const rect of [{ x: width / 2 - 22, y: 70, width: 44, height: 44 }, { x: width / 2 - 22, y: 560, width: 44, height: 44 }]) {
      const card = tourPlacement(width, 640, 176, rect);
      assert.ok(card.left >= 0 && card.left + card.cardWidth <= width);
      assert.ok(card.top >= 0 && card.top + 176 <= 640);
      assert.equal(card.below, rect.y < 100);
      assert.ok(card.arrowLeft >= 0 && card.arrowLeft < card.cardWidth);
    }
    const fallback = tourPlacement(width, 640, 176, null);
    assert.ok(fallback.left >= 0 && fallback.left + fallback.cardWidth <= width);
  }
});
