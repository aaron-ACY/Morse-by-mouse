(function (root) {
  'use strict';

  const STATES = {
    NORMAL: 'NORMAL',
    WAITING_FOR_DIACRITIC: 'WAITING_FOR_DIACRITIC',
    WAITING_FOR_TONE: 'WAITING_FOR_TONE'
  };

  const ESCAPE_NOTICE = 'Vietnamese Diacritic Mode – Enter tone or character modifier';

  const STATE_META = {
    NORMAL: {
      badge: 'Normal Mode',
      desc: 'Đang nhập chữ cái'
    },
    WAITING_FOR_DIACRITIC: {
      badge: 'Diacritic Mode',
      desc: 'Đang chờ nhập dấu'
    },
    WAITING_FOR_TONE: {
      badge: 'Tone Mode',
      desc: 'Đang chờ thanh điệu hoặc đổi dấu'
    }
  };

  // Character Modifiers (Section 3.1)
  const CHARACTER_MODIFIERS = {
    '.-': { code: '.-', key: 'breve', label: 'Ă', base: 'a', display: 'Ă (A)' },
    '-...': { code: '-...', key: 'circumflex_a', label: 'Â', base: 'a', display: 'Â (A)' },
    '-.-.': { code: '-.-.', key: 'circumflex_e', label: 'Ê', base: 'e', display: 'Ê (E)' },
    '-..': { code: '-..', key: 'circumflex_o', label: 'Ô', base: 'o', display: 'Ô (O)' },
    '.': { code: '.', key: 'horn_o', label: 'Ơ', base: 'o', display: 'Ơ (O)' },
    '..-': { code: '..-', key: 'horn_u', label: 'Ư', base: 'u', display: 'Ư (U)' },
    '-..-': { code: '-..-', key: 'stroke_d', label: 'Đ', base: 'd', display: 'Đ (D)' }
  };

  // Tone Marks (Section 3.2)
  const TONE_MARKS = {
    '..': { code: '..', key: 'sac', label: 'Sắc' },
    '--': { code: '--', key: 'huyen', label: 'Huyền' },
    '.-.': { code: '.-.', key: 'hoi', label: 'Hỏi' },
    '-.-': { code: '-.-', key: 'nga', label: 'Ngã' },
    '...-': { code: '...-', key: 'nang', label: 'Nặng' }
  };

  const TONE_ORDER = ['none', 'sac', 'huyen', 'hoi', 'nga', 'nang'];

  // Explicit NFC Vietnamese letter matrix keyed by (base, modifierKey) -> [none, sac, huyen, hoi, nga, nang]
  const VOWEL_FORMS = {
    'a|none': ['a', 'á', 'à', 'ả', 'ã', 'ạ'],
    'a|breve': ['ă', 'ắ', 'ằ', 'ẳ', 'ẵ', 'ặ'],
    'a|circumflex_a': ['â', 'ấ', 'ầ', 'ẩ', 'ẫ', 'ậ'],
    'e|none': ['e', 'é', 'è', 'ẻ', 'ẽ', 'ẹ'],
    'e|circumflex_e': ['ê', 'ế', 'ề', 'ể', 'ễ', 'ệ'],
    'i|none': ['i', 'í', 'ì', 'ỉ', 'ĩ', 'ị'],
    'o|none': ['o', 'ó', 'ò', 'ỏ', 'õ', 'ọ'],
    'o|circumflex_o': ['ô', 'ố', 'ồ', 'ổ', 'ỗ', 'ộ'],
    'o|horn_o': ['ơ', 'ớ', 'ờ', 'ở', 'ỡ', 'ợ'],
    'u|none': ['u', 'ú', 'ù', 'ủ', 'ũ', 'ụ'],
    'u|horn_u': ['ư', 'ứ', 'ừ', 'ử', 'ữ', 'ự'],
    'y|none': ['y', 'ý', 'ỳ', 'ỷ', 'ỹ', 'ỵ']
  };

  const MODIFIER_CODE_BY_PAIR = {
    'a|breve': '.-',
    'a|circumflex_a': '-...',
    'e|circumflex_e': '-.-.',
    'o|circumflex_o': '-..',
    'o|horn_o': '.',
    'u|horn_u': '..-',
    'd|stroke_d': '-..-'
  };

  const TONE_CODE_BY_KEY = {
    sac: '..',
    huyen: '--',
    hoi: '.-.',
    nga: '-.-',
    nang: '...-'
  };

  // Reverse lookup from any NFC Vietnamese character (upper or lower) to structured parts
  const CHAR_META = Object.create(null);

  for (const [pairKey, forms] of Object.entries(VOWEL_FORMS)) {
    const [base, modifierKey] = pairKey.split('|');
    forms.forEach((rawLower, idx) => {
      const lower = rawLower.normalize('NFC');
      const upper = lower.toUpperCase().normalize('NFC');
      const toneKey = idx === 0 ? null : TONE_ORDER[idx];
      const mod = modifierKey === 'none' ? null : modifierKey;
      CHAR_META[lower] = { base, isUpper: false, isVowel: true, modifierKey: mod, toneKey };
      CHAR_META[upper] = { base, isUpper: true, isVowel: true, modifierKey: mod, toneKey };
    });
  }

  CHAR_META.d = { base: 'd', isUpper: false, isVowel: false, modifierKey: null, toneKey: null };
  CHAR_META.D = { base: 'd', isUpper: true, isVowel: false, modifierKey: null, toneKey: null };
  CHAR_META['đ'] = { base: 'd', isUpper: false, isVowel: false, modifierKey: 'stroke_d', toneKey: null };
  CHAR_META['Đ'] = { base: 'd', isUpper: true, isVowel: false, modifierKey: 'stroke_d', toneKey: null };

  function parseVietnameseChar(char) {
    if (!char || typeof char !== 'string') return null;
    const normalized = char.normalize('NFC');
    return CHAR_META[normalized] || null;
  }

  function composeVietnameseChar(base, modifierKey, toneKey, isUpper) {
    if (base === 'd') {
      if (toneKey) return null;
      const lower = modifierKey === 'stroke_d' ? 'đ' : 'd';
      return (isUpper ? lower.toUpperCase() : lower).normalize('NFC');
    }
    const forms = VOWEL_FORMS[`${base}|${modifierKey || 'none'}`];
    if (!forms) return null;
    const toneIdx = toneKey ? TONE_ORDER.indexOf(toneKey) : 0;
    if (toneIdx < 0) return null;
    const lower = forms[toneIdx];
    return (isUpper ? lower.toUpperCase() : lower).normalize('NFC');
  }

  function canEnterDiacriticMode(char) {
    if (!char) {
      return {
        allowed: false,
        nextState: null,
        reason: 'Chưa có chữ cái gốc để thêm dấu'
      };
    }

    const meta = parseVietnameseChar(char);
    if (!meta) {
      return {
        allowed: false,
        nextState: null,
        reason: `Ký tự "${char}" không hỗ trợ dấu tiếng Việt`
      };
    }

    if (meta.base === 'd' && meta.modifierKey) {
      return {
        allowed: false,
        nextState: null,
        reason: `Ký tự "${char}" đã hoàn chỉnh, không có dấu khác`
      };
    }

    if (meta.modifierKey) {
      return {
        allowed: true,
        nextState: STATES.WAITING_FOR_TONE,
        reason: null
      };
    }

    return {
      allowed: true,
      nextState: STATES.WAITING_FOR_DIACRITIC,
      reason: null
    };
  }

  /**
   * Vietnamese Diacritic Parser: validates and applies (or replaces) a diacritic or
   * tone Morse sequence onto `currentChar`.
   */
  function applyVietnameseCode(currentChar, code, _stateMode = STATES.WAITING_FOR_DIACRITIC) {
    if (!code) {
      return { ok: false, errorCode: 'empty', message: 'Chưa có mã dấu' };
    }

    const meta = parseVietnameseChar(currentChar);
    if (!meta) {
      return {
        ok: false,
        errorCode: 'unsupported_base',
        message: 'Chữ cái gốc không hỗ trợ dấu tiếng Việt'
      };
    }

    const mod = CHARACTER_MODIFIERS[code];
    const tone = TONE_MARKS[code];

    if (!mod && !tone) {
      return {
        ok: false,
        errorCode: 'invalid_code',
        message: `Mã dấu không hợp lệ (${code})`
      };
    }

    if (mod) {
      if (meta.base !== mod.base) {
        return {
          ok: false,
          errorCode: 'incompatible_modifier',
          message: `Dấu ${mod.label} không áp dụng cho "${currentChar}"`
        };
      }
      if (meta.modifierKey === mod.key) {
        return {
          ok: false,
          errorCode: 'duplicate_modifier',
          message: `"${currentChar}" đã có dấu ${mod.label}`
        };
      }
      const nextChar = composeVietnameseChar(meta.base, mod.key, meta.toneKey, meta.isUpper);
      if (!nextChar) {
        return {
          ok: false,
          errorCode: 'incompatible_modifier',
          message: `Không áp dụng được dấu ${mod.label} cho "${currentChar}"`
        };
      }
      return {
        ok: true,
        kind: 'modifier',
        char: nextChar,
        previous: currentChar,
        replaced: meta.modifierKey !== null,
        code,
        label: mod.label
      };
    }

    // Tone mark
    if (!meta.isVowel) {
      return {
        ok: false,
        errorCode: 'not_vowel',
        message: `Chỉ nguyên âm mới thêm được dấu ${tone.label}`
      };
    }

    if (meta.toneKey === tone.key) {
      return {
        ok: false,
        errorCode: 'same_tone',
        message: `"${currentChar}" đã có dấu ${tone.label}`
      };
    }

    const nextChar = composeVietnameseChar(meta.base, meta.modifierKey, tone.key, meta.isUpper);
    if (!nextChar) {
      return {
        ok: false,
        errorCode: 'invalid_combination',
        message: `Không kết hợp được dấu ${tone.label} với "${currentChar}"`
      };
    }

    return {
      ok: true,
      kind: 'tone',
      char: nextChar,
      previous: currentChar,
      replaced: meta.toneKey !== null,
      code,
      label: tone.label
    };
  }

  const ALL_VIETNAMESE_CODES = [
    ...Object.keys(CHARACTER_MODIFIERS),
    ...Object.keys(TONE_MARKS)
  ];

  function getCandidateMatches(prefix, currentChar, stateMode = STATES.WAITING_FOR_DIACRITIC) {
    if (!currentChar) return [];
    const results = [];
    for (const code of ALL_VIETNAMESE_CODES) {
      if (prefix && !code.startsWith(prefix)) continue;
      const res = applyVietnameseCode(currentChar, code, stateMode);
      if (res.ok) {
        results.push({ code, char: res.char, kind: res.kind, label: res.label });
      }
    }
    return results;
  }

  function decodeVietnamesePreview(code, currentChar, stateMode) {
    if (!code) return { kind: 'empty' };
    const res = applyVietnameseCode(currentChar, code, stateMode);
    if (res.ok) {
      return { kind: 'char', char: res.char, subKind: res.kind, label: res.label, code };
    }
    const candidates = getCandidateMatches(code, currentChar, stateMode);
    if (candidates.length > 0) {
      return { kind: 'prefix', code, candidates };
    }
    return { kind: 'unknown', code, errorCode: res.errorCode, message: res.message };
  }

  function getVietnameseNextHints(buffer, currentChar, stateMode) {
    const prefix = buffer || '';
    const formatBranch = (sym) => {
      const nextCode = prefix + sym;
      const exact = applyVietnameseCode(currentChar, nextCode, stateMode);
      if (exact.ok) {
        return exact.char;
      }
      const candidates = getCandidateMatches(nextCode, currentChar, stateMode);
      if (!candidates.length) return null;
      const shown = candidates.slice(0, 4).map((c) => c.char).join(' ');
      return candidates.length > 4 ? `${shown}…` : shown;
    };

    return {
      dot: formatBranch('.'),
      dash: formatBranch('-')
    };
  }

  /**
   * Vietnamese Morse Encoder helper: encodes a single Vietnamese character into
   * base international Morse + optional ESC diacritic/tone steps.
   */
  function encodeVietnameseChar(char, morseTable = root.MorseTable) {
    if (!char || typeof char !== 'string') return null;
    const normalized = char.normalize('NFC');
    const meta = parseVietnameseChar(normalized);

    if (!meta) {
      const upper = normalized.toUpperCase();
      const code = morseTable && morseTable.CHAR_TO_MORSE ? morseTable.CHAR_TO_MORSE[upper] : null;
      return code ? { char: normalized, baseCode: code, steps: [code] } : null;
    }

    const baseUpper = meta.base.toUpperCase();
    const baseCode = morseTable && morseTable.CHAR_TO_MORSE ? morseTable.CHAR_TO_MORSE[baseUpper] : null;
    if (!baseCode) return null;

    const steps = [baseCode];
    if (meta.modifierKey) {
      const modCode = MODIFIER_CODE_BY_PAIR[`${meta.base}|${meta.modifierKey}`];
      if (modCode) {
        steps.push('ESC', modCode);
      }
    }
    if (meta.toneKey) {
      const toneCode = TONE_CODE_BY_KEY[meta.toneKey];
      if (toneCode) {
        steps.push('ESC', toneCode);
      }
    }

    return { char: normalized, baseCode, steps };
  }

  function encodeVietnameseText(text, morseTable = root.MorseTable) {
    if (typeof text !== 'string') return [];
    const tokens = [];
    for (const ch of text.normalize('NFC')) {
      if (ch === ' ') {
        tokens.push({ char: ' ', steps: ['SPACE'] });
      } else {
        const encoded = encodeVietnameseChar(ch, morseTable);
        tokens.push(encoded || { char: ch, steps: [] });
      }
    }
    return tokens;
  }

  const VIETNAMESE_REFERENCE_GROUPS = [
    {
      title: 'Character Modifiers',
      items: Object.values(CHARACTER_MODIFIERS).map((m) => ({
        key: m.display,
        code: m.code
      }))
    },
    {
      title: 'Tone Marks',
      items: Object.values(TONE_MARKS).map((t) => ({
        key: t.label,
        code: t.code
      }))
    }
  ];

  const api = {
    STATES,
    STATE_META,
    ESCAPE_NOTICE,
    CHARACTER_MODIFIERS,
    TONE_MARKS,
    VIETNAMESE_REFERENCE_GROUPS,
    parseVietnameseChar,
    canEnterDiacriticMode,
    applyVietnameseCode,
    getCandidateMatches,
    decodeVietnamesePreview,
    getVietnameseNextHints,
    encodeVietnameseChar,
    encodeVietnameseText
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
  root.VietnameseMorse = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

