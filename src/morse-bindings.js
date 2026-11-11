(function (root) {
  'use strict';

  const ACTION_IDS = ['dot', 'dash', 'space', 'delete', 'diacritic'];

  const ACTION_META = {
    dot: { id: 'dot', name: 'Dot (·)', desc: 'Tín hiệu chấm', short: '·' },
    dash: { id: 'dash', name: 'Dash (—)', desc: 'Tín hiệu gạch', short: '—' },
    space: { id: 'space', name: 'Space (Cách)', desc: 'Chèn 1 dấu cách', short: 'Cách' },
    delete: { id: 'delete', name: 'Xóa (Backspace)', desc: 'Xóa tín hiệu / ký tự', short: 'Xóa' },
    diacritic: { id: 'diacritic', name: 'Dấu Việt (ESC)', desc: 'Bật/tắt chế độ dấu', short: 'DấuTV' }
  };

  const DEFAULT_BINDINGS = {
    dot: { button: 2, mode: 'tap' },
    dash: { button: 2, mode: 'hold' },
    space: { button: 0, mode: 'tap' },
    delete: { button: 1, mode: 'tap' },
    diacritic: null
  };

  function cloneDefaultBindings() {
    return {
      dot: { ...DEFAULT_BINDINGS.dot },
      dash: { ...DEFAULT_BINDINGS.dash },
      space: { ...DEFAULT_BINDINGS.space },
      delete: { ...DEFAULT_BINDINGS.delete },
      diacritic: null
    };
  }

  function getMouseButtonName(button) {
    switch (button) {
      case 0:
        return 'Chuột trái';
      case 1:
        return 'Con lăn giữa';
      case 2:
        return 'Chuột phải';
      case 3:
        return 'Mouse 4 (Back)';
      case 4:
        return 'Mouse 5 (Fwd)';
      default:
        return `Nút #${button}`;
    }
  }

  function getMouseButtonShortName(button) {
    switch (button) {
      case 0:
        return 'Trái';
      case 1:
        return 'Giữa';
      case 2:
        return 'Phải';
      case 3:
        return 'M4';
      case 4:
        return 'M5';
      default:
        return `#${button}`;
    }
  }

  function formatBindingLabel(binding) {
    if (!binding) return 'Chưa gán';
    const modeLabel = binding.mode === 'hold' ? 'Nhấn giữ' : 'Nhấn';
    return `${getMouseButtonName(binding.button)} • ${modeLabel}`;
  }

  function isValidBinding(binding) {
    return (
      Boolean(binding) &&
      typeof binding === 'object' &&
      Number.isInteger(binding.button) &&
      binding.button >= 0 &&
      (binding.mode === 'tap' || binding.mode === 'hold')
    );
  }

  function normalizeBindings(raw) {
    const base = cloneDefaultBindings();
    if (!raw || typeof raw !== 'object') return base;
    for (const id of ACTION_IDS) {
      if (raw[id] === null) {
        base[id] = null;
      } else if (isValidBinding(raw[id])) {
        base[id] = { button: raw[id].button, mode: raw[id].mode };
      }
    }
    return base;
  }

  function assignBinding(bindings, actionId, nextBinding) {
    const next = normalizeBindings(bindings);
    let replacedAction = null;

    if (nextBinding && isValidBinding(nextBinding)) {
      for (const otherId of ACTION_IDS) {
        if (otherId === actionId) continue;
        const cur = next[otherId];
        if (cur && cur.button === nextBinding.button && cur.mode === nextBinding.mode) {
          next[otherId] = null;
          replacedAction = otherId;
        }
      }
      next[actionId] = { button: nextBinding.button, mode: nextBinding.mode };
    } else {
      next[actionId] = null;
    }

    return { bindings: next, replacedAction };
  }

  function getButtonHandlers(bindings, button) {
    let tap = null;
    let hold = null;
    for (const id of ACTION_IDS) {
      const b = bindings[id];
      if (!b || b.button !== button) continue;
      if (b.mode === 'tap') tap = id;
      if (b.mode === 'hold') hold = id;
    }
    return { tap, hold };
  }

  function migrateLegacySettingsToBindings(stored) {
    const next = cloneDefaultBindings();
    if (!stored || typeof stored !== 'object') return next;
    if (stored.bindings) return normalizeBindings(stored.bindings);

    if (stored.leftClickSpace === false) {
      next.space = null;
    }

    switch (stored.deleteMacro) {
      case 'middle':
        next.delete = { button: 1, mode: 'tap' };
        break;
      case 'side-back':
        next.delete = { button: 3, mode: 'tap' };
        break;
      case 'side-forward':
        next.delete = { button: 4, mode: 'tap' };
        break;
      case 'left-hold':
        next.delete = { button: 0, mode: 'hold' };
        break;
      case 'custom': {
        const customBtn = Number(stored.deleteCustomButton);
        next.delete =
          Number.isInteger(customBtn) && customBtn >= 0
            ? { button: customBtn, mode: 'tap' }
            : null;
        break;
      }
      case 'none':
        next.delete = null;
        break;
      default:
        break;
    }

    return next;
  }

  function formatFooterSummary(bindings) {
    const parts = [];
    for (const id of ACTION_IDS) {
      const b = bindings[id];
      if (!b) continue;
      const btn = getMouseButtonShortName(b.button);
      const mode = b.mode === 'hold' ? 'Giữ' : 'Nhấn';
      parts.push(`${btn}(${mode})=${ACTION_META[id].short}`);
    }
    parts.push('Shift+Click=Thường');
    return parts.join(' | ');
  }

  /**
   * Unified mouse button dispatcher supporting tap & hold bindings
   * for dot, dash, space, and delete across any physical mouse buttons.
   */
  function createMouseActionController(options) {
    const {
      engine,
      sidetone,
      getBindings,
      getThresholdMs,
      onTriggerDiacritic = null,
      onActionFeedback = () => {}
    } = options;

    let active = null; // { button, kind, tap, hold, didHold, holdTimer, repeatDelay, repeatInterval }

    function clearTimers() {
      if (!active) return;
      if (active.holdTimer !== null) clearTimeout(active.holdTimer);
      if (active.repeatDelay !== null) clearTimeout(active.repeatDelay);
      if (active.repeatInterval !== null) clearInterval(active.repeatInterval);
    }

    function runInstantAction(actionId) {
      if (actionId === 'diacritic') {
        const res = onTriggerDiacritic
          ? onTriggerDiacritic()
          : typeof engine.triggerEscape === 'function'
          ? engine.triggerEscape()
          : null;
        if (typeof sidetone.playDotTick === 'function') {
          sidetone.playDotTick();
        }
        onActionFeedback('diacritic', res);
        return;
      }
      if (actionId === 'space') {
        if (engine.triggerSpace()) {
          sidetone.playSpaceTick();
          onActionFeedback('space');
        }
        return;
      }
      if (actionId === 'delete') {
        const res = engine.triggerDelete();
        if (res) {
          sidetone.playDeleteTick();
          onActionFeedback('delete', res);
        }
        return;
      }
      if (actionId === 'dot' || actionId === 'dash') {
        const sym = engine.pushSignal(actionId === 'dot' ? '.' : '-');
        if (sym) {
          if (actionId === 'dot' && typeof sidetone.playDotTick === 'function') {
            sidetone.playDotTick();
          } else if (actionId === 'dash' && typeof sidetone.playDashTick === 'function') {
            sidetone.playDashTick();
          }
          onActionFeedback(actionId);
        }
      }
    }

    function startDeleteRepeat(stateObj) {
      stateObj.repeatDelay = setTimeout(() => {
        if (active !== stateObj) return;
        stateObj.repeatDelay = null;
        stateObj.repeatInterval = setInterval(() => {
          if (active !== stateObj) return;
          runInstantAction('delete');
        }, 85);
      }, 420);
    }

    function handleMouseDown(button) {
      if (active) return false;
      const { tap, hold } = getButtonHandlers(getBindings(), button);
      if (!tap && !hold) return false;

      // Classic single-button Morse keyer (e.g. Right Click tap=dot, hold=dash)
      if (tap === 'dot' && hold === 'dash') {
        active = {
          button,
          kind: 'morse-keyer',
          holdTimer: null,
          repeatDelay: null,
          repeatInterval: null
        };
        engine.pressStart();
        return true;
      }

      const stateObj = {
        button,
        kind: 'generic',
        tap,
        hold,
        didHold: false,
        holdTimer: null,
        repeatDelay: null,
        repeatInterval: null
      };
      active = stateObj;

      if (!hold) {
        if (tap === 'delete') {
          runInstantAction('delete');
          startDeleteRepeat(stateObj);
        } else if (tap === 'dot' || tap === 'dash') {
          sidetone.start();
          if (tap === 'dash') sidetone.markDash();
          runInstantAction(tap);
        }
        // Single-shot 'space' and 'diacritic' wait for mouseup so simultaneous
        // Left+Right chord detection can cancel them cleanly before emission.
        return true;
      }

      // Button has a hold binding (and optionally a tap binding)
      if (tap === 'dot' || tap === 'dash' || hold === 'dot' || hold === 'dash') {
        sidetone.start();
        if (tap === 'dash') sidetone.markDash();
      }

      const threshold = Math.max(100, Number(getThresholdMs()) || 200);
      stateObj.holdTimer = setTimeout(() => {
        if (active !== stateObj) return;
        stateObj.holdTimer = null;
        stateObj.didHold = true;

        if (hold === 'delete') {
          sidetone.stop();
          runInstantAction('delete');
          startDeleteRepeat(stateObj);
        } else if (hold === 'space' || hold === 'diacritic') {
          sidetone.stop();
          runInstantAction(hold);
        } else if (hold === 'dash') {
          sidetone.markDash();
        }
      }, threshold);

      return true;
    }

    function handleMouseUp(button) {
      if (!active || active.button !== button) return false;
      const cur = active;
      clearTimers();
      active = null;

      if (cur.kind === 'morse-keyer') {
        engine.pressEnd();
        return true;
      }

      sidetone.stop();

      if (!cur.hold) {
        if (cur.tap === 'space' || cur.tap === 'diacritic') {
          runInstantAction(cur.tap);
        }
        return true;
      }

      if (cur.didHold) {
        if (cur.hold === 'dot' || cur.hold === 'dash') {
          runInstantAction(cur.hold);
        }
      } else if (cur.tap) {
        runInstantAction(cur.tap);
      }
      return true;
    }

    function cancel() {
      if (!active) return;
      const wasKeyer = active.kind === 'morse-keyer';
      clearTimers();
      active = null;
      if (wasKeyer) {
        engine.cancelPress();
      }
      sidetone.stop();
    }

    function getActiveButton() {
      return active ? active.button : null;
    }

    return {
      handleMouseDown,
      handleMouseUp,
      cancel,
      getActiveButton
    };
  }

  const api = {
    ACTION_IDS,
    ACTION_META,
    DEFAULT_BINDINGS,
    cloneDefaultBindings,
    getMouseButtonName,
    getMouseButtonShortName,
    formatBindingLabel,
    normalizeBindings,
    assignBinding,
    getButtonHandlers,
    migrateLegacySettingsToBindings,
    formatFooterSummary,
    createMouseActionController
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.MorseBindings = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
