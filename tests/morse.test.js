'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const MorseTable = require('../src/morse-table.js');
const VietnameseMorse = require('../src/vietnamese-morse.js');
const { createMorseEngine } = require('../src/morse-engine.js');
const MorseBindings = require('../src/morse-bindings.js');
const MorseTextInserter = require('../src/text-inserter.js');
const MorseHudLayout = require('../src/hud-layout.js');

function createFakeClock() {
  let time = 1000;
  let nextId = 1;
  const timers = new Map();

  function setTimer(fn, delay) {
    const id = nextId++;
    timers.set(id, { id, at: time + delay, fn });
    return id;
  }

  function clearTimer(id) {
    timers.delete(id);
  }

  function advance(ms) {
    const target = time + ms;
    while (true) {
      let earliest = null;
      for (const t of timers.values()) {
        if (t.at <= target && (!earliest || t.at < earliest.at)) {
          earliest = t;
        }
      }
      if (!earliest) break;
      timers.delete(earliest.id);
      time = earliest.at;
      earliest.fn();
    }
    time = target;
  }

  return {
    now: () => time,
    setTimer,
    clearTimer,
    advance
  };
}

test('MorseTable decodes letters, digits, and punctuation', () => {
  assert.deepEqual(MorseTable.decodeMorse('.-', { letterCase: 'lower' }), {
    kind: 'char',
    char: 'a',
    rawChar: 'A',
    code: '.-'
  });
  assert.deepEqual(MorseTable.decodeMorse('.-', { letterCase: 'upper' }), {
    kind: 'char',
    char: 'A',
    rawChar: 'A',
    code: '.-'
  });
  assert.equal(MorseTable.decodeMorse('...---...').kind, 'unknown');
  assert.equal(MorseTable.decodeMorse('-----').char, '0');
  assert.equal(MorseTable.decodeMorse('.-.-.-').char, '.');
  assert.equal(MorseTable.decodeMorse('..--').kind, 'unknown');
  assert.equal(MorseTable.decodeMorse('........').kind, 'unknown');
  assert.equal(MorseTable.decodeMorse('.-.-').kind, 'unknown');
  assert.equal(MorseTable.decodeMorse('----').kind, 'unknown');
});

test('MorseTable provides accurate next-signal hints and visual formatting', () => {
  assert.deepEqual(MorseTable.getNextHints('', { letterCase: 'lower' }), {
    dot: 'e',
    dash: 't'
  });
  assert.deepEqual(MorseTable.getNextHints('.', { letterCase: 'upper' }), {
    dot: 'I',
    dash: 'A'
  });
  assert.equal(MorseTable.formatVisualMorse('.-'), '· —');
});

test('MorseEngine distinguishes short dot click vs held dash', () => {
  const clock = createFakeClock();
  const events = [];
  const engine = createMorseEngine({
    morseTable: MorseTable,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    config: { dashThresholdMs: 200, letterGapMs: 600, wordGapMs: 1400, autoSpace: true },
    onThresholdCrossed: () => events.push('threshold'),
    onSignalAdded: (sym) => events.push(`sig:${sym}`),
    onCommit: (res) => events.push(`commit:${res.char || res.action || res.kind}`),
    onWordSpace: () => events.push('space')
  });

  // Short click (80ms) -> dot
  engine.pressStart();
  clock.advance(80);
  assert.equal(engine.pressEnd(), '.');

  // Held press (250ms) -> dash
  clock.advance(100);
  engine.pressStart();
  clock.advance(250);
  assert.equal(engine.pressEnd(), '-');

  // Wait for letter gap (600ms) -> commits 'a'
  clock.advance(600);
  // Wait remaining word gap (1400 - 600 = 800ms) -> auto space
  clock.advance(800);

  assert.deepEqual(events, [
    'sig:.',
    'threshold',
    'sig:-',
    'commit:a',
    'space'
  ]);
});

test('MorseEngine boundary duration === dashThresholdMs produces dash', () => {
  const clock = createFakeClock();
  const engine = createMorseEngine({
    morseTable: MorseTable,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    config: { dashThresholdMs: 200 }
  });

  engine.pressStart();
  clock.advance(200);
  assert.equal(engine.pressEnd(), '-');
});

