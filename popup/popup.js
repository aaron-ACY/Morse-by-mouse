(function () {
  'use strict';

  const { REFERENCE_GROUPS, decodeMorse, formatVisualMorse } = window.MorseTable;
  const vietnameseMorse = window.VietnameseMorse || null;
  const VN_STATES = vietnameseMorse
    ? vietnameseMorse.STATES
    : {
        NORMAL: 'NORMAL',
        WAITING_FOR_DIACRITIC: 'WAITING_FOR_DIACRITIC',
        WAITING_FOR_TONE: 'WAITING_FOR_TONE'
      };
  const VN_STATE_META = vietnameseMorse
    ? vietnameseMorse.STATE_META
    : {
        NORMAL: { badge: 'Normal Mode', desc: 'Đang nhập chữ cái' },
        WAITING_FOR_DIACRITIC: { badge: 'Diacritic Mode', desc: 'Đang chờ nhập dấu' },
        WAITING_FOR_TONE: { badge: 'Tone Mode', desc: 'Đang chờ thanh điệu hoặc đổi dấu' }
      };
  const { createMorseEngine, DEFAULT_CONFIG } = window.MorseEngine;
  const {
    ACTION_IDS,
    ACTION_META,
    cloneDefaultBindings,
    formatBindingLabel,
    normalizeBindings,
    assignBinding,
    createMouseActionController
  } = window.MorseBindings;
  const { createSidetone } = window.MorseAudio;
  const { insertText, deleteBackward, replaceLastChar, getCharBeforeCaret } =
    window.MorseTextInserter;

  const PRESETS = {
    slow: { dashThresholdMs: 260, letterGapMs: 850, wordGapMs: 1800 },
    normal: { dashThresholdMs: 200, letterGapMs: 600, wordGapMs: 1400 },
    fast: { dashThresholdMs: 140, letterGapMs: 420, wordGapMs: 1000 }
  };

  const DEFAULTS = {
    enabled: false,
    scope: 'always',
    dashThresholdMs: DEFAULT_CONFIG.dashThresholdMs,
    letterGapMs: DEFAULT_CONFIG.letterGapMs,
    wordGapMs: DEFAULT_CONFIG.wordGapMs,
    autoSpace: DEFAULT_CONFIG.autoSpace,
    letterCase: 'lower',
    soundEnabled: true,
    soundVolume: 80,
    showHud: true,
    bindings: cloneDefaultBindings()
  };

  let state = { ...DEFAULTS };

  const els = {
    enabledToggle: document.getElementById('enabledToggle'),
    scopeControl: document.getElementById('scopeControl'),
    soundToggle: document.getElementById('soundToggle'),
    soundVolume: document.getElementById('soundVolume'),
    soundVolumeVal: document.getElementById('soundVolumeVal'),
    hudToggle: document.getElementById('hudToggle'),
    autoSpaceToggle: document.getElementById('autoSpaceToggle'),
    upperToggle: document.getElementById('upperToggle'),
    actionMenu: document.getElementById('actionMenu'),
    resetBindingsBtn: document.getElementById('resetBindingsBtn'),
    capturePanel: document.getElementById('capturePanel'),
    captureTitle: document.getElementById('captureTitle'),
    captureSub: document.getElementById('captureSub'),
    captureBarFill: document.getElementById('captureBarFill'),
    cancelBindBtn: document.getElementById('cancelBindBtn'),
    bindFeedback: document.getElementById('bindFeedback'),
    dashThreshold: document.getElementById('dashThreshold'),
    dashThresholdVal: document.getElementById('dashThresholdVal'),
    letterGap: document.getElementById('letterGap'),
    letterGapVal: document.getElementById('letterGapVal'),
    wordGap: document.getElementById('wordGap'),
    wordGapVal: document.getElementById('wordGapVal'),
    testArea: document.getElementById('testArea'),
    testLiveMorse: document.getElementById('testLiveMorse'),
    testVnModeRow: document.getElementById('testVnModeRow'),
    testVnBadge: document.getElementById('testVnBadge'),
    testVnDesc: document.getElementById('testVnDesc'),
    testVnChar: document.getElementById('testVnChar'),
    testVnEscBtn: document.getElementById('testVnEscBtn'),
    testVnNotice: document.getElementById('testVnNotice'),
    referenceContainer: document.getElementById('referenceContainer')
  };

  const sidetone = createSidetone();

  const testEngine = createMorseEngine({
    now: () => performance.now(),
    vietnameseMorse,
    onPressStart: () => sidetone.start(),
    onThresholdCrossed: () => sidetone.markDash(),
    onSignalAdded: () => sidetone.stop(),
    onCommit: (result) => {
      if (result.kind === 'char') {
        insertText(els.testArea, result.char);
        updateTestLive(`Đã gõ "${result.char}"`);
        return;
      }
      updateTestLive(result.kind === 'unknown' ? `Không rõ (${result.code})` : '');
    },
    onReplaceChar: (nextChar, details) => {
      replaceLastChar(els.testArea, nextChar, details && details.previous);
      const label = details && details.label ? ` (${details.label})` : '';
      updateTestLive(`Đã chuyển → "${nextChar}"${label}`);
    },
    onWordSpace: () => {
      insertText(els.testArea, ' ');
      updateTestLive('␣ +1 dấu cách');
    },
    onDeleteSignal: (buf) => {
      updateTestLive(buf ? `⌫ Còn: ${formatVisualMorse(buf)}` : '⌫ Đã hủy mã');
    },
    onDeleteChar: () => {
      deleteBackward(els.testArea);
      updateTestLive('⌫ Đã xóa 1 ký tự');
    },
    onError: (err) => {
      updateTestLive(err && err.message ? err.message : 'Mã dấu không hợp lệ');
    },
    onStateChange: () => {
      syncTestVnStatus();
      const snap = testEngine.getSnapshot();
      if (snap.buffer || snap.isPressing) {
        updateTestLive();
      }
    }
  });

  function triggerTestVietnameseMode() {
    const fallbackChar = getCharBeforeCaret(els.testArea);
    return testEngine.triggerEscape(fallbackChar);
  }

  const testController = createMouseActionController({
    engine: testEngine,
    sidetone,
    getBindings: () => state.bindings,
    getThresholdMs: () => state.dashThresholdMs,
    onTriggerDiacritic: triggerTestVietnameseMode
  });

  function syncTestVnStatus() {
    const snap = testEngine.getSnapshot();
    const vnState = snap.vnState || VN_STATES.NORMAL;
    const isVnMode = vnState !== VN_STATES.NORMAL;
    const meta = VN_STATE_META[vnState] || VN_STATE_META.NORMAL;
    if (els.testVnModeRow) {
      els.testVnModeRow.className = 'vn-status-row';
      if (vnState === VN_STATES.WAITING_FOR_DIACRITIC) {
        els.testVnModeRow.classList.add('state-diacritic');
      } else if (vnState === VN_STATES.WAITING_FOR_TONE) {
        els.testVnModeRow.classList.add('state-tone');
      }
      els.testVnBadge.textContent = meta.badge;
      els.testVnDesc.textContent = meta.desc;
      if (snap.activeChar) {
        els.testVnChar.hidden = false;
        els.testVnChar.textContent = `Chữ: ${snap.activeChar}`;
      } else {
        els.testVnChar.hidden = true;
      }
      if (els.testVnEscBtn) {
        els.testVnEscBtn.textContent = isVnMode ? 'Hủy ESC' : 'ESC Dấu';
        els.testVnEscBtn.classList.toggle('cancel', isVnMode);
      }
    }
    if (els.testVnNotice) {
      if (snap.statusNotice) {
        els.testVnNotice.hidden = false;
        els.testVnNotice.textContent = snap.statusNotice;
        els.testVnNotice.className =
          snap.statusNoticeType === 'error' ? 'vn-test-notice error' : 'vn-test-notice';
      } else {
        els.testVnNotice.hidden = true;
      }
    }
  }

  function updateTestLive(overrideText) {
    syncTestVnStatus();
    if (overrideText) {
      els.testLiveMorse.textContent = overrideText;
      return;
    }
    const snap = testEngine.getSnapshot();
    const previewCode = snap.buffer + (snap.isPressing ? snap.currentHoldSymbol : '');
    if (!previewCode) {
      els.testLiveMorse.textContent = 'Sẵn sàng';
      return;
    }
    const isVnMode = snap.vnState && snap.vnState !== VN_STATES.NORMAL;
    const decoded =
      isVnMode && vietnameseMorse
        ? vietnameseMorse.decodeVietnamesePreview(previewCode, snap.activeChar, snap.vnState)
        : decodeMorse(previewCode, { letterCase: state.letterCase });
    const tag =
      decoded.kind === 'char' ? decoded.char : decoded.kind === 'prefix' ? '…' : '?';
    els.testLiveMorse.textContent = `${formatVisualMorse(previewCode)} → ${tag}`;
  }

  function renderBindings() {
    for (const actionId of ACTION_IDS) {
      const binding = state.bindings[actionId];
      const labelEl = document.getElementById(`bindLabel-${actionId}`);
      const rowEl = els.actionMenu.querySelector(`.action-row[data-action="${actionId}"]`);
      const plusBtn = els.actionMenu.querySelector(`[data-bind-action="${actionId}"]`);
      const clearBtn = els.actionMenu.querySelector(`[data-clear-action="${actionId}"]`);

      if (labelEl) {
        labelEl.textContent = formatBindingLabel(binding);
        labelEl.classList.toggle('unset', !binding);
      }
      if (rowEl) {
        rowEl.classList.toggle('capturing', capturingAction === actionId);
      }
      if (plusBtn) {
        const isCurrent = capturingAction === actionId;
        plusBtn.classList.toggle('active', isCurrent);
        plusBtn.textContent = isCurrent ? '...' : '+';
      }
      if (clearBtn) {
        clearBtn.hidden = !binding;
      }
    }
  }

  function renderUI() {
    els.enabledToggle.checked = Boolean(state.enabled);
    els.soundToggle.checked = Boolean(state.soundEnabled);
    const vol = Number(state.soundVolume) || 80;
    els.soundVolume.value = String(vol);
    els.soundVolumeVal.textContent = `${vol}%`;
    els.soundVolume.disabled = !state.soundEnabled;
    els.hudToggle.checked = Boolean(state.showHud);
    els.autoSpaceToggle.checked = Boolean(state.autoSpace);
    els.upperToggle.checked = state.letterCase === 'upper';

    els.dashThreshold.value = String(state.dashThresholdMs);
    els.dashThresholdVal.textContent = `${state.dashThresholdMs} ms`;

    els.letterGap.value = String(state.letterGapMs);
    els.letterGapVal.textContent = `${state.letterGapMs} ms`;

    els.wordGap.value = String(state.wordGapMs);
    els.wordGapVal.textContent = `${state.wordGapMs} ms`;

    els.scopeControl.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.scope === state.scope);
    });

    renderBindings();

    sidetone.setEnabled(Boolean(state.soundEnabled));
    sidetone.setVolume(vol / 100);
    testEngine.updateConfig({
      dashThresholdMs: Number(state.dashThresholdMs),
      letterGapMs: Number(state.letterGapMs),
      wordGapMs: Number(state.wordGapMs),
      autoSpace: Boolean(state.autoSpace),
      letterCase: state.letterCase
    });
  }

  function savePatch(patch) {
    const next = { ...state, ...patch };
    if (patch && 'bindings' in patch) {
      next.bindings = normalizeBindings(patch.bindings);
    }
    state = next;
    renderUI();
    if (chrome?.storage?.local) {
      chrome.storage.local.set(patch);
    }
  }

  function appendRefGridItems(grid, items) {
    for (const item of items) {
      const cell = document.createElement('div');
      cell.className = 'ref-item';
      const k = document.createElement('span');
      k.className = 'ref-key';
      k.textContent = item.key;
      const c = document.createElement('span');
      c.className = 'ref-code';
      for (const ch of item.code) {
        const sym = document.createElement('span');
        sym.className = ch === '.' ? 'sym-dot' : 'sym-dash';
        sym.textContent = ch === '.' ? '·' : '—';
        c.appendChild(sym);
      }
      cell.appendChild(k);
      cell.appendChild(c);
      grid.appendChild(cell);
    }
  }

  function renderReference() {
    els.referenceContainer.innerHTML = '';
    for (const group of REFERENCE_GROUPS) {
      const wrap = document.createElement('div');
      const title = document.createElement('div');
      title.className = 'ref-group-title';
      title.textContent = group.title;
      wrap.appendChild(title);

      const grid = document.createElement('div');
      grid.className = 'ref-grid';
      appendRefGridItems(grid, group.items);
      wrap.appendChild(grid);
      els.referenceContainer.appendChild(wrap);
    }

    if (vietnameseMorse && Array.isArray(vietnameseMorse.VIETNAMESE_REFERENCE_GROUPS)) {
      const extWrap = document.createElement('div');
      extWrap.className = 'ref-ext-wrap';

      const extTitle = document.createElement('div');
      extTitle.className = 'ref-ext-title';
      extTitle.textContent = 'Vietnamese Morse Extension';
      extWrap.appendChild(extTitle);

      for (const subGroup of vietnameseMorse.VIETNAMESE_REFERENCE_GROUPS) {
        const subWrap = document.createElement('div');
        const subTitle = document.createElement('div');
        subTitle.className = 'ref-subgroup-title';
        subTitle.textContent = subGroup.title;
        subWrap.appendChild(subTitle);

        const subGrid = document.createElement('div');
        subGrid.className = 'ref-grid cols-2';
        appendRefGridItems(subGrid, subGroup.items);
        subWrap.appendChild(subGrid);
        extWrap.appendChild(subWrap);
      }

      els.referenceContainer.appendChild(extWrap);
    }
  }

  // --- "+" Auto-detect capture flow ---
  let capturingAction = null;
  let capturePress = null;
  let captureRafId = null;
  let suppressAfterCaptureBtn = null;

  function stopCaptureAnim() {
    if (captureRafId !== null) {
      cancelAnimationFrame(captureRafId);
      captureRafId = null;
    }
    els.captureBarFill.style.width = '0%';
    els.captureBarFill.classList.remove('hold');
  }

  function updateCaptureProgress() {
    captureRafId = null;
    if (!capturePress) return;
    const elapsed = Math.max(0, performance.now() - capturePress.startTime);
    const thresh = Number(state.dashThresholdMs) || 200;
    const pct = Math.min(100, (elapsed / thresh) * 100);
    const isHold = elapsed >= thresh;

    els.captureBarFill.style.width = `${pct}%`;
    els.captureBarFill.classList.toggle('hold', isHold);

    const btnLabel = window.MorseBindings.getMouseButtonName(capturePress.button);
    els.captureSub.innerHTML = isHold
      ? `Đang giữ <b>${btnLabel}</b> → thả ra để gán <b>Nhấn giữ</b>`
      : `Đang nhấn <b>${btnLabel}</b> → thả ngay = <b>Nhấn</b>, giữ thêm = <b>Nhấn giữ</b>`;

    captureRafId = requestAnimationFrame(updateCaptureProgress);
  }

  function setCaptureAction(actionId) {
    capturingAction = actionId;
    capturePress = null;
    stopCaptureAnim();

    if (!actionId) {
      els.capturePanel.hidden = true;
      renderBindings();
      return;
    }

    const meta = ACTION_META[actionId];
    els.captureTitle.textContent = `Đang chờ nhận nút cho: ${meta.name}`;
    els.captureSub.innerHTML = `Bấm nhanh = <b>Nhấn</b> &nbsp;|&nbsp; Giữ ≥ ${state.dashThresholdMs}ms = <b>Nhấn giữ</b> (trái, phải, giữa, nút hông...)`;
    els.capturePanel.hidden = false;
    renderBindings();
  }

  els.actionMenu.addEventListener('click', (e) => {
    const plusBtn = e.target.closest('[data-bind-action]');
    if (plusBtn) {
      const actionId = plusBtn.dataset.bindAction;
      setCaptureAction(capturingAction === actionId ? null : actionId);
      return;
    }

    const clearBtn = e.target.closest('[data-clear-action]');
    if (clearBtn) {
      const actionId = clearBtn.dataset.clearAction;
      if (capturingAction === actionId) setCaptureAction(null);
      const { bindings } = assignBinding(state.bindings, actionId, null);
      savePatch({ bindings });
      els.bindFeedback.textContent = `Đã bỏ gán nút cho ${ACTION_META[actionId].name}.`;
    }
  });

  els.cancelBindBtn.addEventListener('click', () => {
    setCaptureAction(null);
  });

  els.resetBindingsBtn.addEventListener('click', () => {
    setCaptureAction(null);
    savePatch({ bindings: cloneDefaultBindings() });
    els.bindFeedback.textContent = 'Đã khôi phục gán nút mặc định.';
  });

  window.addEventListener(
    'mousedown',
    (e) => {
      if (!capturingAction) return;
      if (
        e.button === 0 &&
        (e.target === els.cancelBindBtn ||
          (e.target.closest && e.target.closest('[data-bind-action]')))
      ) {
        return;
      }

      e.preventDefault();
      e.stopImmediatePropagation();

      if (capturePress) return;
      capturePress = { button: e.button, startTime: performance.now() };
      updateCaptureProgress();
    },
    true
  );

  window.addEventListener(
    'mouseup',
    (e) => {
      if (capturingAction && capturePress && e.button === capturePress.button) {
        e.preventDefault();
        e.stopImmediatePropagation();

        const duration = Math.max(0, performance.now() - capturePress.startTime);
        const mode = duration >= (Number(state.dashThresholdMs) || 200) ? 'hold' : 'tap';
        const nextBinding = { button: capturePress.button, mode };
        const targetAction = capturingAction;

        suppressAfterCaptureBtn = e.button;
        setTimeout(() => {
          suppressAfterCaptureBtn = null;
        }, 400);

        capturePress = null;
        stopCaptureAnim();
        setCaptureAction(null);

        const { bindings, replacedAction } = assignBinding(
          state.bindings,
          targetAction,
          nextBinding
        );
        savePatch({ bindings });

        const label = formatBindingLabel(nextBinding);
        if (replacedAction) {
          els.bindFeedback.textContent = `Đã gán [${label}] cho ${ACTION_META[targetAction].name} (đã bỏ trùng khỏi ${ACTION_META[replacedAction].name}).`;
        } else {
          els.bindFeedback.textContent = `Đã gán [${label}] cho ${ACTION_META[targetAction].name}!`;
        }
        return;
      }

      if (testController.handleMouseUp(e.button)) {
        e.preventDefault();
        return;
      }

      if (e.button >= 3) {
        e.preventDefault();
      }
    },
    true
  );

  window.addEventListener(
    'click',
    (e) => {
      if (suppressAfterCaptureBtn !== null && e.button === suppressAfterCaptureBtn) {
        e.preventDefault();
        e.stopImmediatePropagation();
        suppressAfterCaptureBtn = null;
      }
    },
    true
  );

  window.addEventListener(
    'auxclick',
    (e) => {
      if (
        capturingAction ||
        (suppressAfterCaptureBtn !== null && e.button === suppressAfterCaptureBtn) ||
        testController.getActiveButton() === e.button ||
        e.button >= 3
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true
  );

  window.addEventListener(
    'contextmenu',
    (e) => {
      if (
        capturingAction ||
        suppressAfterCaptureBtn === 2 ||
        e.target === els.testArea
      ) {
        if (!e.shiftKey) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      }
    },
    true
  );

  if (els.testVnEscBtn) {
    els.testVnEscBtn.addEventListener('mousedown', (e) => {
      e.preventDefault();
    });
    els.testVnEscBtn.addEventListener('click', () => {
      els.testArea.focus();
      triggerTestVietnameseMode();
    });
  }

  window.addEventListener('keydown', (e) => {
    if (capturingAction && e.key === 'Escape') {
      e.preventDefault();
      setCaptureAction(null);
      return;
    }

    const snap = testEngine.getSnapshot();
    const inTestArea = document.activeElement === els.testArea;
    const hasTestContext =
      snap.vnState !== VN_STATES.NORMAL || Boolean(snap.buffer) || Boolean(snap.activeChar);

    if (
      e.key === 'Escape' &&
      !e.shiftKey &&
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      (inTestArea || hasTestContext)
    ) {
      if (e.repeat) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      triggerTestVietnameseMode();
      return;
    }

    if (inTestArea) {
      const isPrintable =
        e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
      if (
        isPrintable ||
        e.key === 'Backspace' ||
        e.key === 'Delete' ||
        e.key === 'Enter' ||
        (e.key && e.key.startsWith('Arrow')) ||
        e.key === 'Home' ||
        e.key === 'End'
      ) {
        testEngine.clearVietnameseContext();
      }
    }
  },
  true
  );

  // Live practice test area inside popup
  els.testArea.addEventListener('mousedown', (e) => {
    if (capturingAction || e.shiftKey) return;
    if (e.button === 0 && document.activeElement !== els.testArea) {
      return; // First left-click focuses testArea normally
    }
    if (testController.handleMouseDown(e.button)) {
      e.preventDefault();
      els.testArea.focus();
    }
  });

  window.addEventListener('blur', () => {
    setCaptureAction(null);
    testController.cancel();
  });

  // Standard settings bindings
  els.enabledToggle.addEventListener('change', (e) =>
    savePatch({ enabled: e.target.checked })
  );
  els.soundToggle.addEventListener('change', (e) =>
    savePatch({ soundEnabled: e.target.checked })
  );
  els.soundVolume.addEventListener('input', (e) => {
    savePatch({ soundVolume: Number(e.target.value) });
  });
  els.soundVolume.addEventListener('change', () => {
    sidetone.playDotTick();
  });
  els.hudToggle.addEventListener('change', (e) =>
    savePatch({ showHud: e.target.checked })
  );
  els.autoSpaceToggle.addEventListener('change', (e) =>
    savePatch({ autoSpace: e.target.checked })
  );
  els.upperToggle.addEventListener('change', (e) =>
    savePatch({ letterCase: e.target.checked ? 'upper' : 'lower' })
  );

  els.scopeControl.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    savePatch({ scope: btn.dataset.scope });
  });

  document.querySelectorAll('.preset-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const preset = PRESETS[btn.dataset.preset];
      if (preset) savePatch(preset);
    });
  });

  els.dashThreshold.addEventListener('input', (e) => {
    savePatch({ dashThresholdMs: Number(e.target.value) });
  });

  els.letterGap.addEventListener('input', (e) => {
    const letterGapMs = Number(e.target.value);
    const wordGapMs = Math.max(state.wordGapMs, letterGapMs + 200);
    savePatch({ letterGapMs, wordGapMs });
  });

  els.wordGap.addEventListener('input', (e) => {
    const wordGapMs = Math.max(Number(e.target.value), state.letterGapMs + 200);
    savePatch({ wordGapMs });
  });

  renderReference();
  syncTestVnStatus();

  if (chrome?.storage?.local) {
    chrome.storage.local.get(Object.keys(DEFAULTS), (stored) => {
      state = {
        ...DEFAULTS,
        ...stored,
        bindings: normalizeBindings(stored.bindings)
      };
      renderUI();
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      for (const [k, v] of Object.entries(changes)) {
        state[k] = k === 'bindings' ? normalizeBindings(v.newValue) : v.newValue;
      }
      renderUI();
    });
  } else {
    renderUI();
  }
})();
