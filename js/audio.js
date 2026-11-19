let audioContext = null;
let soundEnabled = true;
const activeGains = new Set();

export function isSoundSupported() {
  return Boolean(window.AudioContext || window.webkitAudioContext);
}

export function isSoundEnabled() {
  return soundEnabled;
}

export function setSoundEnabled(enabled) {
  soundEnabled = Boolean(enabled) && isSoundSupported();
  if (!soundEnabled && audioContext) {
    const now = audioContext.currentTime;
    activeGains.forEach((gain) => {
      gain.gain.cancelScheduledValues(now);
      gain.gain.setValueAtTime(0, now);
    });
  }
  return soundEnabled;
}

function getAudioContext() {
  if (!soundEnabled) return null;
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) return null;
  if (!audioContext) audioContext = new AudioContextConstructor();
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch((error) => {
      console.warn('Unable to resume audio playback.', error);
    });
  }
  return audioContext;
}

function playTone(context, {
  startFrequency,
  endFrequency,
  startDelay = 0,
  duration,
  volume,
  type
}) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const startsAt = context.currentTime + startDelay;
  const endsAt = startsAt + duration;

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(startFrequency, startsAt);
  oscillator.frequency.exponentialRampToValueAtTime(endFrequency, endsAt);
  gain.gain.setValueAtTime(0.0001, startsAt);
  gain.gain.linearRampToValueAtTime(volume, startsAt + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, endsAt);
  oscillator.connect(gain);
  gain.connect(context.destination);
  activeGains.add(gain);
  oscillator.addEventListener('ended', () => activeGains.delete(gain), { once: true });
  oscillator.start(startsAt);
  oscillator.stop(endsAt);
}

export function playSettingsTestSfx() {
  const context = getAudioContext();
  if (!context) return;
  [
    { startFrequency: 520, endFrequency: 780, startDelay: 0 },
    { startFrequency: 780, endFrequency: 1040, startDelay: 0.08 }
  ].forEach((tone) => playTone(context, {
    ...tone,
    duration: 0.16,
    volume: 0.04,
    type: 'sine'
  }));
}

export function playCardSfx() {
  const context = getAudioContext();
  if (!context) return;
  playTone(context, {
    startFrequency: 760,
    endFrequency: 280,
    duration: 0.12,
    volume: 0.045,
    type: 'triangle'
  });
}

export function playJointFinaleSfx() {
  const context = getAudioContext();
  if (!context) return;
  [
    { startFrequency: 440, endFrequency: 660, startDelay: 0 },
    { startFrequency: 554, endFrequency: 831, startDelay: 0.04 },
    { startFrequency: 659, endFrequency: 988, startDelay: 0.08 }
  ].forEach((tone) => playTone(context, {
    ...tone,
    duration: 0.35,
    volume: 0.05,
    type: 'sawtooth'
  }));
}

export function playKaijuRoarSfx() {
  const context = getAudioContext();
  if (!context) return;
  playTone(context, {
    startFrequency: 145,
    endFrequency: 48,
    duration: 0.62,
    volume: 0.07,
    type: 'sawtooth'
  });
}

export function playBossEnrageSfx() {
  const context = getAudioContext();
  if (!context) return;
  playTone(context, {
    startFrequency: 72,
    endFrequency: 42,
    duration: 0.48,
    volume: 0.09,
    type: 'sawtooth'
  });
  playTone(context, {
    startFrequency: 180,
    endFrequency: 55,
    startDelay: 0.08,
    duration: 0.58,
    volume: 0.055,
    type: 'square'
  });
}

export function playDorsalInterruptSfx() {
  const context = getAudioContext();
  if (!context) return;
  [
    { startFrequency: 240, endFrequency: 720, startDelay: 0 },
    { startFrequency: 480, endFrequency: 960, startDelay: 0.07 },
    { startFrequency: 720, endFrequency: 1440, startDelay: 0.14 }
  ].forEach((tone) => playTone(context, {
    ...tone,
    duration: 0.18,
    volume: 0.045,
    type: 'triangle'
  }));
}