test('MorseEngine composes multi-letter words and skips auto-space after unknown codes', () => {
  const clock = createFakeClock();
  let output = '';
  const engine = createMorseEngine({
    morseTable: MorseTable,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    config: { dashThresholdMs: 200, letterGapMs: 500, wordGapMs: 1200, autoSpace: true },
    onCommit: (res) => {
      if (res.kind === 'char') output += res.char;
    },
    onWordSpace: () => {
      output += ' ';
    }
  });

  function tap(holdMs, gapAfterMs) {
    engine.pressStart();
    clock.advance(holdMs);
    engine.pressEnd();
    clock.advance(gapAfterMs);
  }

  // 'h' = ....
  tap(60, 80);
  tap(60, 80);
  tap(60, 80);
  tap(60, 500); // commits 'h'

  // 'i' = ..
  tap(60, 80);
  tap(60, 1200); // commits 'i' then auto space

  // Unknown code = ..-- (must NOT insert character or trigger extra trailing space)
  tap(60, 80);
  tap(60, 80);
  tap(220, 80);
  tap(220, 2000);

  assert.equal(output, 'hi ');
});

test('MorseEngine cancelPress and reset prevent stray outputs', () => {
  const clock = createFakeClock();
  const committed = [];
  const engine = createMorseEngine({
    morseTable: MorseTable,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    onCommit: (res) => committed.push(res)
  });

  engine.pressStart();
  clock.advance(100);
  engine.cancelPress();
  clock.advance(2000);
  assert.equal(committed.length, 0);
  assert.equal(engine.getSnapshot().isPressing, false);

  engine.pressStart();
  clock.advance(50);
  engine.pressEnd();
  engine.reset();
  clock.advance(2000);
  assert.equal(committed.length, 0);
  assert.equal(engine.getSnapshot().buffer, '');
});

test('MorseEngine triggerSpace flushes pending letter and inserts 1 space per click', () => {
  const clock = createFakeClock();
  let output = '';
  const engine = createMorseEngine({
    morseTable: MorseTable,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    config: { dashThresholdMs: 200, letterGapMs: 600, wordGapMs: 1400, autoSpace: true },
    onCommit: (res) => {
      if (res.kind === 'char') output += res.char;
    },
    onWordSpace: () => {
      output += ' ';
    }
  });

  // Tap 'a' (.-) then immediately triggerSpace without waiting letterGapMs
  engine.pressStart();
  clock.advance(60);
  engine.pressEnd();
  clock.advance(80);
  engine.pressStart();
  clock.advance(240);
  engine.pressEnd();

  assert.equal(engine.triggerSpace(), true);
  assert.equal(output, 'a ');

  // Advancing past letterGapMs/wordGapMs must NOT double-space
  clock.advance(2000);
  assert.equal(output, 'a ');

  // Clicking space again adds 1 more space
  assert.equal(engine.triggerSpace(), true);
  assert.equal(output, 'a  ');

  // Ignored while right-button press is active
  engine.pressStart();
  assert.equal(engine.triggerSpace(), false);
  engine.cancelPress();
});

test('MorseEngine triggerDelete pops pending signal first, then deletes committed chars', () => {
  const clock = createFakeClock();
  let output = 'hi';
  const signals = [];
  const engine = createMorseEngine({
    morseTable: MorseTable,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    config: { dashThresholdMs: 200, letterGapMs: 600, autoSpace: false },
    onCommit: (res) => {
      if (res.kind === 'char') output += res.char;
    },
    onDeleteSignal: (buf) => signals.push(buf),
    onDeleteChar: () => {
      output = output.slice(0, -1);
    }
  });

  // Tap '..' then mistakenly '-' (..- instead of ..)
  engine.pressStart();
  clock.advance(50);
  engine.pressEnd();
  clock.advance(60);
  engine.pressStart();
  clock.advance(50);
  engine.pressEnd();
  clock.advance(60);
  engine.pressStart();
  clock.advance(250);
  engine.pressEnd();

  // First delete pops '-' -> buffer becomes '..'
  assert.equal(engine.triggerDelete(), 'signal');
  assert.equal(engine.getSnapshot().buffer, '..');

  // Wait letterGapMs -> commits 'i'
  clock.advance(600);
  assert.equal(output, 'hii');

  // Now buffer is empty -> triggerDelete deletes committed char
  assert.equal(engine.triggerDelete(), 'char');
  assert.equal(output, 'hi');

  // Popping single-signal buffer cancels letter cleanly without committing anything
  engine.pressStart();
  clock.advance(50);
  engine.pressEnd();
  assert.equal(engine.triggerDelete(), 'signal');
  assert.equal(engine.getSnapshot().buffer, '');
  clock.advance(1000);
  assert.equal(output, 'hi');
  assert.deepEqual(signals, ['..', '']);
});

