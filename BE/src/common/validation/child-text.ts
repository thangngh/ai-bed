import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

/**
 * The BE edge of the same lock the Engine applies in `core/prompts/sanitize.py`
 * and `core/input_guard.py`.
 *
 * Duplicated rather than shared because the two run in different languages, and
 * duplicated *deliberately in both directions*: this one is the cheap rejection
 * (no LLM call is paid for, no queue slot is taken), the Engine's is the one
 * that actually has to hold, because `/generate` is reachable from anything
 * else on the compose network. Neither is allowed to assume the other ran.
 *
 * Three things are locked here.
 *
 *  1. Fullwidth forms. `＜＜＜` is not `<<<` to any `.replace(/[<>]/g, '')`, but
 *     it is `<<<` to every tokenizer -- so a value that looks harmless after
 *     stripping can still close the data fence the prompt template draws.
 *     The same trick spells `ｉｇｎｏｒｅ ａｌｌ ｒｕｌｅｓ` past an ASCII blocklist.
 *  2. Script. Vietnamese and English are the two languages this product's
 *     prompts, blocklist and reviewer are written for. Text in Cyrillic, Han,
 *     Kana, Hangul, Arabic or Thai is not "another language we also accept",
 *     it is content nothing downstream can claim to have checked.
 *  3. Content, for the fields that steer what the story is about. The audience
 *     is 3-6 year olds; `theme` and `goal` go straight into the prompt, and
 *     without this the only thing between an unsuitable request and a child
 *     was the reviewer LLM, ten calls later.
 *
 * Every character class below is built from codepoints rather than written as a
 * literal range. The zero-width and combining-mark ranges render as nothing in
 * an editor, and a range whose endpoints cannot be read is a range nobody can
 * review -- the literal form of one of these already sits unreadable in
 * `modules/memory/memory-content.ts`.
 */

type Range = readonly [number, number];

const charClass = (ranges: readonly Range[], extra = ''): string =>
  ranges
    .map(([lo, hi]) =>
      lo === hi
        ? String.fromCodePoint(lo)
        : `${String.fromCodePoint(lo)}-${String.fromCodePoint(hi)}`,
    )
    .join('') + extra;

/**
 * Fullwidth (U+FF01-U+FF60, U+FFE0-U+FFE6), halfwidth (U+FF61-U+FFDC,
 * U+FFE8-U+FFEE) and the ideographic space U+3000 -- the fullwidth blank that
 * a `\s` collapse in a naive sanitizer leaves standing.
 *
 * Checked on the *raw* value, before NFKC: after normalisation a fullwidth `Ａ`
 * is an ordinary `A` and there is nothing left to object to. The question this
 * answers is not "what is this character" but "why was it written that way".
 */
const FULLWIDTH_RANGES: readonly Range[] = [
  [0x3000, 0x3000],
  [0xff01, 0xffee],
];

/** C0/C1 controls, plus the zero-width and bidi ranges that render as nothing. */
const CONTROL_AND_INVISIBLE_RANGES: readonly Range[] = [
  [0x0000, 0x001f], // C0
  [0x007f, 0x009f], // DEL + C1
  [0x200b, 0x200f], // zero-width space/joiner, LTR/RTL marks
  [0x202a, 0x202e], // bidi embedding and override
  [0x2060, 0x2064], // word joiner, invisible operators
  [0x2066, 0x2069], // bidi isolates
  [0xfeff, 0xfeff], // zero-width no-break space / BOM
];

/**
 * Vietnamese + English. Vietnamese needs three letter blocks, not one: ASCII
 * bases, Latin-1/Extended-A-B for the vowel marks (â ă ê ô ơ ư đ), and Latin
 * Extended Additional for the precomposed vowel-plus-tone forms (ế ộ ừ).
 * Combining marks are admitted too, because NFKC is a compatibility
 * normalisation and does not guarantee full composition.
 */
const ALLOWED_RANGES: readonly Range[] = [
  [0x0030, 0x0039], // digits
  [0x0041, 0x005a], // A-Z
  [0x0061, 0x007a], // a-z
  [0x00c0, 0x024f], // Latin-1 Supplement + Latin Extended-A/B
  [0x0300, 0x036f], // combining diacritics (decomposed Vietnamese)
  [0x1e00, 0x1eff], // Latin Extended Additional (precomposed Vietnamese)
];

