const assert = require('node:assert/strict');
const test = require('node:test');

const {
  clampCarouselIndex,
  getCarouselIndexFromOffset,
  isCurrentCarouselOffset,
  resolveCarouselStepIndex,
  resolveDragTargetIndex,
  resolveSettledCarouselIndex,
} = require('../../../services/carouselSnap');

test('carousel advances at the 23 percent threshold and snaps back below it', () => {
  const base = { cardWidth: 400, count: 4, snapInterval: 412, startOffset: 412, velocityX: 0 };
  assert.equal(resolveDragTargetIndex({ ...base, endOffset: 412 + 91 }), 1);
  assert.equal(resolveDragTargetIndex({ ...base, endOffset: 412 + 92 }), 2);
  assert.equal(resolveDragTargetIndex({ ...base, endOffset: 412 - 92 }), 0);
  assert.equal(resolveDragTargetIndex({ ...base, startOffset: 0, endOffset: 91 }), 0);
  assert.equal(resolveDragTargetIndex({ ...base, startOffset: 0, endOffset: 92 }), 1);
});

test('carousel honors a short velocity flick and clamps both edges', () => {
  const base = { cardWidth: 400, count: 3, snapInterval: 412, velocityX: 0.36 };
  assert.equal(resolveDragTargetIndex({ ...base, startOffset: 0, endOffset: 8 }), 1);
  assert.equal(resolveDragTargetIndex({ ...base, startOffset: 412, endOffset: 404, velocityX: -0.36 }), 0);
  assert.equal(resolveDragTargetIndex({ ...base, startOffset: 824, endOffset: 840 }), 2);
  assert.equal(clampCarouselIndex(-2, 3), 0);
  assert.equal(clampCarouselIndex(8, 3), 2);
});

test('final settled offset is authoritative for the active carousel index', () => {
  assert.equal(resolveSettledCarouselIndex({ offset: 618, snapInterval: 412, count: 4 }), 2);
  assert.equal(resolveSettledCarouselIndex({ offset: 380, snapInterval: 412, count: 4 }), 1);
});

test('arrow steps move exactly one card and clamp at carousel bounds', () => {
  assert.equal(resolveCarouselStepIndex({ count: 2, direction: 1, index: 0 }), 1);
  assert.equal(resolveCarouselStepIndex({ count: 2, direction: -1, index: 1 }), 0);
  assert.equal(resolveCarouselStepIndex({ count: 2, direction: -1, index: 0 }), 0);
  assert.equal(resolveCarouselStepIndex({ count: 2, direction: 1, index: 1 }), 1);
});

test('real slide stride converts settled offsets to forward and reverse indexes', () => {
  const stride = 412;
  assert.equal(getCarouselIndexFromOffset(0, stride, 2), 0);
  assert.equal(getCarouselIndexFromOffset(stride, stride, 2), 1);
  assert.equal(resolveDragTargetIndex({
    cardWidth: 400,
    count: 2,
    endOffset: 390,
    snapInterval: stride,
    startOffset: 0,
  }), 1);
  assert.equal(resolveDragTargetIndex({
    cardWidth: 400,
    count: 2,
    endOffset: 18,
    snapInterval: stride,
    startOffset: stride,
  }), 0);
});

test('repeated swipe-only settlement stays synchronized in both directions', () => {
  const stride = 412;
  const offsets = [0, stride, 0, stride, 0];
  assert.deepEqual(offsets.map((offset) => getCarouselIndexFromOffset(offset, stride, 2)), [0, 1, 0, 1, 0]);
});

test('stale momentum offsets cannot overwrite the latest carousel interaction', () => {
  assert.equal(isCurrentCarouselOffset({ eventOffset: 412, lastOffset: 0 }), false);
  assert.equal(isCurrentCarouselOffset({ eventOffset: 1.5, lastOffset: 0 }), true);
  assert.equal(resolveSettledCarouselIndex({ offset: 0, snapInterval: 412, count: 4 }), 0);
});