test('MorseEngine pushSignal supports direct tap-bound dots/dashes and ignores invalid symbols', () => {
  const clock = createFakeClock();
  let output = '';
  const signals = [];

  const engine = createMorseEngine({
    morseTable: MorseTable,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    config: { letterGapMs: 500, wordGapMs: 1200, autoSpace: false },
    onSignalAdded: (_sym, buf) => signals.push(buf),
    onCommit: (res) => {
      if (res.kind === 'char') output += res.char;
    }
  });

  assert.equal(engine.pushSignal('.'), '.');
  assert.equal(engine.pushSignal('-'), '-');
  assert.equal(engine.pushSignal('x'), null);
  assert.equal(engine.getSnapshot().buffer, '.-');

  clock.advance(500);
  assert.equal(output, 'a');
  assert.equal(engine.getSnapshot().buffer, '');
  assert.deepEqual(signals, ['.', '.-']);
});

test('MorseBindings assignBinding preserves dot+dash on same button and replaces conflicting (button, mode)', () => {
  const initial = MorseBindings.cloneDefaultBindings();

  // Default should put dot tap and dash hold on button 2 without conflict
  const r0 = MorseBindings.assignBinding(initial, 'dot', { button: 2, mode: 'tap' });
  assert.equal(r0.replacedAction, null);
  assert.deepEqual(r0.bindings.dot, { button: 2, mode: 'tap' });
  assert.deepEqual(r0.bindings.dash, { button: 2, mode: 'hold' });

  // Assigning space tap to button 2 tap should replace dot (same button & mode), leaving dash hold intact
  const r1 = MorseBindings.assignBinding(r0.bindings, 'space', { button: 2, mode: 'tap' });
  assert.equal(r1.replacedAction, 'dot');
  assert.equal(r1.bindings.dot, null);
  assert.deepEqual(r1.bindings.dash, { button: 2, mode: 'hold' });
  assert.deepEqual(r1.bindings.space, { button: 2, mode: 'tap' });

  // Assigning null clears an action
  const r2 = MorseBindings.assignBinding(r1.bindings, 'space', null);
  assert.equal(r2.replacedAction, null);
  assert.equal(r2.bindings.space, null);
});

test('MorseBindings getButtonHandlers, migrateLegacySettingsToBindings, and formatFooterSummary', () => {
  const defaults = MorseBindings.cloneDefaultBindings();
  const rightHandlers = MorseBindings.getButtonHandlers(defaults, 2);
  assert.equal(rightHandlers.tap, 'dot');
  assert.equal(rightHandlers.hold, 'dash');

  const leftHandlers = MorseBindings.getButtonHandlers(defaults, 0);
  assert.equal(leftHandlers.tap, 'space');
  assert.equal(leftHandlers.hold, null);

  const midHandlers = MorseBindings.getButtonHandlers(defaults, 1);
  assert.equal(midHandlers.tap, 'delete');
  assert.equal(midHandlers.hold, null);

  // Legacy migration: disabled leftClickSpace + side-back deleteMacro
  const migrated = MorseBindings.migrateLegacySettingsToBindings({
    leftClickSpace: false,
    deleteMacro: 'side-back',
    deleteCustomButton: 3
  });
  assert.equal(migrated.space, null);
  assert.deepEqual(migrated.delete, { button: 3, mode: 'tap' });

  // Legacy migration: left-hold deleteMacro + custom button 4
  const migratedHold = MorseBindings.migrateLegacySettingsToBindings({
    leftClickSpace: true,
    deleteMacro: 'left-hold'
  });
  assert.deepEqual(migratedHold.space, { button: 0, mode: 'tap' });
  assert.deepEqual(migratedHold.delete, { button: 0, mode: 'hold' });

  const migratedCustom = MorseBindings.migrateLegacySettingsToBindings({
    leftClickSpace: true,
    deleteMacro: 'custom',
    deleteCustomButton: 4
  });
  assert.deepEqual(migratedCustom.delete, { button: 4, mode: 'tap' });

  const summary = MorseBindings.formatFooterSummary(defaults);
  assert.equal(typeof summary, 'string');
  assert.ok(summary.length > 0);
});