/**
 * Short on purpose. Backtick, angle brackets, braces, square brackets, pipe,
 * backslash, asterisk, hash and tilde are the characters a value would use to
 * draw structure -- a code fence, a JSON object, a markdown heading -- around
 * text that is supposed to be a name. None of them appear in a child's name, a
 * story theme or a bedtime lesson.
 */
const ALLOWED_PUNCTUATION = " .,!?;:'\"()\\-/&+=@_%";

const FULLWIDTH_FORMS = new RegExp(`[${charClass(FULLWIDTH_RANGES)}]`, 'gu');
const CONTROL_AND_INVISIBLE = new RegExp(
  `[${charClass(CONTROL_AND_INVISIBLE_RANGES)}]`,
  'gu',
);
const DISALLOWED_SCRIPT = new RegExp(
  `[^${charClass(ALLOWED_RANGES, ALLOWED_PUNCTUATION)}]`,
  'gu',
);

/** Mirrors Engine/core/validator.py BLOCKLIST_WORDS. */
export const BLOCKLIST_WORDS = [
  // English
  'sex', 'sexual', 'porn', 'nude', 'naked', 'erotic', 'nsfw', 'rape',
  'violence', 'blood', 'kill', 'murder', 'death', 'corpse', 'behead',
  'stab', 'shoot', 'torture', 'abuse', 'terrorist', 'kidnap',
  'weapon', 'gun', 'knife', 'drug', 'heroin', 'cocaine', 'alcohol',
  'cigarette', 'gambling', 'suicide', 'self-harm', 'demon', 'devil',
  // Vietnamese -- violence and death
  'máu', 'chết', 'giết', 'sát hại', 'đâm chém', 'chém giết', 'bạo lực',
  'tra tấn', 'hành hạ', 'đánh nhau', 'thi thể', 'xác chết', 'đầu độc',
  'khủng bố', 'bắt cóc', 'súng', 'dao', 'vũ khí',
  // Vietnamese -- self-harm
  'tự tử', 'tự sát', 'tự hại',
  // Vietnamese -- sexual
  'khiêu dâm', 'ấu dâm', 'hiếp dâm', 'cưỡng hiếp', 'khỏa thân',
  'trần truồng', 'gợi dục',
  // Vietnamese -- substances and vice
  'hút thuốc', 'thuốc lá', 'rượu', 'bia rượu', 'ma túy', 'cần sa',
  'nghiện', 'cờ bạc', 'cá độ',
  // Vietnamese -- horror and hate
  'kinh dị', 'ma quỷ', 'quỷ dữ', 'kỳ thị', 'phân biệt', 'đả kích',
  'thù hận',
];

/** Mirrors Engine/core/input_guard.py INJECTION_MARKERS. */
export const INJECTION_MARKERS = [
  'ignore previous', 'ignore all', 'ignore the above', 'ignore your',
  'disregard previous', 'disregard all', 'disregard the above',
  'system prompt', 'developer prompt', 'new instructions',
  'you are now', 'from now on you', 'pretend you are', 'act as an ai',
  'override the', 'reveal the prompt', 'repeat the prompt',
  'bỏ qua mọi', 'bỏ qua tất cả', 'bỏ qua hướng dẫn', 'bỏ qua các quy tắc',
  'quên hết', 'quên mọi', 'quên tất cả',
  'từ giờ bạn', 'từ nay bạn', 'bạn không còn', 'không tuân theo',
  'lặp lại prompt', 'in ra prompt',
  '<<<', '>>>', '```',
];

