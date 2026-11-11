(function (root) {
  'use strict';

  const NON_TEXT_INPUT_TYPES = new Set([
    'button',
    'checkbox',
    'color',
    'date',
    'datetime-local',
    'file',
    'hidden',
    'image',
    'month',
    'radio',
    'range',
    'reset',
    'submit',
    'time',
    'week'
  ]);

  const EXPLICIT_CONTAINER_SELECTOR =
    '[role="textbox"], [role="searchbox"], [role="combobox"], .monaco-editor, .CodeMirror, .cm-editor';

  const EDITABLE_QUERY_SELECTOR =
    'textarea, input, [contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable=""]';

  const NON_EDITABLE_CONTROL_SELECTOR =
    'a[href], button, select, summary, [role="button"], [role="link"], [role="tab"]';

  function getDeepActiveElement(doc = typeof document !== 'undefined' ? document : null) {
    if (!doc) return null;
    let active = doc.activeElement;
    while (active && active.shadowRoot && active.shadowRoot.activeElement) {
      active = active.shadowRoot.activeElement;
    }
    return active;
  }

  function isElementDisabled(el) {
    if (!el) return true;
    if (el.disabled || el.readOnly) return true;
    if (typeof el.getAttribute === 'function' && el.getAttribute('aria-disabled') === 'true') {
      return true;
    }
    if (typeof el.hasAttribute === 'function' && el.hasAttribute('inert')) {
      return true;
    }
    return false;
  }

  function hasContentEditableAttr(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    if (typeof el.getAttribute !== 'function') return false;
    const raw = el.getAttribute('contenteditable');
    if (raw === null || raw === undefined) return false;
    const norm = String(raw).toLowerCase();
    return norm === '' || norm === 'true' || norm === 'plaintext-only';
  }

  function isEditableElement(el) {
    if (!el || el.nodeType !== 1 || el.isConnected === false) return false;
    if (isElementDisabled(el)) return false;

    const tag = el.tagName ? el.tagName.toUpperCase() : '';
    if (tag === 'TEXTAREA') {
      return true;
    }
    if (tag === 'INPUT') {
      const type = (el.type || 'text').toLowerCase();
      return !NON_TEXT_INPUT_TYPES.has(type);
    }

    if (typeof el.getAttribute === 'function') {
      const ce = el.getAttribute('contenteditable');
      if (ce && String(ce).toLowerCase() === 'false') return false;
    }

    return hasContentEditableAttr(el);
  }

  function getContentEditableHost(el) {
    let host = el;
    while (host && host.parentElement && isEditableElement(host.parentElement) && hasContentEditableAttr(host.parentElement)) {
      host = host.parentElement;
    }
    return host;
  }

  function normalizeEditable(el) {
    if (!el || !isEditableElement(el)) return null;
    const tag = el.tagName ? el.tagName.toUpperCase() : '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') return el;
    return getContentEditableHost(el);
  }

  function isVisibleInputCandidate(el) {
    if (!el) return false;
    if (typeof el.matches === 'function' && el.matches('.monaco-editor textarea.inputarea, .CodeMirror textarea')) {
      return true;
    }
    if (typeof el.getBoundingClientRect === 'function') {
      const rect = el.getBoundingClientRect();
      if (rect && rect.width <= 0 && rect.height <= 0) {
        return false;
      }
    }
    if (typeof getComputedStyle === 'function') {
      try {
        const style = getComputedStyle(el);
        if (style && (style.display === 'none' || style.visibility === 'hidden')) {
          return false;
        }
      } catch (_err) {}
    }
    return true;
  }

  function findEditableInContainer(container) {
    if (!container) return null;

    if (typeof container.querySelector === 'function') {
      const specialSelectors = ['.cm-content', 'textarea.inputarea', '.CodeMirror textarea'];
      for (const sel of specialSelectors) {
        const special = container.querySelector(sel);
        if (special && isEditableElement(special)) {
          return normalizeEditable(special);
        }
      }
    }

    if (typeof container.querySelectorAll === 'function') {
      const list = container.querySelectorAll(EDITABLE_QUERY_SELECTOR);
      const visibleMatches = [];
      for (const node of list) {
        if (isEditableElement(node) && isVisibleInputCandidate(node)) {
          const normalized = normalizeEditable(node);
          if (normalized && !visibleMatches.includes(normalized)) {
            visibleMatches.push(normalized);
          }
        }
      }
      if (visibleMatches.length === 1) {
        return visibleMatches[0];
      }
      if (
        visibleMatches.length > 1 &&
        typeof container.matches === 'function' &&
        container.matches(EXPLICIT_CONTAINER_SELECTOR)
      ) {
        return visibleMatches[0];
      }
    }

    return null;
  }

  function stepUpNode(cur) {
    if (!cur) return null;
    if (cur.parentElement) return cur.parentElement;
    if (cur.parentNode) return cur.parentNode;
    const rootNode = typeof cur.getRootNode === 'function' ? cur.getRootNode() : null;
    return rootNode && rootNode.host ? rootNode.host : null;
  }

  function isWrapperSizeCompact(el) {
    if (typeof el.getBoundingClientRect !== 'function') return true;
    const rect = el.getBoundingClientRect();
    if (!rect || rect.height <= 0 || rect.width < 40) return false;
    const vpWidth = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : 1920;
    return rect.height <= 260 && rect.width <= vpWidth * 0.96;
  }

  function findEditableFromTarget(target) {
    if (!target) return null;
    const startNode = target.nodeType === 1 ? target : stepUpNode(target);
    if (!startNode) return null;

    let cur = startNode;
    while (cur) {
      if (cur.nodeType === 1) {
        if (isEditableElement(cur)) {
          return normalizeEditable(cur);
        }
        if (cur.tagName && cur.tagName.toUpperCase() === 'LABEL' && cur.control && isEditableElement(cur.control)) {
          return normalizeEditable(cur.control);
        }
        if (typeof cur.matches === 'function' && cur.matches(EXPLICIT_CONTAINER_SELECTOR)) {
          const insideExplicit = findEditableInContainer(cur);
          if (insideExplicit) return insideExplicit;
        }
      }
      cur = stepUpNode(cur);
    }

    // Do not fall back from explicit interactive controls (e.g. submit/search buttons beside an input)
    if (typeof startNode.closest === 'function' && startNode.closest(NON_EDITABLE_CONTROL_SELECTOR)) {
      return null;
    }

    // Compact container fallback (right-clicking padding/placeholder wrapper around an input)
    cur = startNode;
    for (let depth = 0; cur && depth < 4; depth++) {
      if (cur.nodeType === 1) {
        const tag = cur.tagName ? cur.tagName.toUpperCase() : '';
        if (tag === 'BODY' || tag === 'HTML' || tag === 'FORM') break;

        if (isWrapperSizeCompact(cur)) {
          if (cur.shadowRoot) {
            const fromShadow = findEditableInContainer(cur.shadowRoot);
            if (fromShadow) return fromShadow;
          }
          const insideWrapper = findEditableInContainer(cur);
          if (insideWrapper) return insideWrapper;
        }
      }
      cur = stepUpNode(cur);
    }

    return null;
  }

  function getActiveEditable(doc = typeof document !== 'undefined' ? document : null) {
    if (!doc) return null;
    const active = getDeepActiveElement(doc);
    if (active && active !== doc.body && active !== doc.documentElement) {
      if (isEditableElement(active)) return normalizeEditable(active);
      if (active.shadowRoot) {
        const fromShadow = findEditableInContainer(active.shadowRoot);
        if (fromShadow) return fromShadow;
      }
      const resolved = findEditableFromTarget(active);
      if (resolved) return resolved;
    }

    // Selection anchor fallback for contenteditable editors when activeElement stays on body
    if (
      typeof window !== 'undefined' &&
      typeof window.getSelection === 'function' &&
      (!doc.hasFocus || doc.hasFocus())
    ) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && sel.anchorNode) {
        let cur = sel.anchorNode.nodeType === 1 ? sel.anchorNode : stepUpNode(sel.anchorNode);
        while (cur) {
          if (cur.nodeType === 1 && isEditableElement(cur) && hasContentEditableAttr(cur)) {
            return getContentEditableHost(cur);
          }
          cur = stepUpNode(cur);
        }
      }
    }

    return null;
  }

  function getEditableVisualRect(el) {
    if (!el || typeof el.getBoundingClientRect !== 'function') return null;
    const visualHost =
      (typeof el.closest === 'function' && el.closest('.monaco-editor, .CodeMirror, .cm-editor')) || el;
    const rect = visualHost.getBoundingClientRect();
    if (!rect || (rect.width <= 0 && rect.height <= 0)) return null;
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    };
  }

  const trackedRanges = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  const graphemeSegmenter =
    typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
      ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
      : null;

  function splitGraphemes(str) {
    if (!str) return [];
    if (graphemeSegmenter) {
      return Array.from(graphemeSegmenter.segment(str), (s) => s.segment);
    }
    const groups = [];
    for (const cp of str) {
      if (groups.length > 0 && /[\u0300-\u036f\u1ab0-\u1aff\u1dc0-\u1dff\u20d0-\u20ff\ufe20-\ufe2f]/.test(cp)) {
        groups[groups.length - 1] += cp;
      } else {
        groups.push(cp);
      }
    }
    return groups;
  }

  function findLastMatchSpan(str, endOffset, expectedPrev) {
    if (!str || endOffset <= 0) return 0;
    if (expectedPrev) {
      const nfcPrev = String(expectedPrev).normalize('NFC');
      const maxProbe = Math.min(6, endOffset);
      for (let k = 1; k <= maxProbe; k++) {
        if (str.slice(endOffset - k, endOffset).normalize('NFC') === nfcPrev) {
          return k;
        }
      }
      return 0;
    }
    const windowSlice = str.slice(Math.max(0, endOffset - 6), endOffset);
    const graphemes = splitGraphemes(windowSlice);
    return graphemes.length ? graphemes[graphemes.length - 1].length : 0;
  }

  function saveTrackedSelection(el) {
    if (!trackedRanges || !el || !el.isContentEditable) return;
    if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return;
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      try {
        trackedRanges.set(el, sel.getRangeAt(0).cloneRange());
      } catch (_err) {}
    }
  }

  function ensureFocus(el) {
    const deep = getDeepActiveElement();
    if (deep === el || (el.isContentEditable && deep && el.contains(deep))) {
      return;
    }
    let savedSel = null;
    if (
      el.isContentEditable &&
      typeof window !== 'undefined' &&
      typeof window.getSelection === 'function'
    ) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
        try {
          savedSel = sel.getRangeAt(0).cloneRange();
        } catch (_err) {}
      } else if (trackedRanges) {
        const prev = trackedRanges.get(el);
        if (prev && el.contains(prev.startContainer)) {
          savedSel = prev.cloneRange();
        }
      }
    }
    const prevStart =
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && typeof el.selectionStart === 'number'
        ? el.selectionStart
        : null;
    const prevEnd =
      (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && typeof el.selectionEnd === 'number'
        ? el.selectionEnd
        : null;

    el.focus({ preventScroll: true });

    if (prevStart !== null && prevEnd !== null && typeof el.setSelectionRange === 'function') {
      try {
        if (el.selectionStart !== prevStart || el.selectionEnd !== prevEnd) {
          el.setSelectionRange(prevStart, prevEnd);
        }
      } catch (_err) {}
    } else if (savedSel && typeof window.getSelection === 'function') {
      const sel = window.getSelection();
      if (sel) {
        try {
          sel.removeAllRanges();
          sel.addRange(savedSel);
        } catch (_err) {}
      }
    }
  }

  function ensureSelectionInContentEditable(el) {
    if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return;
    const sel = window.getSelection();
    if (!sel) return;
    if (sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      saveTrackedSelection(el);
      return;
    }
    if (trackedRanges) {
      const saved = trackedRanges.get(el);
      if (saved && el.contains(saved.startContainer)) {
        try {
          sel.removeAllRanges();
          sel.addRange(saved.cloneRange());
          return;
        } catch (_err) {}
      }
    }
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    sel.removeAllRanges();
    sel.addRange(range);
    saveTrackedSelection(el);
  }

  function setNativeInputValue(el, nextValue) {
    const view = el && el.ownerDocument ? el.ownerDocument.defaultView : null;
    const isTextarea = el.tagName === 'TEXTAREA';
    const Ctor = isTextarea
      ? (view && view.HTMLTextAreaElement) ||
        (typeof HTMLTextAreaElement !== 'undefined' ? HTMLTextAreaElement : null)
      : (view && view.HTMLInputElement) ||
        (typeof HTMLInputElement !== 'undefined' ? HTMLInputElement : null);
    const descriptor = Ctor && Ctor.prototype
      ? Object.getOwnPropertyDescriptor(Ctor.prototype, 'value')
      : null;
    if (descriptor && descriptor.set) {
      descriptor.set.call(el, nextValue);
    } else {
      el.value = nextValue;
    }
  }

  function dispatchInputEvent(el, inputType, data) {
    try {
      el.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          cancelable: false,
          inputType,
          data
        })
      );
    } catch (_err) {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function insertText(el, text) {
    if (!isEditableElement(el)) return false;
    ensureFocus(el);

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const prevVal = el.value;
      const prevStart = el.selectionStart;
      const prevEnd = el.selectionEnd;

      let ok = false;
      try {
        ok = document.execCommand('insertText', false, text);
      } catch (_err) {
        ok = false;
      }

      const unchanged =
        el.value === prevVal &&
        el.selectionStart === prevStart &&
        el.selectionEnd === prevEnd;

      if (!ok || unchanged) {
        if (typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
          const start = el.selectionStart;
          const end = el.selectionEnd;
          const nextValue = prevVal.slice(0, start) + text + prevVal.slice(end);
          setNativeInputValue(el, nextValue);
          const caret = start + text.length;
          try {
            el.setSelectionRange(caret, caret);
          } catch (_err) {}
        } else {
          setNativeInputValue(el, prevVal + text);
        }
        dispatchInputEvent(el, 'insertText', text);
      }
      return true;
    }

    // contenteditable element
    ensureSelectionInContentEditable(el);
    let ok = false;
    try {
      ok = document.execCommand('insertText', false, text);
    } catch (_err) {
      ok = false;
    }

      if (ok) {
        saveTrackedSelection(el);
      } else {
        const sel = window.getSelection();
        if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
          const range = sel.getRangeAt(0);
          range.deleteContents();
          const textNode = document.createTextNode(text);
          range.insertNode(textNode);
          range.setStartAfter(textNode);
          range.collapse(true);
          sel.removeAllRanges();
          sel.addRange(range);
          dispatchInputEvent(el, 'insertText', text);
          saveTrackedSelection(el);
        } else {
          el.appendChild(document.createTextNode(text));
          dispatchInputEvent(el, 'insertText', text);
        }
      }
      return true;
    }

  function deleteBackward(el) {
    if (!isEditableElement(el)) return false;
    ensureFocus(el);

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const prevVal = el.value;
      const prevStart = el.selectionStart;
      const prevEnd = el.selectionEnd;

      let ok = false;
      try {
        ok = document.execCommand('delete', false);
      } catch (_err) {
        ok = false;
      }

      if (!ok || (el.value === prevVal && prevStart === el.selectionStart)) {
        if (typeof prevStart === 'number' && typeof prevEnd === 'number') {
          if (prevStart !== prevEnd) {
            const nextVal = prevVal.slice(0, prevStart) + prevVal.slice(prevEnd);
            setNativeInputValue(el, nextVal);
            el.setSelectionRange(prevStart, prevStart);
            dispatchInputEvent(el, 'deleteContentBackward', null);
          } else if (prevStart > 0) {
            const nextVal = prevVal.slice(0, prevStart - 1) + prevVal.slice(prevStart);
            setNativeInputValue(el, nextVal);
            el.setSelectionRange(prevStart - 1, prevStart - 1);
            dispatchInputEvent(el, 'deleteContentBackward', null);
          }
        } else if (prevVal.length > 0) {
          setNativeInputValue(el, prevVal.slice(0, -1));
          dispatchInputEvent(el, 'deleteContentBackward', null);
        }
      }
      return true;
    }

    ensureSelectionInContentEditable(el);
    let ok = false;
    try {
      ok = document.execCommand('delete', false);
    } catch (_err) {
      ok = false;
    }
    if (!ok && typeof window !== 'undefined' && typeof window.getSelection === 'function') {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        if (!range.collapsed) {
          range.deleteContents();
          dispatchInputEvent(el, 'deleteContentBackward', null);
          ok = true;
        } else if (range.startContainer.nodeType === 3 && range.startOffset > 0) {
          const span = findLastMatchSpan(range.startContainer.nodeValue, range.startOffset, null);
          if (span > 0) {
            range.setStart(range.startContainer, range.startOffset - span);
            range.deleteContents();
            dispatchInputEvent(el, 'deleteContentBackward', null);
            ok = true;
          }
        }
      }
    }
    saveTrackedSelection(el);
    return ok;
  }

  function triggerEnter(el) {
    if (!isEditableElement(el)) return false;
    ensureFocus(el);

    if (el.tagName === 'TEXTAREA') {
      return insertText(el, '\n');
    }

    const keyInit = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true
    };
    const kd = new KeyboardEvent('keydown', keyInit);
    const notCanceled = el.dispatchEvent(kd);
    el.dispatchEvent(new KeyboardEvent('keypress', keyInit));
    el.dispatchEvent(new KeyboardEvent('keyup', keyInit));

    if (!notCanceled) {
      return true;
    }

    if (el.isContentEditable) {
      ensureSelectionInContentEditable(el);
      try {
        if (!document.execCommand('insertLineBreak', false)) {
          document.execCommand('insertParagraph', false);
        }
      } catch (_err) {}
      return true;
    }

    if (el.tagName === 'INPUT' && el.form) {
      try {
        if (typeof el.form.requestSubmit === 'function') {
          el.form.requestSubmit();
        } else {
          el.form.submit();
        }
      } catch (_err) {}
    }
    return true;
  }

  function findPreviousTextInBlock(root, startNode) {
    let cur = startNode;
    while (cur && cur !== root) {
      while (cur.previousSibling) {
        cur = cur.previousSibling;
        if (cur.nodeType === 1 && /^(BR|DIV|P|LI|BLOCKQUOTE)$/i.test(cur.tagName)) {
          return null;
        }
        let inner = cur;
        while (inner && inner.lastChild) {
          inner = inner.lastChild;
        }
        while (inner) {
          if (inner.nodeType === 3 && inner.nodeValue && inner.nodeValue.length > 0) {
            return inner;
          }
          if (inner === cur) break;
          inner = inner.previousSibling || inner.parentNode;
        }
      }
      cur = cur.parentNode;
      if (cur && cur.nodeType === 1 && cur !== root && /^(DIV|P|LI|BLOCKQUOTE)$/i.test(cur.tagName)) {
        return null;
      }
    }
    return null;
  }

  function getCharBeforeCaret(el) {
    if (!isEditableElement(el)) return null;

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const val = el.value || '';
      const start = typeof el.selectionStart === 'number' ? el.selectionStart : val.length;
      const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : val.length;
      if (start !== end || start <= 0) return null;
      const span = findLastMatchSpan(val, start, null);
      if (span <= 0) return null;
      return val.slice(start - span, start).normalize('NFC');
    }

    if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return null;
    const sel = window.getSelection();
    let range = null;
    if (sel && sel.rangeCount > 0 && el.contains(sel.anchorNode)) {
      range = sel.getRangeAt(0);
    } else if (trackedRanges) {
      const saved = trackedRanges.get(el);
      if (saved && el.contains(saved.startContainer)) {
        range = saved;
      }
    }
    if (!range || !range.collapsed) return null;

    if (range.startContainer.nodeType === 3 && range.startOffset > 0) {
      const str = range.startContainer.nodeValue || '';
      const span = findLastMatchSpan(str, range.startOffset, null);
      return span > 0 ? str.slice(range.startOffset - span, range.startOffset).normalize('NFC') : null;
    }

    let nodeForPrev = range.startContainer;
    if (nodeForPrev.nodeType === 1 && range.startOffset > 0) {
      let child = nodeForPrev.childNodes[range.startOffset - 1];
      while (child && child.lastChild) {
        if (child.nodeType === 1 && /^(BR|DIV|P|LI|BLOCKQUOTE)$/i.test(child.tagName)) {
          child = null;
          break;
        }
        child = child.lastChild;
      }
      if (child && child.nodeType === 3 && child.nodeValue) {
        const span = findLastMatchSpan(child.nodeValue, child.nodeValue.length, null);
        return span > 0 ? child.nodeValue.slice(-span).normalize('NFC') : null;
      }
      if (child) nodeForPrev = child;
    }

    const prevText = findPreviousTextInBlock(el, nodeForPrev);
    if (prevText && prevText.nodeValue) {
      const span = findLastMatchSpan(prevText.nodeValue, prevText.nodeValue.length, null);
      return span > 0 ? prevText.nodeValue.slice(-span).normalize('NFC') : null;
    }
    return null;
  }

  function replaceLastChar(el, text, expectedPrev) {
    if (!isEditableElement(el)) return false;
    ensureFocus(el);

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const val = el.value || '';
      const start = typeof el.selectionStart === 'number' ? el.selectionStart : val.length;
      const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : val.length;
      if (start !== end || start <= 0) return false;

      const span = findLastMatchSpan(val, start, expectedPrev);
      if (span <= 0) return false;
      const replaceFrom = start - span;
      const expectedValue = val.slice(0, replaceFrom) + text + val.slice(start);
      const nextCaret = replaceFrom + text.length;

      try {
        el.setSelectionRange(replaceFrom, start);
      } catch (_err) {}

      let ok = false;
      try {
        ok = document.execCommand('insertText', false, text);
      } catch (_err) {
        ok = false;
      }

      if (!ok || el.value !== expectedValue) {
        setNativeInputValue(el, expectedValue);
        try {
          el.setSelectionRange(nextCaret, nextCaret);
        } catch (_err) {}
        dispatchInputEvent(el, 'insertText', text);
      } else if (typeof el.selectionStart === 'number' && el.selectionStart !== nextCaret) {
        try {
          el.setSelectionRange(nextCaret, nextCaret);
        } catch (_err) {}
      }
      return true;
    }

    ensureSelectionInContentEditable(el);
    if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return false;
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || !el.contains(sel.anchorNode)) return false;

    const caretRange = sel.getRangeAt(0);
    if (!caretRange.collapsed) return false;

    let replaceRange = null;
    if (caretRange.startContainer.nodeType === 3 && caretRange.startOffset > 0) {
      const str = caretRange.startContainer.nodeValue || '';
      const span = findLastMatchSpan(str, caretRange.startOffset, expectedPrev);
      if (span <= 0) return false;
      replaceRange = document.createRange();
      replaceRange.setStart(caretRange.startContainer, caretRange.startOffset - span);
      replaceRange.setEnd(caretRange.startContainer, caretRange.startOffset);
    } else if (typeof sel.modify === 'function') {
      const backup = caretRange.cloneRange();
      sel.modify('extend', 'backward', 'character');
      if (sel.rangeCount > 0) {
        const candidate = sel.getRangeAt(0);
        const selectedStr = candidate.toString();
        const matches =
          el.contains(candidate.startContainer) &&
          selectedStr.length > 0 &&
          (!expectedPrev || selectedStr.normalize('NFC') === String(expectedPrev).normalize('NFC'));
        if (matches) {
          replaceRange = candidate;
        } else {
          sel.removeAllRanges();
          sel.addRange(backup);
          return false;
        }
      }
    }

    if (!replaceRange) return false;

    sel.removeAllRanges();
    sel.addRange(replaceRange);

    let ok = false;
    try {
      ok = document.execCommand('insertText', false, text);
    } catch (_err) {
      ok = false;
    }

    if (!ok) {
      replaceRange.deleteContents();
      const textNode = document.createTextNode(text);
      replaceRange.insertNode(textNode);
      replaceRange.setStartAfter(textNode);
      replaceRange.collapse(true);
      sel.removeAllRanges();
      sel.addRange(replaceRange);
      dispatchInputEvent(el, 'insertText', text);
    }
    saveTrackedSelection(el);
    return true;
  }

  const api = {
    getDeepActiveElement,
    isEditableElement,
    getContentEditableHost,
    findEditableFromTarget,
    getActiveEditable,
    getEditableVisualRect,
    getCharBeforeCaret,
    insertText,
    deleteBackward,
    replaceLastChar,
    triggerEnter
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.MorseTextInserter = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