test('MorseHudLayout dodges overlapping bottom-right and bottom-wide input boxes', () => {
  const base = {
    viewportWidth: 1440,
    viewportHeight: 900,
    hudWidth: 326,
    hudHeight: 340,
    margin: 16,
    pad: 14
  };

  // No target -> default bottom-right
  const idlePos = MorseHudLayout.computeSmartHudPosition({ ...base, targetRect: null });
  assert.equal(idlePos.corner, 'bottom-right');

  // Top search bar -> stays bottom-right
  const topInputPos = MorseHudLayout.computeSmartHudPosition({
    ...base,
    targetRect: { left: 400, top: 20, right: 900, bottom: 64, width: 500, height: 44 }
  });
  assert.equal(topInputPos.corner, 'bottom-right');

  // Bottom-right chat popup -> dodges to bottom-left
  const bottomRightChatPos = MorseHudLayout.computeSmartHudPosition({
    ...base,
    targetRect: { left: 1080, top: 520, right: 1410, bottom: 880, width: 330, height: 360 }
  });
  assert.equal(bottomRightChatPos.corner, 'bottom-left');
  assert.equal(bottomRightChatPos.left, 16);

  // Full-width bottom composer overlapping both bottom corners -> dodges to top-right
  const wideBottomComposer = MorseHudLayout.computeSmartHudPosition({
    ...base,
    targetRect: { left: 200, top: 720, right: 1250, bottom: 870, width: 1050, height: 150 }
  });
  assert.equal(wideBottomComposer.corner, 'top-right');
  assert.equal(wideBottomComposer.top, 16);

  // Tall full-width editor starting below a top header -> chooses top corner with less overlap
  const tallEditor = MorseHudLayout.computeSmartHudPosition({
    ...base,
    targetRect: { left: 0, top: 80, right: 1440, bottom: 900, width: 1440, height: 820 }
  });
  assert.equal(tallEditor.corner, 'top-right');
});

test('MorseTextInserter recognizes editable elements, nested contenteditable hosts, labels, and compact wrappers', () => {
  const makeEl = (props) => ({
    nodeType: 1,
    isConnected: true,
    disabled: false,
    readOnly: false,
    isContentEditable: false,
    getAttribute: () => null,
    hasAttribute: () => false,
    matches: () => false,
    closest: () => null,
    ...props
  });

  const textarea = makeEl({ tagName: 'TEXTAREA' });
  const textInput = makeEl({ tagName: 'INPUT', type: 'search' });
  const checkbox = makeEl({ tagName: 'INPUT', type: 'checkbox' });
  const disabledInput = makeEl({ tagName: 'INPUT', type: 'text', disabled: true });
  const ariaDisabledInput = makeEl({
    tagName: 'INPUT',
    type: 'text',
    getAttribute: (attr) => (attr === 'aria-disabled' ? 'true' : null)
  });

  assert.equal(MorseTextInserter.isEditableElement(textarea), true);
  assert.equal(MorseTextInserter.isEditableElement(textInput), true);
  assert.equal(MorseTextInserter.isEditableElement(checkbox), false);
  assert.equal(MorseTextInserter.isEditableElement(disabledInput), false);
  assert.equal(MorseTextInserter.isEditableElement(ariaDisabledInput), false);

  // Nested paragraph inside contenteditable host resolves to outermost host
  const ceHost = makeEl({
    tagName: 'DIV',
    isContentEditable: true,
    parentElement: null
  });
  const ceParagraph = makeEl({
    tagName: 'P',
    isContentEditable: true,
    parentElement: ceHost
  });
  assert.equal(MorseTextInserter.findEditableFromTarget(ceParagraph), ceHost);

  // Clicking a <label> with .control resolves to the associated input
  const label = makeEl({
    tagName: 'LABEL',
    control: textInput
  });
  assert.equal(MorseTextInserter.findEditableFromTarget(label), textInput);

  // Clicking wrapper padding inside [role="textbox"] resolves to nested editor; clicking sibling button does not
  const innerEditor = makeEl({
    tagName: 'DIV',
    isContentEditable: true,
    getBoundingClientRect: () => ({ width: 300, height: 32 })
  });
  const roleTextbox = makeEl({
    tagName: 'DIV',
    matches: (sel) => sel.includes('[role="textbox"]'),
    querySelector: () => null,
    querySelectorAll: () => [innerEditor],
    getBoundingClientRect: () => ({ left: 10, top: 10, right: 410, bottom: 60, width: 400, height: 50 })
  });
  const placeholderSpan = makeEl({
    tagName: 'SPAN',
    parentElement: roleTextbox
  });
  assert.equal(MorseTextInserter.findEditableFromTarget(placeholderSpan), innerEditor);

  const sendButton = makeEl({
    tagName: 'BUTTON',
    closest: (sel) => (sel.includes('button') ? {} : null)
  });
  assert.equal(MorseTextInserter.findEditableFromTarget(sendButton), null);
});

function createEngineHarness(initialConfig = {}) {
  const timers = createFakeClock();
  let output = '';
  const errors = [];
  const stateHistory = [];

  const engine = createMorseEngine({
    morseTable: MorseTable,
    vietnameseMorse: VietnameseMorse,
    now: timers.now,
    setTimer: timers.setTimer,
    clearTimer: timers.clearTimer,
    config: initialConfig,
    onCommit: (res) => {
      if (res.kind === 'char') {
        output += res.char;
      }
    },
    onReplaceChar: (nextChar) => {
      output = output.slice(0, -1) + nextChar;
    },
    onWordSpace: () => {
      output += ' ';
    },
    onDeleteChar: () => {
      output = output.slice(0, -1);
    },
    onError: (err) => {
      errors.push(err);
    },
    onStateChange: (snap) => {
      stateHistory.push(snap.vnState);
    }
  });

  function sendSignals(code) {
    for (const ch of code) {
      engine.pushSignal(ch);
      timers.advance(50);
    }
    timers.advance(650);
  }

  return {
    engine,
    timers,
    sendSignals,
    getOutput: () => output,
    getErrors: () => errors,
    getStateHistory: () => stateHistory
  };
}

