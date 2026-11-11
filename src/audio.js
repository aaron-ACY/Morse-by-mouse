(function (root) {
  'use strict';

  /**
   * Clickless Web Audio CW sidetone helper.
   * Uses a clear triangle wave and adjustable gain so dot/dash/space/delete cues
   * remain crisp and audible across laptop speakers and headphones.
   */
  function createSidetone() {
    let ctx = null;
    let osc = null;
    let gain = null;
    let enabled = true;
    let volume = 0.8; // 0..1 normalized slider scale
    let isPlaying = false;

    function ensureContext() {
      if (ctx) return ctx;
      const AudioCtx = root.AudioContext || root.webkitAudioContext;
      if (!AudioCtx) return null;
      try {
        ctx = new AudioCtx();
      } catch (_err) {
        return null;
      }
      return ctx;
    }

    function computeMainPeak() {
      return Math.max(0.0001, volume * 0.55);
    }

    function computeTickPeak() {
      return Math.max(0.0001, volume * 0.36);
    }

    function setEnabled(value) {
      enabled = Boolean(value);
      if (!enabled) {
        stop();
      }
    }

    function setVolume(nextVolume) {
      const n = Number(nextVolume);
      if (!Number.isFinite(n)) return;
      const normalized = n > 1 ? n / 100 : n;
      volume = Math.min(1, Math.max(0, normalized));
      if (isPlaying && gain && ctx) {
        try {
          gain.gain.setTargetAtTime(computeMainPeak(), ctx.currentTime, 0.01);
        } catch (_err) {}
      }
    }

    function start() {
      if (!enabled || volume <= 0) return;
      const audioCtx = ensureContext();
      if (!audioCtx) return;

      try {
        if (audioCtx.state === 'suspended') {
          audioCtx.resume().catch(() => {});
        }
        stopImmediate();

        const now = audioCtx.currentTime;
        osc = audioCtx.createOscillator();
        gain = audioCtx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(660, now);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.linearRampToValueAtTime(computeMainPeak(), now + 0.004);

        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        isPlaying = true;
      } catch (_err) {
        isPlaying = false;
      }
    }

    function markDash() {
      if (!enabled || !isPlaying || !ctx || !osc) return;
      try {
        osc.frequency.setTargetAtTime(840, ctx.currentTime, 0.012);
      } catch (_err) {
        // Ignore audio scheduling errors on restricted contexts
      }
    }

    function stopImmediate() {
      if (!osc || !gain || !ctx) {
        osc = null;
        gain = null;
        isPlaying = false;
        return;
      }

      const oldOsc = osc;
      const oldGain = gain;
      osc = null;
      gain = null;
      isPlaying = false;

      try {
        const now = ctx.currentTime;
        oldGain.gain.cancelScheduledValues(now);
        oldGain.gain.setValueAtTime(Math.max(oldGain.gain.value, 0.0001), now);
        oldGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.014);
        oldOsc.stop(now + 0.018);
      } catch (_err) {
        try {
          oldOsc.stop();
        } catch (_e2) {}
      }
    }

    function stop() {
      stopImmediate();
    }

    function playShortBeep(freqStart, freqEnd, duration = 0.055, peakGain = computeTickPeak()) {
      if (!enabled || volume <= 0) return;
      const audioCtx = ensureContext();
      if (!audioCtx) return;

      try {
        if (audioCtx.state === 'suspended') {
          audioCtx.resume().catch(() => {});
        }
        const now = audioCtx.currentTime;
        const tickOsc = audioCtx.createOscillator();
        const tickGain = audioCtx.createGain();
        tickOsc.type = 'triangle';
        tickOsc.frequency.setValueAtTime(freqStart, now);
        if (freqEnd !== freqStart) {
          tickOsc.frequency.exponentialRampToValueAtTime(freqEnd, now + duration);
        }
        tickGain.gain.setValueAtTime(0.0001, now);
        tickGain.gain.linearRampToValueAtTime(peakGain, now + 0.004);
        tickGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        tickOsc.connect(tickGain);
        tickGain.connect(audioCtx.destination);
        tickOsc.start(now);
        tickOsc.stop(now + duration + 0.006);
      } catch (_err) {}
    }

    function playDotTick() {
      playShortBeep(660, 660, 0.05, computeMainPeak() * 0.9);
    }

    function playDashTick() {
      playShortBeep(840, 840, 0.11, computeMainPeak() * 0.9);
    }

    function playSpaceTick() {
      playShortBeep(440, 440, 0.05, computeTickPeak());
    }

    function playDeleteTick() {
      playShortBeep(380, 220, 0.06, computeTickPeak());
    }

    return {
      setEnabled,
      setVolume,
      start,
      markDash,
      stop,
      playDotTick,
      playDashTick,
      playSpaceTick,
      playDeleteTick
    };
  }

  root.MorseAudio = { createSidetone };
})(typeof globalThis !== 'undefined' ? globalThis : window);
