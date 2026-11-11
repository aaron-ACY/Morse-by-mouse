(function (root) {
  'use strict';

  const DEFAULT_CONFIG = {
    dashThresholdMs: 200,
    letterGapMs: 600,
    wordGapMs: 1400,
    autoSpace: false,
    letterCase: 'lower',
    maxBufferLength: 12
  };

  /**
   * Pure state machine converting right-button press/release timings into
   * dots (.), dashes (-), decoded characters, commands, and word spaces.
   */
  function createMorseEngine(options = {}) {
    const morseTable = options.morseTable || root.MorseTable;
    if (!morseTable) {
      throw new Error('MorseTable must be loaded before MorseEngine');
    }
    let vietnameseMorse = options.vietnameseMorse || root.VietnameseMorse || null;
    if (!vietnameseMorse && typeof require === 'function') {
      try {
        vietnameseMorse = require('./vietnamese-morse.js');
      } catch (_err) {
        vietnameseMorse = null;
      }
    }

    const VN_STATES = vietnameseMorse
      ? vietnameseMorse.STATES
      : {
          NORMAL: 'NORMAL',
          WAITING_FOR_DIACRITIC: 'WAITING_FOR_DIACRITIC',
          WAITING_FOR_TONE: 'WAITING_FOR_TONE'
        };

    const now = options.now || (() => Date.now());
    const setTimer = options.setTimer || ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = options.clearTimer || ((id) => clearTimeout(id));

    let config = { ...DEFAULT_CONFIG, ...(options.config || {}) };
    const callbacks = {
      onPressStart: options.onPressStart || (() => {}),
      onThresholdCrossed: options.onThresholdCrossed || (() => {}),
      onSignalAdded: options.onSignalAdded || (() => {}),
      onCommit: options.onCommit || (() => {}),
      onReplaceChar: options.onReplaceChar || (() => {}),
      onWordSpace: options.onWordSpace || (() => {}),
      onDeleteSignal: options.onDeleteSignal || (() => {}),
      onDeleteChar: options.onDeleteChar || (() => {}),
      onError: options.onError || (() => {}),
      onStateChange: options.onStateChange || (() => {})
    };

    let isPressing = false;
    let pressStartTime = 0;
    let currentHoldSymbol = null;
    let buffer = '';
    let lastSignalTime = 0;
    let letterDeadline = 0;
    let wordDeadline = 0;
    let vnState = VN_STATES.NORMAL;
    let lastCommittedChar = null;
    let statusNotice = null;
    let statusNoticeType = 'info';

    let holdTimerId = null;
    let letterTimerId = null;
    let wordTimerId = null;

    function clearHoldTimer() {
      if (holdTimerId !== null) {
        clearTimer(holdTimerId);
        holdTimerId = null;
      }
    }

    function clearGapTimers() {
      if (letterTimerId !== null) {
        clearTimer(letterTimerId);
        letterTimerId = null;
      }
      if (wordTimerId !== null) {
        clearTimer(wordTimerId);
        wordTimerId = null;
      }
      letterDeadline = 0;
      wordDeadline = 0;
    }

    function getSnapshot() {
      return {
        isPressing,
        pressStartTime,
        currentHoldSymbol,
        buffer,
        lastSignalTime,
        letterDeadline,
        wordDeadline,
        vnState,
        activeChar: lastCommittedChar,
        statusNotice,
        statusNoticeType,
        config: { ...config }
      };
    }

    function emitState() {
      callbacks.onStateChange(getSnapshot());
    }

    function updateConfig(partial) {
      config = { ...config, ...partial };
      emitState();
    }

    function clearTransientNotice() {
      if (vnState === VN_STATES.NORMAL) {
        statusNotice = null;
        statusNoticeType = 'info';
      } else if (statusNoticeType === 'error' && vietnameseMorse) {
        statusNotice =
          vnState === VN_STATES.WAITING_FOR_DIACRITIC
            ? vietnameseMorse.ESCAPE_NOTICE
            : vietnameseMorse.STATE_META.WAITING_FOR_TONE.desc;
        statusNoticeType = 'info';
      }
    }

    function scheduleAutoSpace() {
      if (!config.autoSpace) return;
      const remainingWordDelay = Math.max(100, config.wordGapMs - config.letterGapMs);
      wordDeadline = now() + remainingWordDelay;
      wordTimerId = setTimer(() => {
        wordTimerId = null;
        wordDeadline = 0;
        lastCommittedChar = null;
        callbacks.onWordSpace();
        emitState();
      }, remainingWordDelay);
    }

    function pressStart() {
      if (isPressing) return false;

      clearGapTimers();
      clearHoldTimer();
      clearTransientNotice();

      isPressing = true;
      pressStartTime = now();
      currentHoldSymbol = '.';

      holdTimerId = setTimer(() => {
        holdTimerId = null;
        if (!isPressing) return;
        currentHoldSymbol = '-';
        callbacks.onThresholdCrossed();
        emitState();
      }, config.dashThresholdMs);

      callbacks.onPressStart();
      emitState();
      return true;
    }

    function commitBufferInternal(commitOptions = {}) {
      letterTimerId = null;
      letterDeadline = 0;

      if (!buffer) {
        if (!commitOptions.silentEmpty) {
          emitState();
        }
        return null;
      }

      const code = buffer;
      buffer = '';

      if (vnState !== VN_STATES.NORMAL && vietnameseMorse) {
        const applied = vietnameseMorse.applyVietnameseCode(lastCommittedChar, code, vnState);
        if (applied.ok) {
          lastCommittedChar = applied.char;
          vnState = VN_STATES.NORMAL;
          statusNotice = null;
          statusNoticeType = 'info';
          callbacks.onReplaceChar(applied.char, applied);
          if (!commitOptions.skipAutoSpace) {
            scheduleAutoSpace();
          }
          emitState();
          return applied;
        }

        statusNotice = applied.message;
        statusNoticeType = 'error';
        callbacks.onError(applied);
        emitState();
        return applied;
      }

      const result = morseTable.decodeMorse(code, { letterCase: config.letterCase });
      if (result.kind === 'char') {
        lastCommittedChar = result.char.normalize('NFC');
        statusNotice = null;
        statusNoticeType = 'info';
      } else {
        if (result.kind === 'command') {
          lastCommittedChar = null;
        }
        statusNotice = null;
        statusNoticeType = 'info';
      }

      callbacks.onCommit(result);

      if (!commitOptions.skipAutoSpace && result.kind === 'char') {
        scheduleAutoSpace();
      }

      emitState();
      return result;
    }

    function commitBuffer() {
      return commitBufferInternal();
    }

    function appendSignal(symbol, timestamp) {
      lastSignalTime = timestamp;
      clearTransientNotice();

      if (buffer.length < config.maxBufferLength) {
        buffer += symbol;
      }

      callbacks.onSignalAdded(symbol, buffer);

      clearGapTimers();
      letterDeadline = timestamp + config.letterGapMs;
      letterTimerId = setTimer(commitBuffer, config.letterGapMs);

      emitState();
      return symbol;
    }

    function pushSignal(symbol) {
      if (symbol !== '.' && symbol !== '-') return null;
      return appendSignal(symbol, now());
    }

    function pressEnd() {
      if (!isPressing) return null;

      clearHoldTimer();
      const endTime = now();
      const duration = Math.max(0, endTime - pressStartTime);
      const symbol = duration >= config.dashThresholdMs ? '-' : '.';

      isPressing = false;
      pressStartTime = 0;
      currentHoldSymbol = null;

      return appendSignal(symbol, endTime);
    }

    function cancelPress() {
      if (!isPressing) return;
      clearHoldTimer();
      isPressing = false;
      pressStartTime = 0;
      currentHoldSymbol = null;
      emitState();
    }

    function triggerEscape(fallbackChar) {
      if (isPressing) {
        return { ok: false, reason: 'pressing' };
      }

      clearGapTimers();

      if (!vietnameseMorse) {
        return { ok: false, reason: 'unavailable' };
      }

      if (vnState !== VN_STATES.NORMAL) {
        buffer = '';
        vnState = VN_STATES.NORMAL;
        statusNotice = null;
        statusNoticeType = 'info';
        emitState();
        return { ok: true, action: 'cancelled', state: vnState };
      }

      if (buffer) {
        commitBufferInternal({ skipAutoSpace: true, silentEmpty: true });
      }

      const targetChar =
        fallbackChar !== undefined
          ? fallbackChar
            ? String(fallbackChar).normalize('NFC')
            : null
          : lastCommittedChar;

      const check = vietnameseMorse.canEnterDiacriticMode(targetChar);
      if (!check.allowed) {
        statusNotice = check.reason;
        statusNoticeType = 'error';
        const err = { ok: false, errorCode: 'cannot_enter_diacritic', message: check.reason };
        callbacks.onError(err);
        emitState();
        return { ...err, state: vnState };
      }

      lastCommittedChar = targetChar;
      vnState = check.nextState;
      statusNotice =
        vnState === VN_STATES.WAITING_FOR_DIACRITIC
          ? vietnameseMorse.ESCAPE_NOTICE
          : vietnameseMorse.STATE_META.WAITING_FOR_TONE.desc;
      statusNoticeType = 'info';
      emitState();
      return { ok: true, action: 'entered', state: vnState, notice: statusNotice };
    }

    function clearVietnameseContext() {
      if (
        vnState === VN_STATES.NORMAL &&
        lastCommittedChar === null &&
        statusNotice === null
      ) {
        return;
      }
      if (vnState !== VN_STATES.NORMAL && buffer) {
        buffer = '';
        clearGapTimers();
      }
      vnState = VN_STATES.NORMAL;
      lastCommittedChar = null;
      statusNotice = null;
      statusNoticeType = 'info';
      emitState();
    }

    function triggerSpace() {
      if (isPressing) return false;
      clearGapTimers();

      if (buffer) {
        commitBufferInternal({ skipAutoSpace: true, silentEmpty: true });
      }

      vnState = VN_STATES.NORMAL;
      lastCommittedChar = null;
      statusNotice = null;
      statusNoticeType = 'info';
      callbacks.onWordSpace();
      emitState();
      return true;
    }

    function triggerDelete() {
      if (isPressing) return null;
      clearGapTimers();

      if (buffer.length > 0) {
        buffer = buffer.slice(0, -1);
        clearTransientNotice();
        if (buffer.length > 0) {
          letterDeadline = now() + config.letterGapMs;
          letterTimerId = setTimer(commitBuffer, config.letterGapMs);
        }
        callbacks.onDeleteSignal(buffer);
        emitState();
        return 'signal';
      }

      vnState = VN_STATES.NORMAL;
      lastCommittedChar = null;
      statusNotice = null;
      statusNoticeType = 'info';
      callbacks.onDeleteChar();
      emitState();
      return 'char';
    }

    function reset() {
      clearHoldTimer();
      clearGapTimers();
      isPressing = false;
      pressStartTime = 0;
      currentHoldSymbol = null;
      buffer = '';
      lastSignalTime = 0;
      vnState = VN_STATES.NORMAL;
      lastCommittedChar = null;
      statusNotice = null;
      statusNoticeType = 'info';
      emitState();
    }

    return {
      pressStart,
      pressEnd,
      pushSignal,
      cancelPress,
      triggerEscape,
      clearVietnameseContext,
      triggerSpace,
      triggerDelete,
      reset,
      updateConfig,
      getSnapshot
    };
  }

  const api = {
    DEFAULT_CONFIG,
    createMorseEngine
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.MorseEngine = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