test('VietnameseMorse: all required vowels, modifiers, tones & đ/Đ produce exact NFC output', () => {
  const toneCodes = ['', '..', '--', '.-.', '-.-', '...-'];

  const singleVowels = [
    { baseCode: '.-', expected: ['a', 'á', 'à', 'ả', 'ã', 'ạ'] },
    { baseCode: '.', expected: ['e', 'é', 'è', 'ẻ', 'ẽ', 'ẹ'] },
    { baseCode: '..', expected: ['i', 'í', 'ì', 'ỉ', 'ĩ', 'ị'] },
    { baseCode: '---', expected: ['o', 'ó', 'ò', 'ỏ', 'õ', 'ọ'] },
    { baseCode: '..-', expected: ['u', 'ú', 'ù', 'ủ', 'ũ', 'ụ'] },
    { baseCode: '-.--', expected: ['y', 'ý', 'ỳ', 'ỷ', 'ỹ', 'ỵ'] }
  ];

  for (const letterCase of ['lower', 'upper']) {
    for (const row of singleVowels) {
      for (let tIdx = 0; tIdx < toneCodes.length; tIdx++) {
        const h = createEngineHarness({ letterCase });
        h.sendSignals(row.baseCode);
        if (toneCodes[tIdx]) {
          const escRes = h.engine.triggerEscape();
          assert.equal(escRes.ok, true);
          assert.equal(escRes.state, 'WAITING_FOR_DIACRITIC');
          h.sendSignals(toneCodes[tIdx]);
        }
        const want = (letterCase === 'upper' ? row.expected[tIdx].toUpperCase() : row.expected[tIdx]).normalize('NFC');
        assert.equal(h.getOutput(), want);
        assert.equal(h.getOutput(), h.getOutput().normalize('NFC'));
        assert.equal(h.engine.getSnapshot().vnState, 'NORMAL');
      }
    }
  }

  const modifiedVowels = [
    { baseCode: '.-', modCode: '.-', expected: ['ă', 'ắ', 'ằ', 'ẳ', 'ẵ', 'ặ'] },
    { baseCode: '.-', modCode: '-...', expected: ['â', 'ấ', 'ầ', 'ẩ', 'ẫ', 'ậ'] },
    { baseCode: '.', modCode: '-.-.', expected: ['ê', 'ế', 'ề', 'ể', 'ễ', 'ệ'] },
    { baseCode: '---', modCode: '-..', expected: ['ô', 'ố', 'ồ', 'ổ', 'ỗ', 'ộ'] },
    { baseCode: '---', modCode: '.', expected: ['ơ', 'ớ', 'ờ', 'ở', 'ỡ', 'ợ'] },
    { baseCode: '..-', modCode: '..-', expected: ['ư', 'ứ', 'ừ', 'ử', 'ữ', 'ự'] }
  ];

  for (const letterCase of ['lower', 'upper']) {
    for (const row of modifiedVowels) {
      for (let tIdx = 0; tIdx < toneCodes.length; tIdx++) {
        const h = createEngineHarness({ letterCase });
        h.sendSignals(row.baseCode);
        const esc1 = h.engine.triggerEscape();
        assert.equal(esc1.ok, true);
        assert.equal(esc1.state, 'WAITING_FOR_DIACRITIC');
        h.sendSignals(row.modCode);
        assert.equal(h.engine.getSnapshot().vnState, 'NORMAL');

        if (toneCodes[tIdx]) {
          const esc2 = h.engine.triggerEscape();
          assert.equal(esc2.ok, true);
          assert.equal(esc2.state, 'WAITING_FOR_TONE');
          h.sendSignals(toneCodes[tIdx]);
        }

        const want = (letterCase === 'upper' ? row.expected[tIdx].toUpperCase() : row.expected[tIdx]).normalize('NFC');
        assert.equal(h.getOutput(), want);
        assert.equal(h.getOutput(), h.getOutput().normalize('NFC'));
        assert.equal(h.engine.getSnapshot().vnState, 'NORMAL');
      }
    }
  }

  // đ and Đ
  for (const [letterCase, want] of [
    ['lower', 'đ'],
    ['upper', 'Đ']
  ]) {
    const h = createEngineHarness({ letterCase });
    h.sendSignals('-..'); // D
    const esc = h.engine.triggerEscape();
    assert.equal(esc.ok, true);
    h.sendSignals('-..-'); // Đ
    assert.equal(h.getOutput(), want);
    assert.equal(h.engine.getSnapshot().vnState, 'NORMAL');
  }
});

