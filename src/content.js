(function () {
  'use strict';

  if (window.__morseByMouseLoaded) return;
  window.__morseByMouseLoaded = true;

  const { decodeMorse, getNextHints, REFERENCE_GROUPS } = window.MorseTable;
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
  const VIETNAMESE_REFERENCE_GROUPS = vietnameseMorse
    ? vietnameseMorse.VIETNAMESE_REFERENCE_GROUPS
    : [];
  const decodeVietnamesePreview = vietnameseMorse
    ? vietnameseMorse.decodeVietnamesePreview
    : null;
  const getVietnameseNextHints = vietnameseMorse
    ? vietnameseMorse.getVietnameseNextHints
    : null;
  const applyVietnameseCode = vietnameseMorse
    ? vietnameseMorse.applyVietnameseCode
    : null;
  const { createMorseEngine, DEFAULT_CONFIG } = window.MorseEngine;
  const {
    cloneDefaultBindings,
    normalizeBindings,
    getButtonHandlers,
    createMouseActionController
  } = window.MorseBindings;
  const { createSidetone } = window.MorseAudio;
  const {
    isEditableElement,
    findEditableFromTarget,
    getActiveEditable,
    getEditableVisualRect,
    getCharBeforeCaret,
    insertText,
    deleteBackward,
    replaceLastChar
  } = window.MorseTextInserter;
  const { computeSmartHudPosition } = window.MorseHudLayout;

  const IS_TOP_FRAME = window === window.top;

  let settings = {
    enabled: false,
    scope: 'always',
    dashThresholdMs: DEFAULT_CONFIG.dashThresholdMs,
    letterGapMs: DEFAULT_CONFIG.letterGapMs,
    wordGapMs: DEFAULT_CONFIG.wordGapMs,
    autoSpace: DEFAULT_CONFIG.autoSpace,
    letterCase: DEFAULT_CONFIG.letterCase,
    soundEnabled: true,
    soundVolume: 80,
    showHud: true,
    bindings: cloneDefaultBindings()
  };

  let suppressNextContextMenu = false;
  let suppressResetTimer = null;
  let suppressNextLeftClick = false;
  let leftSuppressResetTimer = null;
  let suppressAuxButton = null;
  let auxResetTimer = null;
  const heldMouseButtons = new Set();
  const chordConsumedButtons = new Set();

  function clearMouseChordState() {
    heldMouseButtons.clear();
    chordConsumedButtons.clear();
  }

  function togglePluginEnabled() {
    const next = !settings.enabled;
    if (settings.soundEnabled) {
      if (next) {
        applySettings({ enabled: true });
        sidetone.playDotTick();
      } else {
        sidetone.playDeleteTick();
        applySettings({ enabled: false });
      }
    } else {
      applySettings({ enabled: next });
    }
    if (chrome?.storage?.local) {
      chrome.storage.local.set({ enabled: next });
    }
  }

  const sidetone = createSidetone();

  function handleCommit(result) {
    const target = getActiveEditable();

    if (result.kind === 'char') {
      if (target) {
        insertText(target, result.char);
      }
    }

    syncHud();
  }

  function handleReplaceChar(nextChar, details) {
    const target = getActiveEditable();
    if (target && nextChar) {
      replaceLastChar(target, nextChar, details && details.previous);
    }
    syncHud();
  }

  function triggerVietnameseMode() {
    const target = getActiveEditable();
    const fallbackChar = target ? getCharBeforeCaret(target) : undefined;
    return engine.triggerEscape(fallbackChar);
  }

  function handleWordSpace() {
    const target = getActiveEditable();
    if (target) {
      insertText(target, ' ');
    }
    syncHud();
  }

  function handleDeleteSignal(_buffer) {
    ensureAnimLoop();
    syncHud();
  }

  function handleDeleteChar() {
    const target = getActiveEditable();
    if (target) {
      deleteBackward(target);
    }
    syncHud();
  }

  function handleError(_err) {
    syncHud();
  }

  const engine = createMorseEngine({
    now: () => performance.now(),
    vietnameseMorse,
    config: {
      dashThresholdMs: settings.dashThresholdMs,
      letterGapMs: settings.letterGapMs,
      wordGapMs: settings.wordGapMs,
      autoSpace: settings.autoSpace,
      letterCase: settings.letterCase
    },
    onPressStart: () => {
      sidetone.start();
      ensureAnimLoop();
    },
    onThresholdCrossed: () => {
      sidetone.markDash();
    },
    onSignalAdded: () => {
      sidetone.stop();
      ensureAnimLoop();
    },
    onCommit: handleCommit,
    onReplaceChar: handleReplaceChar,
    onWordSpace: handleWordSpace,
    onDeleteSignal: handleDeleteSignal,
    onDeleteChar: handleDeleteChar,
    onError: handleError,
    onStateChange: () => {
      syncHud();
    }
  });

  const mouseController = createMouseActionController({
    engine,
    sidetone,
    getBindings: () => settings.bindings,
    getThresholdMs: () => settings.dashThresholdMs,
    onTriggerDiacritic: triggerVietnameseMode
  });

  function applySettings(next) {
    const merged = { ...settings, ...next };
    if (next && 'bindings' in next) {
      merged.bindings = normalizeBindings(next.bindings);
    }
    settings = merged;
    sidetone.setEnabled(settings.enabled && settings.soundEnabled);
    sidetone.setVolume((Number(settings.soundVolume) || 80) / 100);
    engine.updateConfig({
      dashThresholdMs: Number(settings.dashThresholdMs) || 200,
      letterGapMs: Number(settings.letterGapMs) || 600,
      wordGapMs: Number(settings.wordGapMs) || 1400,
      autoSpace: Boolean(settings.autoSpace),
      letterCase: settings.letterCase === 'upper' ? 'upper' : 'lower'
    });
    if (!settings.enabled) {
      suppressNextContextMenu = false;
      suppressNextLeftClick = false;
      suppressAuxButton = null;
      mouseController.cancel();
      engine.reset();
      sidetone.stop();
    }
    syncHud();
  }

  function loadSettings() {
    if (!chrome?.storage?.local) return;
    chrome.storage.local.get(Object.keys(settings), (stored) => {
      if (chrome.runtime.lastError) return;
      applySettings(stored);
    });
  }

  if (chrome?.storage?.onChanged) {
    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName !== 'local') return;
      const patch = {};
      for (const [k, v] of Object.entries(changes)) {
        patch[k] = v.newValue;
      }
      applySettings(patch);
    });
  }

  // --- HUD (Top Frame Only) ---
  let hudHost = null;
  let hudShadow = null;
  let hudRefs = null;
  let hudCollapsed = false;
  let activeRefTab = 0;
  let renderedRefTab = -1;
  let tabBeforeVn = null;
  let prevVnState = VN_STATES.NORMAL;
  let renderedRefItems = [];
  let animRafId = null;
  let externalState = null;
  let externalClearTimer = null;
  let externalTargetRect = null;
  let userDraggedHud = false;
  let hasPositionedHud = false;
  let scrollRepositionRaf = null;

  const HUD_REF_TABS = [
    { id: 0, label: 'A–Z', cols: 4, spaced: false },
    { id: 1, label: '0–9', cols: 2, spaced: true },
    { id: 2, label: 'Dấu', cols: 2, spaced: true },
    { id: 3, label: 'Việt', cols: 2, spaced: true, vn: true }
  ];

  function describeTarget(el) {
    if (!el) return null;
    const tag = el.tagName ? el.tagName.toLowerCase() : 'editor';
    if (tag === 'input') {
      const type = (el.type || 'text').toLowerCase();
      return type === 'text' ? 'input' : `input[${type}]`;
    }
    if (tag === 'textarea') return 'textarea';
    if (el.isContentEditable) return 'editor';
    return tag;
  }

  function findIframeForSource(sourceWin) {
    if (!sourceWin) return null;
    const frames = document.querySelectorAll('iframe');
    for (const frame of frames) {
      try {
        if (frame.contentWindow === sourceWin) return frame;
      } catch (_err) {}
    }
    return null;
  }

  function getActiveTargetRect() {
    const active = getActiveEditable();
    if (active) {
      return getEditableVisualRect(active);
    }
    if (externalState && externalTargetRect) {
      return externalTargetRect;
    }
    return null;
  }

  function clampDraggedHudToViewport() {
    if (!hudHost || !hudHost.isConnected) return;
    const rect = hudHost.getBoundingClientRect();
    const width = hudHost.offsetWidth || rect.width || 326;
    const height = hudHost.offsetHeight || rect.height || 340;
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const maxTop = Math.max(8, window.innerHeight - height - 8);
    const clampedLeft = Math.min(maxLeft, Math.max(8, rect.left));
    const clampedTop = Math.min(maxTop, Math.max(8, rect.top));
    hudHost.style.transition = 'none';
    hudHost.style.right = 'auto';
    hudHost.style.bottom = 'auto';
    hudHost.style.left = `${Math.round(clampedLeft)}px`;
    hudHost.style.top = `${Math.round(clampedTop)}px`;
  }

  function repositionHud(options = {}) {
    if (!IS_TOP_FRAME || !hudHost || !hudHost.isConnected || !settings.showHud) return;
    if (userDraggedHud) {
      if (options.clampDragged) clampDraggedHudToViewport();
      return;
    }

    const hudWidth = hudHost.offsetWidth || 326;
    const hudHeight = hudHost.offsetHeight || (hudCollapsed ? 40 : 340);
    const targetRect = options.targetRect !== undefined ? options.targetRect : getActiveTargetRect();

    const pos = computeSmartHudPosition({
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      hudWidth,
      hudHeight,
      targetRect,
      margin: 16,
      pad: 14
    });

    const instant = Boolean(options.instant) || !hasPositionedHud;
    hudHost.style.transition = instant
      ? 'none'
      : 'left 0.18s cubic-bezier(0.22, 1, 0.36, 1), top 0.18s cubic-bezier(0.22, 1, 0.36, 1)';
    hudHost.style.right = 'auto';
    hudHost.style.bottom = 'auto';
    hudHost.style.left = `${Math.round(pos.left)}px`;
    hudHost.style.top = `${Math.round(pos.top)}px`;
    hasPositionedHud = true;
  }

  function buildMorseCodeEl(code, spaced) {
    const span = document.createElement('span');
    span.className = spaced ? 'morse-ref-code spaced' : 'morse-ref-code';
    for (const ch of code) {
      const sym = document.createElement('span');
      sym.className = ch === '.' ? 'sym-dot' : 'sym-dash';
      sym.textContent = ch === '.' ? '·' : '—';
      span.appendChild(sym);
    }
    return span;
  }

  function ensureHud() {
    if (!IS_TOP_FRAME) return null;
    if (hudHost && hudHost.isConnected) return hudRefs;
    if (!document.body && !document.documentElement) return null;

    renderedRefTab = -1;
    renderedRefItems = [];
    hasPositionedHud = false;

    hudHost = document.createElement('div');
    hudHost.id = 'morse-by-mouse-host';
    hudHost.style.cssText =
      'all:initial;position:fixed;right:16px;bottom:16px;z-index:2147483647;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;';

    hudShadow = hudHost.attachShadow({ mode: 'open' });
    hudShadow.innerHTML = `
      <style>
        * { box-sizing: border-box; }
        .card {
          width: 326px;
          background: rgba(15, 23, 42, 0.94);
          backdrop-filter: blur(12px);
          color: #f8fafc;
          border: 1px solid rgba(148, 163, 184, 0.25);
          border-radius: 14px;
          box-shadow: 0 14px 36px rgba(2, 6, 23, 0.48);
          overflow: hidden;
          font-size: 12px;
          line-height: 1.4;
          user-select: none;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 10px;
          background: rgba(30, 41, 59, 0.85);
          border-bottom: 1px solid rgba(148, 163, 184, 0.14);
          cursor: grab;
        }
        .header:active { cursor: grabbing; }
        .brand {
          display: flex;
          align-items: center;
          gap: 6px;
          font-weight: 600;
          font-size: 12px;
          letter-spacing: 0.2px;
          min-width: 0;
        }
        .target-pill {
          font-size: 9.5px;
          font-weight: 600;
          padding: 1px 5px;
          border-radius: 5px;
          max-width: 108px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          background: rgba(51, 65, 85, 0.7);
          color: #94a3b8;
          border: 1px solid rgba(148, 163, 184, 0.22);
        }
        .target-pill.focused {
          background: rgba(16, 185, 129, 0.16);
          color: #6ee7b7;
          border-color: rgba(16, 185, 129, 0.35);
        }
        .target-pill.waiting {
          background: rgba(245, 158, 11, 0.14);
          color: #fcd34d;
          border-color: rgba(245, 158, 11, 0.32);
        }
        .target-pill[hidden] { display: none; }
        .dot-status {
          width: 8px;
          height: 8px;
          border-radius: 999px;
          background: #64748b;
          box-shadow: 0 0 0 2px rgba(100, 116, 139, 0.25);
          transition: background 0.15s, box-shadow 0.15s;
        }
        .dot-status.on {
          background: #22d3ee;
          box-shadow: 0 0 8px rgba(34, 211, 238, 0.85);
        }
        .dot-status.pressing-dot {
          background: #22d3ee;
          box-shadow: 0 0 12px #22d3ee;
        }
        .dot-status.pressing-dash {
          background: #f59e0b;
          box-shadow: 0 0 12px #f59e0b;
        }
        .controls {
          display: flex;
          align-items: center;
          gap: 4px;
        }
        .btn {
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: rgba(51, 65, 85, 0.65);
          color: #e2e8f0;
          border-radius: 7px;
          padding: 2px 7px;
          font-size: 11px;
          cursor: pointer;
          transition: background 0.15s, border-color 0.15s;
        }
        .btn:hover { background: rgba(71, 85, 105, 0.9); }
        .btn.active-on {
          background: rgba(6, 182, 212, 0.22);
          border-color: rgba(34, 211, 238, 0.6);
          color: #67e8f9;
          font-weight: 600;
        }
        .body {
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .card.collapsed .body { display: none; }
        .signal-box {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          background: rgba(2, 6, 23, 0.55);
          border: 1px solid rgba(148, 163, 184, 0.14);
          border-radius: 10px;
          padding: 8px 10px;
          min-height: 44px;
        }
        .morse-seq {
          display: inline-flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 3px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 17px;
          font-weight: 700;
          color: #67e8f9;
          min-height: 22px;
          word-break: break-all;
        }
        .sym-dot { color: #67e8f9; }
        .sym-dash { color: #fbbf24; }
        .morse-seq .live-dot { color: #67e8f9; }
        .morse-seq .live-dash { color: #fbbf24; }
        .morse-seq .placeholder {
          font-family: system-ui, sans-serif;
          font-size: 11.5px;
          font-weight: 400;
          letter-spacing: 0;
          color: #94a3b8;
        }
        .preview-char {
          min-width: 34px;
          height: 30px;
          padding: 0 8px;
          border-radius: 8px;
          background: rgba(30, 41, 59, 0.95);
          border: 1px solid rgba(148, 163, 184, 0.25);
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 15px;
          font-weight: 700;
          color: #f8fafc;
        }
        .preview-char.valid {
          border-color: rgba(34, 211, 238, 0.6);
          color: #67e8f9;
        }
        .preview-char.invalid {
          border-color: rgba(248, 113, 113, 0.5);
          color: #fca5a5;
        }
        .preview-char.prefix {
          border-color: rgba(56, 189, 248, 0.45);
          color: #7dd3fc;
        }
        .preview-char.vn-base {
          border-color: rgba(52, 211, 153, 0.5);
          color: #6ee7b7;
        }
        .vn-mode-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          padding: 4px 8px;
          border-radius: 7px;
          background: rgba(15, 23, 42, 0.72);
          border: 1px solid rgba(148, 163, 184, 0.16);
          font-size: 10.5px;
        }
        .vn-mode-row.state-diacritic {
          background: rgba(6, 182, 212, 0.12);
          border-color: rgba(34, 211, 238, 0.42);
        }
        .vn-mode-row.state-tone {
          background: rgba(245, 158, 11, 0.12);
          border-color: rgba(251, 191, 36, 0.42);
        }
        .vn-mode-left {
          display: flex;
          align-items: center;
          gap: 5px;
          min-width: 0;
        }
        .vn-mode-badge {
          font-weight: 700;
          color: #cbd5e1;
          white-space: nowrap;
        }
        .vn-mode-row.state-diacritic .vn-mode-badge { color: #67e8f9; }
        .vn-mode-row.state-tone .vn-mode-badge { color: #fbbf24; }
        .vn-mode-desc {
          color: #94a3b8;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .vn-active-char {
          font-size: 11px;
          font-weight: 700;
          color: #e2e8f0;
          background: rgba(30, 41, 59, 0.9);
          border: 1px solid rgba(148, 163, 184, 0.22);
          border-radius: 5px;
          padding: 0 5px;
          white-space: nowrap;
        }
        .vn-esc-btn {
          border: 1px solid rgba(56, 189, 248, 0.35);
          background: rgba(8, 145, 178, 0.16);
          color: #67e8f9;
          border-radius: 5px;
          padding: 1px 6px;
          font-size: 10px;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
          transition: background 0.12s, border-color 0.12s;
        }
        .vn-esc-btn:hover {
          background: rgba(6, 182, 212, 0.28);
          border-color: rgba(34, 211, 238, 0.65);
        }
        .vn-esc-btn.cancel {
          border-color: rgba(251, 191, 36, 0.45);
          background: rgba(245, 158, 11, 0.16);
          color: #fde68a;
        }
        .vn-mode-right {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          flex-shrink: 0;
        }
        .vn-notice {
          font-size: 10.5px;
          line-height: 1.3;
          padding: 4px 8px;
          border-radius: 7px;
          background: rgba(8, 145, 178, 0.16);
          border: 1px solid rgba(34, 211, 238, 0.35);
          color: #cffafe;
        }
        .vn-notice.error {
          background: rgba(220, 38, 38, 0.16);
          border-color: rgba(248, 113, 113, 0.45);
          color: #fecaca;
        }
        .bars {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .bar-track {
          height: 4px;
          border-radius: 999px;
          background: rgba(51, 65, 85, 0.6);
          overflow: hidden;
        }
        .bar-fill {
          height: 100%;
          width: 0%;
          border-radius: 999px;
          background: #22d3ee;
          transition: background 0.08s;
        }
        .bar-fill.dash { background: #f59e0b; }
        .bar-fill.gap { background: #38bdf8; }
        .bar-fill.word { background: #a78bfa; }
        .hints {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
          font-size: 11px;
          color: #94a3b8;
        }
        .hint-pill {
          flex: 1;
          background: rgba(30, 41, 59, 0.65);
          border: 1px solid rgba(148, 163, 184, 0.16);
          border-radius: 7px;
          padding: 4px 8px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .hint-pill.dot {
          border-color: rgba(34, 211, 238, 0.28);
          background: rgba(8, 145, 178, 0.1);
        }
        .hint-pill.dash {
          border-color: rgba(251, 191, 36, 0.28);
          background: rgba(245, 158, 11, 0.1);
        }
        .hint-action {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          color: #cbd5e1;
        }
        .hint-sym {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 13px;
          font-weight: 800;
          line-height: 1;
        }
        .hint-pill b {
          font-size: 11px;
          color: #f8fafc;
          white-space: nowrap;
        }
        .hint-pill b.empty {
          color: #475569;
          font-weight: 500;
        }
        .morse-ref-wrap {
          background: rgba(2, 6, 23, 0.52);
          border: 1px solid rgba(148, 163, 184, 0.16);
          border-radius: 10px;
          padding: 7px 8px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .morse-ref-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 6px;
        }
        .morse-ref-title {
          font-size: 10.5px;
          font-weight: 700;
          color: #94a3b8;
          white-space: nowrap;
        }
        .morse-tabs {
          display: flex;
          align-items: center;
          gap: 3px;
        }
        .morse-tab {
          border: 1px solid rgba(148, 163, 184, 0.2);
          background: rgba(30, 41, 59, 0.65);
          color: #94a3b8;
          border-radius: 6px;
          padding: 1px 6px;
          font-size: 10px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.12s, color 0.12s, border-color 0.12s;
        }
        .morse-tab:hover {
          color: #e2e8f0;
          background: rgba(51, 65, 85, 0.8);
        }
        .morse-tab.active {
          background: rgba(6, 182, 212, 0.2);
          border-color: rgba(34, 211, 238, 0.55);
          color: #67e8f9;
        }
        .morse-ref-grid {
          display: grid;
          gap: 4px;
          max-height: 210px;
          overflow-y: auto;
        }
        .morse-ref-grid.cols-4 { grid-template-columns: repeat(4, 1fr); }
        .morse-ref-grid.cols-2 { grid-template-columns: repeat(2, 1fr); }
        .morse-ref-grid.cols-1 { grid-template-columns: 1fr; }
        .morse-ref-subhead {
          grid-column: 1 / -1;
          font-size: 10px;
          font-weight: 700;
          color: #94a3b8;
          padding: 2px 2px 0;
          letter-spacing: 0.2px;
        }
        .morse-ref-grid::-webkit-scrollbar { width: 4px; }
        .morse-ref-grid::-webkit-scrollbar-thumb {
          background: rgba(148, 163, 184, 0.28);
          border-radius: 999px;
        }
        .morse-ref-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 4px;
          background: rgba(15, 23, 42, 0.85);
          border: 1px solid rgba(148, 163, 184, 0.12);
          border-radius: 6px;
          padding: 2px 5px;
          min-width: 0;
          transition: opacity 0.1s, border-color 0.1s, background 0.1s;
        }
        .morse-ref-item.match-exact {
          border-color: rgba(34, 211, 238, 0.85);
          background: rgba(8, 145, 178, 0.26);
        }
        .morse-ref-item.match-prefix {
          border-color: rgba(56, 189, 248, 0.42);
          background: rgba(30, 41, 59, 0.95);
        }
        .morse-ref-item.is-dimmed {
          opacity: 0.36;
        }
        .morse-ref-key {
          font-size: 11px;
          font-weight: 700;
          color: #f8fafc;
          white-space: nowrap;
        }
        .morse-ref-code {
          display: inline-flex;
          align-items: center;
          gap: 0.5px;
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 10px;
          font-weight: 700;
          line-height: 1;
          white-space: nowrap;
        }
        .morse-ref-code.spaced {
          gap: 1.5px;
          font-size: 10.5px;
        }
        .morse-ref-code .sym-dot { color: #67e8f9; }
        .morse-ref-code .sym-dash { color: #fbbf24; }
      </style>
      <div class="card" id="card">
        <div class="header" id="dragHandle" title="Kéo để di chuyển • Nhấn đúp để tự né ô nhập">
          <div class="brand">
            <span class="dot-status" id="statusDot"></span>
            <span>Morse</span>
            <span class="target-pill" id="targetPill" hidden></span>
          </div>
          <div class="controls" id="headerControls">
            <button class="btn" id="toggleBtn" title="Bật/Tắt plugin (Chuột Trái + Phải)">OFF</button>
            <button class="btn" id="soundBtn" title="Âm thanh bíp">🔊</button>
            <button class="btn" id="collapseBtn" title="Thu gọn">—</button>
          </div>
        </div>
        <div class="body">
          <div class="vn-mode-row" id="vnModeRow">
            <div class="vn-mode-left">
              <span class="vn-mode-badge" id="vnModeBadge">Normal Mode</span>
              <span class="vn-mode-desc" id="vnModeDesc">Đang nhập chữ cái</span>
            </div>
            <div class="vn-mode-right">
              <span class="vn-active-char" id="vnActiveChar" hidden></span>
              <button type="button" class="vn-esc-btn" id="vnEscBtn" title="Bật/tắt chế độ thêm dấu tiếng Việt (ESC)">ESC Dấu</button>
            </div>
          </div>
          <div class="vn-notice" id="vnNotice" hidden></div>
          <div class="signal-box">
            <div class="morse-seq" id="morseSeq"></div>
            <div class="preview-char" id="previewChar"></div>
          </div>
          <div class="bars">
            <div class="bar-track" title="Ngưỡng nhấn giữ (—)">
              <div class="bar-fill" id="holdBar"></div>
            </div>
            <div class="bar-track" title="Thời gian chờ chốt ký tự / cách">
              <div class="bar-fill gap" id="gapBar"></div>
            </div>
          </div>
          <div class="hints">
            <div class="hint-pill dot">
              <span class="hint-action">Nhấn <span class="hint-sym sym-dot">·</span></span>
              <b id="hintDot">×</b>
            </div>
            <div class="hint-pill dash">
              <span class="hint-action">Giữ <span class="hint-sym sym-dash">—</span></span>
              <b id="hintDash">×</b>
            </div>
          </div>
          <div class="morse-ref-wrap">
            <div class="morse-ref-head">
              <span class="morse-ref-title">Bảng mã Morse</span>
              <div class="morse-tabs" id="morseTabs">
                <button type="button" class="morse-tab active" data-tab="0">A–Z</button>
                <button type="button" class="morse-tab" data-tab="1">0–9</button>
                <button type="button" class="morse-tab" data-tab="2">Dấu</button>
                <button type="button" class="morse-tab" data-tab="3">Việt</button>
              </div>
            </div>
            <div class="morse-ref-grid cols-4" id="morseRefGrid"></div>
          </div>
        </div>
      </div>
    `;

    const container = document.body || document.documentElement;
    container.appendChild(hudHost);

    hudRefs = {
      card: hudShadow.getElementById('card'),
      dragHandle: hudShadow.getElementById('dragHandle'),
      headerControls: hudShadow.getElementById('headerControls'),
      statusDot: hudShadow.getElementById('statusDot'),
      targetPill: hudShadow.getElementById('targetPill'),
      toggleBtn: hudShadow.getElementById('toggleBtn'),
      soundBtn: hudShadow.getElementById('soundBtn'),
      collapseBtn: hudShadow.getElementById('collapseBtn'),
      vnModeRow: hudShadow.getElementById('vnModeRow'),
      vnModeBadge: hudShadow.getElementById('vnModeBadge'),
      vnModeDesc: hudShadow.getElementById('vnModeDesc'),
      vnActiveChar: hudShadow.getElementById('vnActiveChar'),
      vnEscBtn: hudShadow.getElementById('vnEscBtn'),
      vnNotice: hudShadow.getElementById('vnNotice'),
      morseSeq: hudShadow.getElementById('morseSeq'),
      previewChar: hudShadow.getElementById('previewChar'),
      holdBar: hudShadow.getElementById('holdBar'),
      gapBar: hudShadow.getElementById('gapBar'),
      hintDot: hudShadow.getElementById('hintDot'),
      hintDash: hudShadow.getElementById('hintDash'),
      morseTabs: hudShadow.getElementById('morseTabs'),
      morseRefGrid: hudShadow.getElementById('morseRefGrid')
    };

    const preventFocusSteal = (e) => {
      e.preventDefault();
    };
    hudRefs.card.addEventListener('mousedown', preventFocusSteal);

    hudRefs.vnEscBtn.addEventListener('click', () => {
      triggerVietnameseMode();
    });

    hudRefs.toggleBtn.addEventListener('click', () => {
      togglePluginEnabled();
    });

    hudRefs.soundBtn.addEventListener('click', () => {
      const next = !settings.soundEnabled;
      if (chrome?.storage?.local) {
        chrome.storage.local.set({ soundEnabled: next });
      } else {
        applySettings({ soundEnabled: next });
      }
    });

    hudRefs.collapseBtn.addEventListener('click', () => {
      hudCollapsed = !hudCollapsed;
      hudRefs.card.classList.toggle('collapsed', hudCollapsed);
      hudRefs.collapseBtn.textContent = hudCollapsed ? '+' : '—';
      repositionHud();
    });

    hudRefs.morseTabs.addEventListener('click', (e) => {
      const btn = e.target && e.target.closest('.morse-tab');
      if (!btn) return;
      const tabIndex = Number(btn.dataset.tab);
      if (!Number.isInteger(tabIndex) || tabIndex < 0 || tabIndex >= HUD_REF_TABS.length) {
        return;
      }
      tabBeforeVn = null;
      activeRefTab = tabIndex;
      renderHudReference(hudRefs);
      syncHud();
    });

    renderHudReference(hudRefs);
    setupHudDragging(hudRefs.dragHandle);
    repositionHud({ instant: true });
    return hudRefs;
  }

  function renderHudReference(refs) {
    if (!refs || !refs.morseRefGrid || !Array.isArray(REFERENCE_GROUPS)) return;
    if (renderedRefTab === activeRefTab) return;

    const tabCfg = HUD_REF_TABS[activeRefTab] || HUD_REF_TABS[0];
    const groups = tabCfg.vn
      ? VIETNAMESE_REFERENCE_GROUPS || []
      : REFERENCE_GROUPS[tabCfg.id]
      ? [REFERENCE_GROUPS[tabCfg.id]]
      : [REFERENCE_GROUPS[0]];
    if (!groups.length) return;

    if (refs.morseTabs) {
      refs.morseTabs.querySelectorAll('.morse-tab').forEach((btn) => {
        btn.classList.toggle('active', Number(btn.dataset.tab) === tabCfg.id);
      });
    }

    refs.morseRefGrid.className = `morse-ref-grid cols-${tabCfg.cols}`;
    refs.morseRefGrid.innerHTML = '';
    renderedRefItems = [];

    for (const subGroup of groups) {
      if (tabCfg.vn && subGroup.title) {
        const subhead = document.createElement('div');
        subhead.className = 'morse-ref-subhead';
        subhead.textContent = subGroup.title;
        refs.morseRefGrid.appendChild(subhead);
      }

      for (const item of subGroup.items) {
        const cell = document.createElement('div');
        cell.className = 'morse-ref-item';

        const keyEl = document.createElement('span');
        keyEl.className = 'morse-ref-key';
        keyEl.textContent = item.key;

        cell.appendChild(keyEl);
        cell.appendChild(buildMorseCodeEl(item.code, tabCfg.spaced));
        refs.morseRefGrid.appendChild(cell);
        renderedRefItems.push({ el: cell, code: item.code });
      }
    }

    renderedRefTab = tabCfg.id;
  }

  function syncHudReferenceHighlights(previewCode, vnState, activeChar) {
    if (!renderedRefItems.length) return;
    const hasPrefix = Boolean(previewCode);
    const isVnMode = vnState && vnState !== VN_STATES.NORMAL;
    const filterByVn = activeRefTab === 3 && isVnMode && applyVietnameseCode && activeChar;

    for (const entry of renderedRefItems) {
      const allowedInContext = !filterByVn || applyVietnameseCode(activeChar, entry.code, vnState).ok;
      if (!allowedInContext) {
        entry.el.classList.add('is-dimmed');
        entry.el.classList.remove('match-exact', 'match-prefix');
        continue;
      }
      if (!hasPrefix) {
        entry.el.classList.remove('match-exact', 'match-prefix', 'is-dimmed');
      } else if (entry.code === previewCode) {
        entry.el.classList.add('match-exact');
        entry.el.classList.remove('match-prefix', 'is-dimmed');
      } else if (entry.code.startsWith(previewCode)) {
        entry.el.classList.add('match-prefix');
        entry.el.classList.remove('match-exact', 'is-dimmed');
      } else {
        entry.el.classList.add('is-dimmed');
        entry.el.classList.remove('match-exact', 'match-prefix');
      }
    }
  }

  function setupHudDragging(handle) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      if (e.target && e.target.tagName === 'BUTTON') return;
      dragging = true;
      userDraggedHud = true;
      const rect = hudHost.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      hudHost.style.transition = 'none';
      hudHost.style.right = 'auto';
      hudHost.style.bottom = 'auto';
      hudHost.style.left = `${startLeft}px`;
      hudHost.style.top = `${startTop}px`;
      e.preventDefault();
    });

    handle.addEventListener('dblclick', (e) => {
      if (e.target && e.target.tagName === 'BUTTON') return;
      userDraggedHud = false;
      repositionHud();
    });

    window.addEventListener('mousemove', (e) => {
      if (!dragging || !hudHost) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const maxX = Math.max(0, window.innerWidth - hudHost.offsetWidth);
      const maxY = Math.max(0, window.innerHeight - hudHost.offsetHeight);
      const nextLeft = Math.min(maxX, Math.max(0, startLeft + dx));
      const nextTop = Math.min(maxY, Math.max(0, startTop + dy));
      hudHost.style.left = `${nextLeft}px`;
      hudHost.style.top = `${nextTop}px`;
    });

    window.addEventListener('mouseup', () => {
      dragging = false;
    });
  }

  function syncHud() {
    const snap = engine.getSnapshot();

    if (!IS_TOP_FRAME) {
      try {
        const active = getActiveEditable();
        window.top.postMessage(
          {
            source: 'morse-by-mouse-frame',
            payload: {
              buffer: snap.buffer,
              isPressing: snap.isPressing,
              currentHoldSymbol: snap.currentHoldSymbol,
              vnState: snap.vnState,
              activeChar: snap.activeChar,
              statusNotice: snap.statusNotice,
              statusNoticeType: snap.statusNoticeType,
              targetLabel: describeTarget(active),
              targetRect: active ? getEditableVisualRect(active) : null
            }
          },
          '*'
        );
      } catch (_err) {}
      return;
    }

    if (!settings.showHud) {
      if (hudHost && hudHost.isConnected) {
        hudHost.style.display = 'none';
      }
      return;
    }

    const refs = ensureHud();
    if (!refs) return;
    hudHost.style.display = 'block';

    const state = externalState || {
      buffer: snap.buffer,
      isPressing: snap.isPressing,
      currentHoldSymbol: snap.currentHoldSymbol,
      vnState: snap.vnState,
      activeChar: snap.activeChar,
      statusNotice: snap.statusNotice,
      statusNoticeType: snap.statusNoticeType
    };

    const vnState = state.vnState || VN_STATES.NORMAL;
    const isVnMode = vnState !== VN_STATES.NORMAL;

    if (prevVnState === VN_STATES.NORMAL && isVnMode) {
      if (activeRefTab !== 3) {
        tabBeforeVn = activeRefTab;
        activeRefTab = 3;
        renderedRefTab = -1;
      }
    } else if (prevVnState !== VN_STATES.NORMAL && !isVnMode) {
      if (tabBeforeVn !== null) {
        activeRefTab = tabBeforeVn;
        tabBeforeVn = null;
        renderedRefTab = -1;
      }
    }
    prevVnState = vnState;

    const vnMeta = VN_STATE_META[vnState] || VN_STATE_META.NORMAL;
    if (refs.vnModeRow) {
      refs.vnModeRow.className = 'vn-mode-row';
      if (vnState === VN_STATES.WAITING_FOR_DIACRITIC) {
        refs.vnModeRow.classList.add('state-diacritic');
      } else if (vnState === VN_STATES.WAITING_FOR_TONE) {
        refs.vnModeRow.classList.add('state-tone');
      }
      refs.vnModeBadge.textContent = vnMeta.badge;
      refs.vnModeDesc.textContent = vnMeta.desc;
      if (state.activeChar) {
        refs.vnActiveChar.hidden = false;
        refs.vnActiveChar.textContent = `Chữ: ${state.activeChar}`;
      } else {
        refs.vnActiveChar.hidden = true;
      }
      if (refs.vnEscBtn) {
        refs.vnEscBtn.textContent = isVnMode ? 'Hủy ESC' : 'ESC Dấu';
        refs.vnEscBtn.classList.toggle('cancel', isVnMode);
      }
    }
    if (refs.vnNotice) {
      if (state.statusNotice) {
        refs.vnNotice.hidden = false;
        refs.vnNotice.textContent = state.statusNotice;
        refs.vnNotice.className =
          state.statusNoticeType === 'error' ? 'vn-notice error' : 'vn-notice';
      } else {
        refs.vnNotice.hidden = true;
      }
    }

    refs.card.classList.toggle('disabled', !settings.enabled);
    refs.toggleBtn.textContent = settings.enabled ? 'ON' : 'OFF';
    refs.toggleBtn.classList.toggle('active-on', settings.enabled);
    refs.soundBtn.textContent = settings.soundEnabled ? '🔊' : '🔇';

    const topActive = getActiveEditable();
    const targetLabel = topActive ? describeTarget(topActive) : state.targetLabel || null;
    if (targetLabel) {
      refs.targetPill.hidden = false;
      refs.targetPill.textContent = `✓ ${targetLabel}`;
      refs.targetPill.className = 'target-pill focused';
    } else if (settings.scope === 'inputs-only') {
      refs.targetPill.hidden = false;
      refs.targetPill.textContent = 'Chờ ô nhập';
      refs.targetPill.className = 'target-pill waiting';
    } else {
      refs.targetPill.hidden = true;
    }

    refs.statusDot.className = 'dot-status';
    if (settings.enabled) {
      if (state.isPressing) {
        refs.statusDot.classList.add(
          state.currentHoldSymbol === '-' ? 'pressing-dash' : 'pressing-dot'
        );
      } else {
        refs.statusDot.classList.add('on');
      }
    }

    // Build live sequence display with synchronized dot/dash glyphs & colors
    refs.morseSeq.innerHTML = '';
    if (state.buffer) {
      for (let i = 0; i < state.buffer.length; i++) {
        const sym = document.createElement('span');
        const isDot = state.buffer[i] === '.';
        sym.className = isDot ? 'sym-dot' : 'sym-dash';
        sym.textContent = isDot ? '·' : '—';
        refs.morseSeq.appendChild(sym);
      }
    }
    if (state.isPressing) {
      const live = document.createElement('span');
      live.className = state.currentHoldSymbol === '-' ? 'live-dash' : 'live-dot';
      live.textContent = state.currentHoldSymbol === '-' ? '—' : '·';
      refs.morseSeq.appendChild(live);
    }
    if (!state.buffer && !state.isPressing) {
      const ph = document.createElement('span');
      ph.className = 'placeholder';
      if (!settings.enabled) {
        ph.textContent = 'Đang tắt — nhấn Trái + Phải để bật';
      } else if (vnState === VN_STATES.WAITING_FOR_DIACRITIC) {
        ph.textContent = 'Nhập mã dấu tạo chữ / thanh điệu...';
      } else if (vnState === VN_STATES.WAITING_FOR_TONE) {
        ph.textContent = 'Nhập mã thanh điệu hoặc đổi dấu tạo chữ...';
      } else {
        ph.textContent = 'Nhấn chuột để gõ Morse...';
      }
      refs.morseSeq.appendChild(ph);
    }

    // Preview decoded character
    const previewCode = state.buffer + (state.isPressing ? state.currentHoldSymbol : '');
    const decoded =
      isVnMode && decodeVietnamesePreview
        ? decodeVietnamesePreview(previewCode, state.activeChar, vnState)
        : decodeMorse(previewCode, { letterCase: settings.letterCase });
    refs.previewChar.className = 'preview-char';
    if (decoded.kind === 'char') {
      refs.previewChar.textContent = decoded.char;
      refs.previewChar.classList.add('valid');
    } else if (decoded.kind === 'prefix') {
      refs.previewChar.textContent = '…';
      refs.previewChar.classList.add('prefix');
    } else if (decoded.kind === 'unknown') {
      refs.previewChar.textContent = '?';
      refs.previewChar.classList.add('invalid');
    } else if (isVnMode && state.activeChar) {
      refs.previewChar.textContent = state.activeChar;
      refs.previewChar.classList.add('vn-base');
    } else {
      refs.previewChar.textContent = '';
    }

    // Branch hints for next dot/dash
    const hints =
      isVnMode && getVietnameseNextHints
        ? getVietnameseNextHints(previewCode, state.activeChar, vnState)
        : getNextHints(previewCode, { letterCase: settings.letterCase });
    refs.hintDot.textContent = hints.dot || '×';
    refs.hintDot.classList.toggle('empty', !hints.dot);
    refs.hintDash.textContent = hints.dash || '×';
    refs.hintDash.classList.toggle('empty', !hints.dash);

    renderHudReference(refs);
    syncHudReferenceHighlights(previewCode, vnState, state.activeChar);
    repositionHud();
  }

  function updateProgressBars() {
    animRafId = null;
    if (!IS_TOP_FRAME || !hudRefs) return;

    const snap = engine.getSnapshot();
    const nowTs = performance.now();
    let keepRunning = false;

    if (snap.isPressing) {
      const elapsed = Math.max(0, nowTs - snap.pressStartTime);
      const pct = Math.min(100, (elapsed / snap.config.dashThresholdMs) * 100);
      hudRefs.holdBar.style.width = `${pct}%`;
      hudRefs.holdBar.classList.toggle('dash', elapsed >= snap.config.dashThresholdMs);
      keepRunning = true;
    } else {
      hudRefs.holdBar.style.width = '0%';
      hudRefs.holdBar.classList.remove('dash');
    }

    if (snap.letterDeadline > nowTs) {
      const remaining = snap.letterDeadline - nowTs;
      const pct = Math.min(100, Math.max(0, (remaining / snap.config.letterGapMs) * 100));
      hudRefs.gapBar.style.width = `${pct}%`;
      hudRefs.gapBar.className = 'bar-fill gap';
      keepRunning = true;
    } else if (snap.wordDeadline > nowTs) {
      const totalWordRem = Math.max(100, snap.config.wordGapMs - snap.config.letterGapMs);
      const remaining = snap.wordDeadline - nowTs;
      const pct = Math.min(100, Math.max(0, (remaining / totalWordRem) * 100));
      hudRefs.gapBar.style.width = `${pct}%`;
      hudRefs.gapBar.className = 'bar-fill word';
      keepRunning = true;
    } else {
      hudRefs.gapBar.style.width = '0%';
    }

    if (keepRunning) {
      animRafId = requestAnimationFrame(updateProgressBars);
    }
  }

  function ensureAnimLoop() {
    if (!IS_TOP_FRAME) return;
    if (animRafId === null) {
      animRafId = requestAnimationFrame(updateProgressBars);
    }
  }

  if (IS_TOP_FRAME) {
    window.addEventListener('message', (e) => {
      if (e.data && e.data.source === 'morse-by-mouse-frame' && e.data.payload) {
        externalState = e.data.payload;
        const frameEl = findIframeForSource(e.source);
        if (frameEl) {
          const fRect = frameEl.getBoundingClientRect();
          const inner = e.data.payload.targetRect;
          if (inner && Number.isFinite(inner.left)) {
            externalTargetRect = {
              left: fRect.left + inner.left,
              top: fRect.top + inner.top,
              right: fRect.left + inner.right,
              bottom: fRect.top + inner.bottom,
              width: inner.width,
              height: inner.height
            };
          } else {
            externalTargetRect = {
              left: fRect.left,
              top: fRect.top,
              right: fRect.right,
              bottom: fRect.bottom,
              width: fRect.width,
              height: fRect.height
            };
          }
        } else {
          externalTargetRect = null;
        }
        if (externalClearTimer !== null) {
          clearTimeout(externalClearTimer);
        }
        externalClearTimer = setTimeout(() => {
          externalState = null;
          externalTargetRect = null;
          externalClearTimer = null;
          syncHud();
        }, 3000);
        syncHud();
      }
    });
  }

  // --- Mouse Event Interception ---
  const INTERACTIVE_SELECTOR =
    'a[href], button, select, option, summary, label, video, audio, [onclick], ' +
    '[role="button"], [role="link"], [role="menuitem"], [role="menuitemcheckbox"], ' +
    '[role="menuitemradio"], [role="tab"], [role="option"], [role="checkbox"], ' +
    '[role="radio"], [role="switch"], [role="slider"]';

  function isEventInsideHud(e) {
    if (!hudHost) return false;
    const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
    return path.includes(hudHost);
  }

  function isInteractiveElement(target) {
    let cur = target;
    while (cur) {
      if (cur.nodeType === 1) {
        if (cur === document.body || cur === document.documentElement) return false;
        if (cur.tagName === 'INPUT' && !isEditableElement(cur)) return true;
        if (typeof cur.matches === 'function' && cur.matches(INTERACTIVE_SELECTOR)) {
          return true;
        }
      }
      if (cur.parentElement) {
        cur = cur.parentElement;
      } else if (cur.parentNode) {
        cur = cur.parentNode;
      } else {
        const rootNode = cur.getRootNode ? cur.getRootNode() : null;
        cur = rootNode && rootNode.host ? rootNode.host : null;
      }
    }
    return false;
  }

  function shouldInterceptMouseButton(e) {
    if (!settings.enabled) return false;
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return false;
    if (isEventInsideHud(e)) return false;

    const { tap, hold } = getButtonHandlers(settings.bindings, e.button);
    if (!tap && !hold) return false;

    if (
      (e.button === 0 || e.button === 1) &&
      (e.clientX > document.documentElement.clientWidth ||
        e.clientY > document.documentElement.clientHeight)
    ) {
      return false;
    }

    const pathTarget = typeof e.composedPath === 'function' ? e.composedPath()[0] : e.target;
    const clickedEditable = findEditableFromTarget(pathTarget);
    const activeEditable = getActiveEditable();

    if (e.button === 0) {
      if (clickedEditable && clickedEditable !== activeEditable) {
        return false;
      }
      if (!clickedEditable) {
        if (settings.scope === 'inputs-only' && !activeEditable) return false;
        if (isInteractiveElement(pathTarget)) return false;
      }
      return true;
    }

    if (e.button === 1) {
      if (settings.scope === 'inputs-only' && !clickedEditable && !activeEditable) {
        return false;
      }
      if (!clickedEditable && isInteractiveElement(pathTarget)) {
        return false;
      }
      return true;
    }

    if (settings.scope === 'inputs-only' && !clickedEditable && !activeEditable) {
      return false;
    }

    return true;
  }

  function scheduleSuppressReset() {
    if (suppressResetTimer !== null) clearTimeout(suppressResetTimer);
    suppressResetTimer = setTimeout(() => {
      suppressNextContextMenu = false;
      suppressResetTimer = null;
    }, 500);
  }

  function scheduleLeftSuppressReset() {
    if (leftSuppressResetTimer !== null) clearTimeout(leftSuppressResetTimer);
    leftSuppressResetTimer = setTimeout(() => {
      suppressNextLeftClick = false;
      leftSuppressResetTimer = null;
    }, 500);
  }

  function scheduleAuxReset() {
    if (auxResetTimer !== null) clearTimeout(auxResetTimer);
    auxResetTimer = setTimeout(() => {
      suppressAuxButton = null;
      auxResetTimer = null;
    }, 500);
  }

  window.addEventListener(
    'mousedown',
    (e) => {
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey && (e.button === 0 || e.button === 2)) {
        if (typeof e.buttons === 'number' && e.buttons !== 0) {
          if ((e.buttons & 1) === 0 && e.button !== 0) heldMouseButtons.delete(0);
          if ((e.buttons & 2) === 0 && e.button !== 2) heldMouseButtons.delete(2);
        }
        heldMouseButtons.add(e.button);
        const bothHeld =
          (heldMouseButtons.has(0) && heldMouseButtons.has(2)) ||
          (typeof e.buttons === 'number' && (e.buttons & 3) === 3);

        if (bothHeld && !isEventInsideHud(e)) {
          mouseController.cancel();
          chordConsumedButtons.add(0);
          chordConsumedButtons.add(2);
          suppressNextLeftClick = true;
          scheduleLeftSuppressReset();
          suppressNextContextMenu = true;
          scheduleSuppressReset();
          e.preventDefault();
          e.stopImmediatePropagation();
          togglePluginEnabled();
          return;
        }
      }

      if (!shouldInterceptMouseButton(e)) return;

      const pathTarget = typeof e.composedPath === 'function' ? e.composedPath()[0] : e.target;
      const clickedEditable = findEditableFromTarget(pathTarget);
      const activeEditable = getActiveEditable();
      if (
        e.button !== 0 &&
        clickedEditable &&
        clickedEditable !== activeEditable &&
        isEditableElement(clickedEditable)
      ) {
        clickedEditable.focus({ preventScroll: true });
        if (IS_TOP_FRAME) {
          externalState = null;
          externalTargetRect = null;
        }
        syncHud();
      }

      if (!mouseController.handleMouseDown(e.button)) return;

      e.preventDefault();
      e.stopImmediatePropagation();
      externalState = null;
      externalTargetRect = null;

      if (e.button === 0) {
        suppressNextLeftClick = true;
        scheduleLeftSuppressReset();
      } else if (e.button === 2) {
        suppressNextContextMenu = true;
        scheduleSuppressReset();
      } else {
        suppressAuxButton = e.button;
        scheduleAuxReset();
      }
    },
    true
  );

  window.addEventListener(
    'mouseup',
    (e) => {
      if (e.button === 0 || e.button === 2) {
        heldMouseButtons.delete(e.button);
      }
      if (chordConsumedButtons.has(e.button)) {
        chordConsumedButtons.delete(e.button);
        if (e.button === 0) {
          suppressNextLeftClick = true;
          scheduleLeftSuppressReset();
        } else if (e.button === 2) {
          suppressNextContextMenu = true;
          scheduleSuppressReset();
        }
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }

      if (mouseController.getActiveButton() !== e.button) return;
      mouseController.handleMouseUp(e.button);
      e.preventDefault();
      e.stopImmediatePropagation();

      if (e.button === 2) {
        suppressNextContextMenu = true;
        scheduleSuppressReset();
      } else if (e.button !== 0) {
        suppressAuxButton = e.button;
        scheduleAuxReset();
      }
    },
    true
  );

  window.addEventListener(
    'click',
    (e) => {
      if (e.button === 0 && suppressNextLeftClick) {
        e.preventDefault();
        e.stopImmediatePropagation();
        suppressNextLeftClick = false;
      }
    },
    true
  );

  window.addEventListener(
    'auxclick',
    (e) => {
      if (e.shiftKey) return;
      const activeBtn = mouseController.getActiveButton();
      if (
        (suppressAuxButton !== null && e.button === suppressAuxButton) ||
        (activeBtn !== null && e.button === activeBtn) ||
        (e.button === 2 && suppressNextContextMenu) ||
        (e.button >= 1 && shouldInterceptMouseButton(e))
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.button === suppressAuxButton) suppressAuxButton = null;
      }
    },
    true
  );

  window.addEventListener(
    'contextmenu',
    (e) => {
      if (e.shiftKey || isEventInsideHud(e)) return;
      const hasRightBinding = (() => {
        const h = getButtonHandlers(settings.bindings, 2);
        return Boolean(h.tap || h.hold);
      })();
      if (
        suppressNextContextMenu ||
        mouseController.getActiveButton() === 2 ||
        (hasRightBinding && shouldInterceptMouseButton(e))
      ) {
        e.preventDefault();
        e.stopImmediatePropagation();
        suppressNextContextMenu = false;
      }
    },
    true
  );

  window.addEventListener('blur', () => {
    clearMouseChordState();
    mouseController.cancel();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearMouseChordState();
      mouseController.cancel();
    }
  });

  let lastFocusedEditable = null;
  let suppressNextEscapeKeyup = false;

  window.addEventListener(
    'keydown',
    (e) => {
      if (
        !chrome?.runtime?.id &&
        e.altKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.shiftKey &&
        (e.code === 'KeyM' || (e.key && e.key.toLowerCase() === 'm'))
      ) {
        if (e.repeat) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        const nextShow = !settings.showHud;
        if (chrome?.storage?.local) {
          chrome.storage.local.set({ showHud: nextShow });
        }
        applySettings({ showHud: nextShow });
        return;
      }

      if (!settings.enabled) return;

      const activeEditable = getActiveEditable();
      const snap = engine.getSnapshot();
      const hasEngineContext =
        snap.vnState !== VN_STATES.NORMAL ||
        Boolean(snap.buffer) ||
        Boolean(snap.activeChar);

      if (
        e.key === 'Escape' &&
        !e.shiftKey &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey
      ) {
        if (e.repeat) return;
        if (!activeEditable && !hasEngineContext) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        suppressNextEscapeKeyup = true;
        triggerVietnameseMode();
        return;
      }

      if (activeEditable) {
        const isPrintable =
          e.key && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;
        if (
          isPrintable ||
          e.key === 'Backspace' ||
          e.key === 'Delete' ||
          e.key === 'Enter' ||
          e.key === 'Tab' ||
          (e.key && e.key.startsWith('Arrow')) ||
          e.key === 'Home' ||
          e.key === 'End'
        ) {
          engine.clearVietnameseContext();
        }
      }
    },
    true
  );

  window.addEventListener(
    'keyup',
    (e) => {
      if (e.key === 'Escape' && suppressNextEscapeKeyup) {
        suppressNextEscapeKeyup = false;
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true
  );

  document.addEventListener(
    'focusin',
    () => {
      const currentActive = getActiveEditable();
      if (currentActive !== lastFocusedEditable) {
        lastFocusedEditable = currentActive;
        engine.clearVietnameseContext();
      }
      if (IS_TOP_FRAME && currentActive) {
        externalState = null;
        externalTargetRect = null;
      }
      syncHud();
    },
    true
  );
  document.addEventListener('focusout', () => setTimeout(syncHud, 0), true);

  if (IS_TOP_FRAME) {
    window.addEventListener('resize', () => {
      repositionHud({ instant: true, clampDragged: true });
    });

    window.addEventListener(
      'scroll',
      () => {
        if (scrollRepositionRaf !== null) return;
        scrollRepositionRaf = requestAnimationFrame(() => {
          scrollRepositionRaf = null;
          repositionHud();
        });
      },
      true
    );
  }

  loadSettings();
  if (IS_TOP_FRAME) {
    syncHud();
  }
})();