const wordBoundaryPattern = (words: string[]): RegExp => {
  // Longest first, so `sát hại` is reported rather than an overlapping shorter
  // term. Lookarounds on `\p{L}\p{N}` rather than `\b`, because `\b` anchors on
  // the wrong side of entries that end in punctuation (`self-harm`) and treats
  // every Vietnamese letter as a non-word character.
  const alternation = [...words]
    .sort((a, b) => b.length - a.length)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternation})(?![\\p{L}\\p{N}])`, 'iu');
};

const BLOCKLIST_PATTERN = wordBoundaryPattern(BLOCKLIST_WORDS);

/** NFKC-fold to a string. Non-strings become '' rather than `String(value)`. */
export function normalizeChildText(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC');
}

/** The distinct fullwidth/halfwidth characters in `value`, or ''. */
export function findFullwidth(value: unknown): string {
  if (typeof value !== 'string') return '';
  const hits = value.match(FULLWIDTH_FORMS);
  return hits ? [...new Set(hits)].join('') : '';
}

/** The distinct control or zero-width characters in `value`, or ''. */
export function findControlOrInvisible(value: unknown): string {
  const hits = normalizeChildText(value).match(CONTROL_AND_INVISIBLE);
  return hits ? [...new Set(hits)].join('') : '';
}

/**
 * `value` with everything outside Vietnamese/English replaced by a space, run
 * to a single trimmed line.
 *
 * The strip, as opposed to the rejection above. Used where there is no request
 * left to fail -- a memory written by an older Engine, a profile already in the
 * database -- so it has to succeed on any input.
 */
export function stripToAllowedScript(value: unknown): string {
  return normalizeChildText(value)
    .replace(CONTROL_AND_INVISIBLE, ' ')
    .replace(DISALLOWED_SCRIPT, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The distinct non-Vietnamese/English characters in `value`, or ''. */
export function findDisallowedScript(value: unknown): string {
  const folded = normalizeChildText(value).replace(CONTROL_AND_INVISIBLE, '');
  const hits = folded.match(DISALLOWED_SCRIPT);
  return hits ? [...new Set(hits)].join('') : '';
}

/** The first injection marker in `value`, or ''. */
export function findInjectionMarker(value: unknown): string {
  const folded = normalizeChildText(value).toLowerCase();
  return INJECTION_MARKERS.find((marker) => folded.includes(marker)) ?? '';
}

/** The first blocked word in `value`, or ''. */
export function findBlockedWord(value: unknown): string {
  const match = BLOCKLIST_PATTERN.exec(normalizeChildText(value));
  return match ? match[0].toLowerCase() : '';
}

export interface ChildTextOptions {
  /**
   * Also apply the content blocklist. On for the fields that decide what the
   * story is about (`theme`, `goal`, `favorite_character`); off for names,
   * because the blocklist contains `dao` and a child can be called Dao.
   */
  content?: boolean;
}

/**
 * The reason `value` must be rejected, in Vietnamese, or '' if it is fine.
 *
 * The message names the category but never echoes the offending characters:
 * the 422 body reaches the caller, and an error that quotes back exactly which
 * character tripped the filter is a free oracle for probing it.
 */
export function childTextRejection(value: unknown, options: ChildTextOptions = {}): string {
  if (typeof value !== 'string') return '';

  // Order matters: fullwidth first, because NFKC dissolves the evidence.
  if (findFullwidth(value)) {
    return 'không được dùng ký tự fullwidth (ký tự rộng)';
  }
  if (findControlOrInvisible(value)) {
    return 'không được chứa ký tự điều khiển hoặc ký tự ẩn';
  }
  if (findDisallowedScript(value)) {
    return 'chỉ hỗ trợ tiếng Việt và tiếng Anh';
  }
  if (findInjectionMarker(value)) {
    return 'chứa nội dung điều khiển hệ thống';
  }
  if (options.content && findBlockedWord(value)) {
    return 'chứa nội dung không phù hợp với trẻ 3-6 tuổi';
  }
  return '';
}

/**
 * Reject text that must not reach a prompt for a 3-6 year old.
 *
 * Pass `{ content: true }` on fields that steer the story's subject; leave it
 * off for names and other identifiers.
 */
export function IsChildSafeText(
  options: ChildTextOptions = {},
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isChildSafeText',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          return childTextRejection(value, options) === '';
        },
        defaultMessage(args: ValidationArguments) {
          const reason = childTextRejection(args.value, options);
          return `${args.property} ${reason || 'không hợp lệ'}`;
        },
      },
    });
  };
}