test('VietnameseMorse: edge cases - empty ESC, invalid diacritic, duplicate tone, delete during diacritic mode & cancellation', () => {
  const h = createEngineHarness();

  // 1. Pressing ESC when no base char exists stays NORMAL and reports error
  const emptyEsc = h.engine.triggerEscape();
  assert.equal(emptyEsc.ok, false);
  assert.equal(h.engine.getSnapshot().vnState, 'NORMAL');
  assert.equal(h.getErrors().length, 1);

  // 2. Non-vowel consonant (B) refuses ESC
  h.sendSignals('-...'); // b
  const bEsc = h.engine.triggerEscape();
  assert.equal(bEsc.ok, false);
  assert.equal(h.engine.getSnapshot().vnState, 'NORMAL');
  assert.equal(h.getOutput(), 'b');

  // 3. Invalid diacritic code preserves base char 'a' and stays in WAITING_FOR_DIACRITIC for retry
  h.sendSignals('.-'); // ba
  const aEsc = h.engine.triggerEscape();
  assert.equal(aEsc.ok, true);
  assert.equal(aEsc.state, 'WAITING_FOR_DIACRITIC');
  assert.equal(
    h.engine.getSnapshot().statusNotice,
    'Vietnamese Diacritic Mode – Enter tone or character modifier'
  );

  h.sendSignals('----'); // invalid diacritic code
  assert.equal(h.getOutput(), 'ba'); // base char preserved!
  assert.equal(h.engine.getSnapshot().vnState, 'WAITING_FOR_DIACRITIC');

  // Incompatible modifier (-.-. is Ê, not valid on A) preserves 'a' and allows retry
  h.sendSignals('-.-.');
  assert.equal(h.getOutput(), 'ba');
  assert.equal(h.engine.getSnapshot().vnState, 'WAITING_FOR_DIACRITIC');

  // 4. Delete buffered signal while in diacritic mode stays in WAITING_FOR_DIACRITIC, then complete ă (.-)
  h.engine.pushSignal('.');
  h.engine.pushSignal('.'); // intended .- but typed ..
  const delSig = h.engine.triggerDelete();
  assert.equal(delSig, 'signal');
  assert.equal(h.engine.getSnapshot().buffer, '.');
  assert.equal(h.engine.getSnapshot().vnState, 'WAITING_FOR_DIACRITIC');
  h.engine.pushSignal('-');
  h.timers.advance(650);
  assert.equal(h.getOutput(), 'bă');
  assert.equal(h.engine.getSnapshot().vnState, 'NORMAL');

  // 5. Waiting for tone: rejecting modifiers in Tone Mode & accepting Sắc (..) -> bắ
  const escTone = h.engine.triggerEscape();
  assert.equal(escTone.ok, true);
  assert.equal(escTone.state, 'WAITING_FOR_TONE');
  h.sendSignals('-...'); // Â modifier rejected in Tone Mode
  assert.equal(h.getOutput(), 'bă');
  assert.equal(h.engine.getSnapshot().vnState, 'WAITING_FOR_TONE');
  h.sendSignals('..'); // Sắc
  assert.equal(h.getOutput(), 'bắ');
  assert.equal(h.engine.getSnapshot().vnState, 'NORMAL');

  // 6. Reject applying a second tone mark onto 'á'
  const hDup = createEngineHarness();
  hDup.sendSignals('.-'); // a
  hDup.engine.triggerEscape();
  hDup.sendSignals('..'); // á
  assert.equal(hDup.getOutput(), 'á');
  hDup.engine.triggerEscape(); // 'a' still has possible modifiers, enters WAITING_FOR_DIACRITIC
  hDup.sendSignals('--'); // try adding Huyền onto á -> rejected!
  assert.equal(hDup.getOutput(), 'á');
  // Cancelling via second ESC returns cleanly to NORMAL without changing 'á'
  const cancelRes = hDup.engine.triggerEscape();
  assert.equal(cancelRes.ok, true);
  assert.equal(cancelRes.action, 'cancelled');
  assert.equal(hDup.engine.getSnapshot().vnState, 'NORMAL');
  assert.equal(hDup.getOutput(), 'á');

  // 7. Delete when buffer is empty in diacritic mode removes base char and returns to NORMAL
  const hDelEmpty = createEngineHarness();
  hDelEmpty.sendSignals('.-'); // a
  hDelEmpty.engine.triggerEscape();
  assert.equal(hDelEmpty.engine.getSnapshot().vnState, 'WAITING_FOR_DIACRITIC');
  assert.equal(hDelEmpty.engine.triggerDelete(), 'char');
  assert.equal(hDelEmpty.getOutput(), '');
  assert.equal(hDelEmpty.engine.getSnapshot().vnState, 'NORMAL');
});

