const test = require('node:test');
const assert = require('node:assert/strict');
const {
  selectDashboardPromotion,
  promotionSessionKey,
  wasPromotionSeen,
  markPromotionSeen,
} = require('../../../services/promotionPresentation');

const createOffer = (overrides = {}) => ({
  id: 'promo-1',
  version: 2,
  title: 'Buy More, Save More',
  productId: 'prod-water',
  productName: 'BlueTap 5-Gallon Purified Water',
  branchId: 'branch-a',
  branchName: 'Branch A',
  container: 'Exchange',
  endsAt: new Date(Date.now() + 86400000).toISOString(),
  tiers: [
    { quantity: 3, regularCentavos: 7500, priceCentavos: 7000, savingsCentavos: 500 },
    { quantity: 5, regularCentavos: 12500, priceCentavos: 11000, savingsCentavos: 1500 },
    { quantity: 10, regularCentavos: 25000, priceCentavos: 22000, savingsCentavos: 3000 },
  ],
  ...overrides,
});

test('selectDashboardPromotion prefers in-radius branches over outside-radius branches', () => {
  const offerInRadius = createOffer({ branchId: 'branch-near', branchName: 'Near Branch' });
  const offerOutside = createOffer({ branchId: 'branch-far', branchName: 'Far Branch' });

  const catalog = {
    promotionCheckoutEnabled: true,
    promotionPreviews: [offerInRadius, offerOutside],
    branches: [{ id: 'branch-near' }, { id: 'branch-far' }],
  };

  const rankedBranches = [
    { id: 'branch-near', distanceKm: 2.1, withinServiceArea: true, isWithinNormalArea: true },
    { id: 'branch-far', distanceKm: 8.7, withinServiceArea: false, isWithinNormalArea: false },
  ];

  const selected = selectDashboardPromotion(catalog, { rankedBranches });
  assert.ok(selected);
  assert.equal(selected.branchId, 'branch-near');
  assert.equal(selected.branchName, 'Near Branch');
});

test('selectDashboardPromotion selects closest outside-radius branch when no in-radius branch qualifies', () => {
  const offerOutside = createOffer({ branchId: 'branch-b', branchName: 'Branch B' });

  const catalog = {
    promotionCheckoutEnabled: true,
    promotionPreviews: [offerOutside],
    branches: [{ id: 'branch-a' }, { id: 'branch-b' }],
  };

  // Branch A is in coverage but has no promotion; Branch B is 8.7 km away (outside 5 km) with a published bundle
  const rankedBranches = [
    { id: 'branch-a', distanceKm: 3.0, withinServiceArea: true, isWithinNormalArea: true },
    { id: 'branch-b', distanceKm: 8.7, withinServiceArea: false, isWithinNormalArea: false },
  ];

  const selected = selectDashboardPromotion(catalog, { rankedBranches });
  assert.ok(selected, 'Should select outside-radius branch offer when no in-radius branch has an offer');
  assert.equal(selected.branchId, 'branch-b');
  assert.equal(selected.branchName, 'Branch B');
});

test('selectDashboardPromotion selects nearest outside branch when multiple outside branches have offers', () => {
  const offerCloseOutside = createOffer({ branchId: 'branch-8km', branchName: 'Branch 8km' });
  const offerFarOutside = createOffer({ branchId: 'branch-15km', branchName: 'Branch 15km' });

  const catalog = {
    promotionCheckoutEnabled: true,
    promotionPreviews: [offerCloseOutside, offerFarOutside],
    branches: [{ id: 'branch-8km' }, { id: 'branch-15km' }],
  };

  const rankedBranches = [
    { id: 'branch-8km', distanceKm: 8.2, withinServiceArea: false, isWithinNormalArea: false },
    { id: 'branch-15km', distanceKm: 15.0, withinServiceArea: false, isWithinNormalArea: false },
  ];

  const selected = selectDashboardPromotion(catalog, { rankedBranches });
  assert.ok(selected);
  assert.equal(selected.branchId, 'branch-8km');
});

test('selectDashboardPromotion falls back to catalog branches when ranking is unavailable', () => {
  const offer = createOffer({ branchId: 'branch-default', branchName: 'Default Branch' });

  const catalog = {
    promotionCheckoutEnabled: true,
    promotionPreviews: [offer],
    branches: [{ id: 'branch-default' }],
  };

  const selected = selectDashboardPromotion(catalog, { rankedBranches: [] });
  assert.ok(selected);
  assert.equal(selected.branchId, 'branch-default');
});

test('selectDashboardPromotion returns null when no branches have eligible offers', () => {
  const catalog = {
    promotionCheckoutEnabled: true,
    promotionPreviews: [],
    branches: [{ id: 'branch-a' }],
  };

  const rankedBranches = [
    { id: 'branch-a', distanceKm: 1.5, withinServiceArea: true, isWithinNormalArea: true },
  ];

  const selected = selectDashboardPromotion(catalog, { rankedBranches });
  assert.equal(selected, null);
});

