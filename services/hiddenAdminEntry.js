const DEFAULT_THRESHOLD = 5;
const DEFAULT_WINDOW_MS = 3000;

function createHiddenAdminEntryTracker({
  threshold = DEFAULT_THRESHOLD,
  windowMs = DEFAULT_WINDOW_MS,
  now = () => Date.now(),
  onTrigger = () => {},
} = {}) {
  let count = 0;
  let firstTapAt = 0;

  return {
    tap() {
      const timestamp = now();
      if (!firstTapAt || timestamp - firstTapAt > windowMs) {
        count = 1;
        firstTapAt = timestamp;
      } else {
        count += 1;
      }
      if (count < threshold) return false;
      count = 0;
      firstTapAt = 0;
      onTrigger();
      return true;
    },
    reset() {
      count = 0;
      firstTapAt = 0;
    },
  };
}

module.exports = { DEFAULT_THRESHOLD, DEFAULT_WINDOW_MS, createHiddenAdminEntryTracker };