test('VietnameseMorse: full Vietnamese sentence round-trip (encoder -> engine -> decoder) with mixed case', () => {
  const sentence = 'Tiếng Việt Đẹp Lắm!';
  const tokens = VietnameseMorse.encodeVietnameseText(sentence, MorseTable);
  const h = createEngineHarness({ letterCase: 'lower' });

  for (const token of tokens) {
    const isUpper =
      token.char !== token.char.toLowerCase() &&
      token.char === token.char.toUpperCase();
    h.engine.updateConfig({ letterCase: isUpper ? 'upper' : 'lower' });

    for (const step of token.steps) {
      if (step === 'SPACE') {
        h.engine.triggerSpace();
      } else if (step === 'ESC') {
        const res = h.engine.triggerEscape();
        assert.equal(res.ok, true, `Failed ESC on token "${token.char}"`);
      } else {
        h.sendSignals(step);
      }
    }
  }

  assert.equal(h.getOutput(), sentence.normalize('NFC'));
});

test('VietnameseMorse: prefix preview and candidate hints during diacritic & tone entry', () => {
  const emptyPreview = VietnameseMorse.decodeVietnamesePreview('', 'a', 'WAITING_FOR_DIACRITIC');
  assert.equal(emptyPreview.kind, 'empty');

  const dashPrefix = VietnameseMorse.decodeVietnamesePreview('-', 'a', 'WAITING_FOR_DIACRITIC');
  assert.equal(dashPrefix.kind, 'prefix');
  assert.ok(Array.isArray(dashPrefix.candidates));
  assert.ok(dashPrefix.candidates.length >= 2);

  const badPreview = VietnameseMorse.decodeVietnamesePreview('----', 'a', 'WAITING_FOR_DIACRITIC');
  assert.equal(badPreview.kind, 'unknown');

  const initialHints = VietnameseMorse.getVietnameseNextHints('', 'a', 'WAITING_FOR_DIACRITIC');
  assert.ok(initialHints.dot && initialHints.dot.includes('ă'));
  assert.ok(initialHints.dot.includes('á'));
  assert.ok(initialHints.dash && initialHints.dash.includes('â'));
  assert.ok(initialHints.dash.includes('à'));

  const toneDotHint = VietnameseMorse.getVietnameseNextHints('.', 'ă', 'WAITING_FOR_TONE');
  assert.equal(toneDotHint.dot, 'ắ');
  assert.equal(toneDotHint.dash, 'ẳ');
});

test('MorseEngine: triggerEscape(fallbackChar) uses live caret char fallback and rejects invalid chars', () => {
  const h = createEngineHarness({ letterCase: 'lower' });
  const entered = h.engine.triggerEscape('a');
  assert.equal(entered.ok, true);
  assert.equal(entered.state, 'WAITING_FOR_DIACRITIC');
  assert.equal(h.engine.getSnapshot().vnState, 'WAITING_FOR_DIACRITIC');

  // Modifier returns state to NORMAL so optional second ESC enters WAITING_FOR_TONE
  h.sendSignals('.-');
  assert.equal(h.getOutput(), 'ă');
  assert.equal(h.engine.getSnapshot().vnState, 'NORMAL');

  // Calling triggerEscape with another fallback matches updated live char ('ă')
  const esc2 = h.engine.triggerEscape('ă');
  assert.equal(esc2.ok, true);
  assert.equal(esc2.state, 'WAITING_FOR_TONE');
  h.sendSignals('..');
  assert.equal(h.getOutput(), 'ắ');
  assert.equal(h.engine.getSnapshot().vnState, 'NORMAL');

  const hSpace = createEngineHarness({ letterCase: 'lower' });
  assert.equal(hSpace.engine.triggerEscape(' ').ok, false);
  assert.equal(hSpace.engine.triggerEscape('').ok, false);
  assert.equal(hSpace.engine.triggerEscape(null).ok, false);
  assert.equal(hSpace.engine.getSnapshot().vnState, 'NORMAL');
});

