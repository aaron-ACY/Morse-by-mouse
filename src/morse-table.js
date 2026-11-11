(function (root) {
  'use strict';

  const CHAR_TO_MORSE = {
    A: '.-',
    B: '-...',
    C: '-.-.',
    D: '-..',
    E: '.',
    F: '..-.',
    G: '--.',
    H: '....',
    I: '..',
    J: '.---',
    K: '-.-',
    L: '.-..',
    M: '--',
    N: '-.',
    O: '---',
    P: '.--.',
    Q: '--.-',
    R: '.-.',
    S: '...',
    T: '-',
    U: '..-',
    V: '...-',
    W: '.--',
    X: '-..-',
    Y: '-.--',
    Z: '--..',

    '0': '-----',
    '1': '.----',
    '2': '..---',
    '3': '...--',
    '4': '....-',
    '5': '.....',
    '6': '-....',
    '7': '--...',
    '8': '---..',
    '9': '----.',

    '.': '.-.-.-',
    ',': '--..--',
    '?': '..--..',
    '!': '-.-.--',
    "'": '.----.',
    '"': '.-..-.',
    '/': '-..-.',
    '(': '-.--.',
    ')': '-.--.-',
    '&': '.-...',
    ':': '---...',
    ';': '-.-.-.',
    '=': '-...-',
    '+': '.-.-.',
    '-': '-....-',
    '_': '..--.-',
    '$': '...-..-',
    '@': '.--.-.'
  };

  const MORSE_TO_CHAR = Object.create(null);
  for (const [char, code] of Object.entries(CHAR_TO_MORSE)) {
    MORSE_TO_CHAR[code] = char;
  }

  /**
   * Decode a dot/dash sequence into either a character or unknown.
   */
  function decodeMorse(code, options = {}) {
    if (!code) {
      return { kind: 'empty' };
    }

    const rawChar = MORSE_TO_CHAR[code];
    if (rawChar) {
      const letterCase = options.letterCase || 'lower';
      const isAlpha = rawChar >= 'A' && rawChar <= 'Z';
      const char = isAlpha && letterCase === 'lower' ? rawChar.toLowerCase() : rawChar;
      return { kind: 'char', char, rawChar, code };
    }

    return { kind: 'unknown', code };
  }

  function getPreviewLabel(code, options = {}) {
    const res = decodeMorse(code, options);
    if (res.kind === 'char') return res.char;
    return null;
  }

  function getNextHints(buffer, options = {}) {
    const prefix = buffer || '';
    return {
      dot: getPreviewLabel(prefix + '.', options),
      dash: getPreviewLabel(prefix + '-', options)
    };
  }

  function formatVisualMorse(code) {
    if (!code) return '';
    return code
      .split('')
      .map((s) => (s === '.' ? '·' : '—'))
      .join(' ');
  }

  const REFERENCE_GROUPS = [
    {
      title: 'Chữ cái (A–Z)',
      items: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((c) => ({
        key: c,
        code: CHAR_TO_MORSE[c]
      }))
    },
    {
      title: 'Số (0–9)',
      items: '0123456789'.split('').map((c) => ({
        key: c,
        code: CHAR_TO_MORSE[c]
      }))
    },
    {
      title: 'Dấu câu',
      items: ['.', ',', '?', '!', '-', '/', '@', ':', ';', '(', ')', "'", '"', '+', '='].map(
        (c) => ({
          key: c,
          code: CHAR_TO_MORSE[c]
        })
      )
    }
  ];

  const api = {
    CHAR_TO_MORSE,
    MORSE_TO_CHAR,
    REFERENCE_GROUPS,
    decodeMorse,
    getPreviewLabel,
    getNextHints,
    formatVisualMorse
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.MorseTable = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