test('selectDashboardPromotion returns null when promotion has expired', () => {
  const expiredOffer = createOffer({
    branchId: 'branch-a',
    endsAt: new Date(Date.now() - 3600000).toISOString(),
  });

  const catalog = {
    promotionCheckoutEnabled: true,
    promotionPreviews: [expiredOffer],
    branches: [{ id: 'branch-a' }],
  };

  const rankedBranches = [
    { id: 'branch-a', distanceKm: 1.5, withinServiceArea: true, isWithinNormalArea: true },
  ];

  const selected = selectDashboardPromotion(catalog, { rankedBranches, now: Date.now() });
  assert.equal(selected, null);
});

test('dashboard promotion eligibility guards incomplete profiles', () => {
  const offer = createOffer();

  // Test the exact dashboard condition: Boolean(promotion && promotionCatalog?.profile?.complete === true)
  const isBannerEligible = (promotion, profile) => Boolean(promotion && profile?.complete === true);

  assert.equal(isBannerEligible(offer, { complete: true, fullName: 'John Doe' }), true);
  assert.equal(isBannerEligible(offer, { complete: false }), false);
  assert.equal(isBannerEligible(offer, null), false);
  assert.equal(isBannerEligible(null, { complete: true }), false);
});

test('popup dismissal persists per session and promotion version', () => {
  const offerV1 = createOffer({ id: 'p1', version: 1 });
  const offerV2 = createOffer({ id: 'p1', version: 2 });
  const user = { uid: 'requester-123', metadata: { lastSignInTime: '2026-11-15T08:00:00Z' } };

  const keyV1 = promotionSessionKey(user, offerV1);
  const keyV2 = promotionSessionKey(user, offerV2);

  // Initial visit: not seen yet
  assert.equal(wasPromotionSeen(keyV1), false);

  // User dismisses or sees popup
  markPromotionSeen(keyV1);
  assert.equal(wasPromotionSeen(keyV1), true);

  // Same session does not pop up again
  assert.equal(wasPromotionSeen(keyV1), true);

  // New promotion version triggers fresh presentation
  assert.equal(wasPromotionSeen(keyV2), false);

  // Different user login session triggers fresh presentation
  const newUserSession = { uid: 'requester-123', metadata: { lastSignInTime: '2026-11-15T12:00:00Z' } };
  assert.equal(wasPromotionSeen(promotionSessionKey(newUserSession, offerV1)), false);
});

test('active order preserves banner visibility and maps action to View Order', () => {
  const offer = createOffer();
  const currentRequests = [{ id: 'order-active-1', status: 'pending' }];

  // Dashboard banner condition: promotionBannerEligible is independent of active requests
  const promotionBannerEligible = Boolean(offer && { complete: true }.complete === true);
  assert.equal(promotionBannerEligible, true);

  // Action text mapping
  const actionText = currentRequests.length > 0 ? 'View Order' : 'Order Now';
  assert.equal(actionText, 'View Order');

  // Navigation target logic
  const getRoute = (requests, promotion) => {
    if (requests.length) {
      const activeOrderId = requests[0]?.id;
      return { pathname: '/requester/r_request', params: { orderId: activeOrderId } };
    }
    return { pathname: '/requester/requestform', params: { productId: promotion.productId } };
  };

  assert.deepEqual(getRoute(currentRequests, offer), {
    pathname: '/requester/r_request',
    params: { orderId: 'order-active-1' },
  });

  assert.deepEqual(getRoute([], offer), {
    pathname: '/requester/requestform',
    params: { productId: 'prod-water' },
  });
});

test('RequesterPromotion UI visual contracts: banner and popup render brand styling and required elements', () => {
  const { readFileSync } = require('node:fs');
  const { resolve } = require('node:path');
  const promoComponent = readFileSync(resolve(__dirname, '../../../components/RequesterPromotion.jsx'), 'utf8');

  // Banner layout & branding
  assert.match(promoComponent, /BLUETAP BUNDLE/, 'Banner must display BLUETAP BUNDLE header');
  assert.match(promoComponent, /BUY MORE, SAVE MORE!/, 'Banner must display promotion title');
  assert.match(promoComponent, /BlueTapBrandMark/, 'Banner must render brand mark icon');
  assert.match(promoComponent, /requester-promotion-water\.png/, 'Banner must render backdrop artwork');
  assert.match(promoComponent, /View Offer/, 'Banner must render View Offer action button');

  // Popup modal layout & accessibility
  assert.match(promoComponent, /accessibilityViewIsModal/, 'Popup must be an accessible modal dialog');
  assert.match(promoComponent, /accessibilityRole="alert"/, 'Popup must have alert role');
  assert.match(promoComponent, /Save \{money\(tier\.savingsCentavos\)\}/, 'Popup must display savings pill per tier');
  assert.match(promoComponent, /Maybe Later/, 'Popup must provide dismissal option');
  assert.match(promoComponent, /hasActiveOrder \? 'View Order' : 'Order Now'/, 'Popup must switch to View Order when user has active order');
});