test('MorseBindings: optional diacritic action keeps 4-button defaults and fires onTriggerDiacritic on tap & hold', () => {
  const MorseBindings = require('../src/morse-bindings.js');
  assert.ok(MorseBindings.ACTION_IDS.includes('diacritic'));
  assert.equal(MorseBindings.DEFAULT_BINDINGS.diacritic, null);
  assert.ok(MorseBindings.ACTION_META.diacritic);

  const { bindings: withTap } = MorseBindings.assignBinding(MorseBindings.DEFAULT_BINDINGS, 'diacritic', {
    button: 3,
    mode: 'tap',
  });
  assert.deepEqual(withTap.diacritic, { button: 3, mode: 'tap' });
  assert.deepEqual(withTap.dot, MorseBindings.DEFAULT_BINDINGS.dot);
  assert.deepEqual(withTap.dash, MorseBindings.DEFAULT_BINDINGS.dash);
  assert.deepEqual(withTap.space, MorseBindings.DEFAULT_BINDINGS.space);
  assert.deepEqual(withTap.delete, MorseBindings.DEFAULT_BINDINGS.delete);

  const noopSidetone = { start() {}, stop() {}, markDash() {}, playSpaceTick() {}, playDeleteTick() {}, playDotTick() {} };
  const h = createEngineHarness({ letterCase: 'lower' });
  let tapCount = 0;
  const tapCtrl = MorseBindings.createMouseActionController({
    engine: h.engine,
    sidetone: noopSidetone,
    getBindings: () => withTap,
    getThresholdMs: () => 200,
    onTriggerDiacritic: () => {
      tapCount += 1;
      return { ok: true };
    },
  });
  assert.equal(tapCtrl.handleMouseDown(3), true);
  assert.equal(tapCtrl.handleMouseUp(3), true);
  assert.equal(tapCount, 1);

  // Hold mode on middle button (button 1) paired with delete on tap, or standalone hold
  const { bindings: withHold } = MorseBindings.assignBinding(MorseBindings.DEFAULT_BINDINGS, 'diacritic', {
    button: 4,
    mode: 'hold',
  });
  let holdCount = 0;
  const scheduled = [];
  const origSetTimeout = globalThis.setTimeout;
  const origClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (fn, ms) => {
    const id = scheduled.length + 1;
    scheduled.push({ id, fn, ms, cleared: false });
    return id;
  };
  globalThis.clearTimeout = (id) => {
    const item = scheduled.find((s) => s.id === id);
    if (item) item.cleared = true;
  };
  try {
    const holdCtrl = MorseBindings.createMouseActionController({
      engine: h.engine,
      sidetone: noopSidetone,
      getBindings: () => withHold,
      getThresholdMs: () => 200,
      onTriggerDiacritic: () => {
        holdCount += 1;
        return { ok: true };
      },
    });
    assert.equal(holdCtrl.handleMouseDown(4), true);
    assert.equal(holdCount, 0);
    for (const s of scheduled) {
      if (!s.cleared) s.fn();
    }
    assert.equal(holdCount, 1);
    assert.equal(holdCtrl.handleMouseUp(4), true);
  } finally {
    globalThis.setTimeout = origSetTimeout;
    globalThis.clearTimeout = origClearTimeout;
  }
});

test('MorseTextInserter: getCharBeforeCaret and atomic replaceLastChar handle mid-string & NFD on textarea', () => {
  const MorseTextInserter = require('../src/text-inserter.js');

  function createMockTextarea(initialValue, caretPos) {
    return {
      nodeType: 1,
      tagName: 'TEXTAREA',
      value: initialValue,
      selectionStart: caretPos,
      selectionEnd: caretPos,
      focus() {},
      setSelectionRange(start, end) {
        this.selectionStart = start;
        this.selectionEnd = end;
      },
      dispatchEvent() {
        return true;
      },
    };
  }

  const ta = createMockTextarea('xin chao ban', 7);
  assert.equal(MorseTextInserter.getCharBeforeCaret(ta), 'a');
  assert.equal(MorseTextInserter.replaceLastChar(ta, 'à', 'a'), true);
  assert.equal(ta.value, 'xin chào ban');
  assert.equal(ta.selectionStart, 7);
  assert.equal(ta.selectionEnd, 7);

  const taNfd = createMockTextarea('a\u0306 ban', 2);
  assert.equal(MorseTextInserter.getCharBeforeCaret(taNfd), 'ă');
  assert.equal(MorseTextInserter.replaceLastChar(taNfd, 'ắ', 'ă'), true);
  assert.equal(taNfd.value, 'ắ ban');
  assert.equal(taNfd.selectionStart, 1);

  const taMoved = createMockTextarea('xin chao ban', 12);
  assert.equal(MorseTextInserter.getCharBeforeCaret(taMoved), 'n');
  assert.equal(MorseTextInserter.replaceLastChar(taMoved, 'à', 'a'), false);
  assert.equal(taMoved.value, 'xin chao ban');
});


