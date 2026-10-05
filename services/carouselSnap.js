const clampCarouselIndex = (index, count) => {
  const lastIndex = Math.max(0, Number(count || 0) - 1);
  return Math.max(0, Math.min(lastIndex, Math.round(Number(index || 0))));
};

const resolveSettledCarouselIndex = ({ offset = 0, snapInterval = 1, count = 0 }) => {
  const interval = Math.max(1, Number(snapInterval || 1));
  return clampCarouselIndex(Number(offset || 0) / interval, count);
};

const getCarouselIndexFromOffset = (offset = 0, stride = 1, itemCount = 0) =>
  resolveSettledCarouselIndex({ offset, snapInterval: stride, count: itemCount });

const resolveCarouselStepIndex = ({ count = 0, direction = 0, index = 0 }) =>
  clampCarouselIndex(Number(index || 0) + Math.sign(Number(direction || 0)), count);

const isCurrentCarouselOffset = ({ eventOffset = 0, lastOffset = 0, tolerance = 2 }) =>
  Math.abs(Number(eventOffset || 0) - Number(lastOffset || 0)) <= Math.max(0, Number(tolerance || 0));

const resolveDragTargetIndex = ({
  cardWidth = 1,
  count = 0,
  distanceThreshold = 0.23,
  endOffset = 0,
  snapInterval = 1,
  startOffset = 0,
  velocityThreshold = 0.35,
  velocityX = 0,
}) => {
  const startIndex = resolveSettledCarouselIndex({ offset: startOffset, snapInterval, count });
  const distance = Number(endOffset || 0) - Number(startOffset || 0);
  const velocity = Number(velocityX || 0);
  const advances = Math.abs(distance) >= Math.max(1, Number(cardWidth || 1)) * distanceThreshold
    || Math.abs(velocity) >= velocityThreshold;
  if (!advances) return startIndex;
  const direction = Math.sign(distance || velocity);
  return clampCarouselIndex(startIndex + direction, count);
};

module.exports = {
  clampCarouselIndex,
  getCarouselIndexFromOffset,
  isCurrentCarouselOffset,
  resolveCarouselStepIndex,
  resolveDragTargetIndex,
  resolveSettledCarouselIndex,
};
