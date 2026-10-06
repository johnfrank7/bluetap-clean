const SOUND_COOLDOWN_MS = Object.freeze({ admin: 700, theme: 120, chat: 400 });
const lastPlayedAt = { admin: 0, theme: 0, chat: 0 };
let sharedAudioContext = null;

const getWebAudioContext = () => {
  if (typeof window === 'undefined') return null;
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    sharedAudioContext = new AudioContext();
  }
  return sharedAudioContext;
};

const canPlay = (kind) => {
  const now = Date.now();
  if (now - lastPlayedAt[kind] < SOUND_COOLDOWN_MS[kind]) return false;
  lastPlayedAt[kind] = now;
  return true;
};

const playTone = (context, { frequency, endFrequency, startAt, duration, gain = 0.035, type = 'sine' }) => {
  const oscillator = context.createOscillator();
  const volume = context.createGain();
  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, startAt + duration);
  volume.gain.setValueAtTime(0.0001, startAt);
  volume.gain.exponentialRampToValueAtTime(gain, startAt + 0.012);
  volume.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
  oscillator.connect(volume);
  volume.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + duration + 0.015);
};

const safelyPlay = (kind, composer) => {
  try {
    if (!canPlay(kind)) return false;
    const context = getWebAudioContext();
    if (!context) return false;
    if (context.state === 'suspended') context.resume().catch(() => {});
    composer(context, context.currentTime + 0.006);
    return true;
  } catch {
    return false;
  }
};

const playThemeDropSound = () => safelyPlay('theme', (context, startAt) => {
  playTone(context, { frequency: 760, endFrequency: 360, startAt, duration: 0.13, gain: 0.028 });
  playTone(context, { frequency: 420, endFrequency: 210, startAt: startAt + 0.035, duration: 0.16, gain: 0.018 });
});

const playAdminEntrySound = () => safelyPlay('admin', (context, startAt) => {
  playTone(context, { frequency: 260, endFrequency: 520, startAt, duration: 0.2, gain: 0.026, type: 'triangle' });
  playTone(context, { frequency: 390, endFrequency: 780, startAt: startAt + 0.075, duration: 0.22, gain: 0.022, type: 'sine' });
});

const playIncomingMessageSound = ({ subtle = false } = {}) => safelyPlay('chat', (context, startAt) => {
  const gainMultiplier = subtle ? 0.5 : 1.0;
  playTone(context, { frequency: 1046, endFrequency: 1046, startAt, duration: 0.22, gain: 0.065 * gainMultiplier, type: 'sine' });
  playTone(context, { frequency: 1318, endFrequency: 1318, startAt: startAt + 0.035, duration: 0.26, gain: 0.075 * gainMultiplier, type: 'sine' });
  playTone(context, { frequency: 2093, endFrequency: 2093, startAt: startAt + 0.045, duration: 0.18, gain: 0.032 * gainMultiplier, type: 'sine' });
});

const playNotificationSound = ({ subtle = false } = {}) => safelyPlay('chat', (context, startAt) => {
  const gainMultiplier = subtle ? 0.5 : 1.0;
  playTone(context, { frequency: 1318, endFrequency: 1318, startAt, duration: 0.18, gain: 0.068 * gainMultiplier, type: 'sine' });
  playTone(context, { frequency: 1760, endFrequency: 1760, startAt: startAt + 0.05, duration: 0.25, gain: 0.078 * gainMultiplier, type: 'sine' });
});

module.exports = { playAdminEntrySound, playIncomingMessageSound, playNotificationSound, playThemeDropSound };
