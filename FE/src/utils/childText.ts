/**
 * The client-side echo of the server's input lock.
 *
 * This is not a security control and must never be treated as one -- the BE
 * (`common/validation/child-text.ts`) and the Engine
 * (`core/input_guard.py`) are the boundary, and both re-check everything here.
 * What this buys is that a parent finds out at the keyboard instead of after a
 * loading screen and a 422: the same rules, said earlier and in the same words.
 *
 * Kept deliberately small. It mirrors the two rules a parent can trip by
 * accident -- a pasted character from another script, and a fullwidth character
 * from an IME -- and leaves the content blocklist to the server, where a
 * rejection can be logged.
 */

/** Fullwidth and halfwidth compatibility forms, plus the ideographic space. */
const FULLWIDTH_FORMS = /[　！-￮]/u;

/**
 * Vietnamese + English. Three letter blocks: ASCII bases, Latin-1/Extended-A-B
 * for the vowel marks (â ă ê ô ơ ư đ), and Latin Extended Additional for the
 * precomposed vowel-plus-tone forms (ế ộ ừ), plus combining marks for the
 * decomposed spelling.
 */
const DISALLOWED_SCRIPT =
  /[^0-9A-Za-zÀ-ɏ̀-ͯḀ-ỿ .,!?;:'"()\-/&+=@_%]/u;

/** Caps that match create-story.dto.ts and Engine/core/prompts/sanitize.py. */
export const FIELD_LIMITS = {
  childName: 40,
  theme: 60,
  goal: 200,
  favoriteCharacter: 60,
} as const;

/**
 * Why `value` would be rejected, in the words the parent needs, or null.
 *
 * Empty is not an error here: required-ness is the caller's question, and
 * saying "chỉ hỗ trợ tiếng Việt và tiếng Anh" about an empty box would be
 * nonsense.
 */
export function childTextError(value: string): string | null {
  if (!value) return null;
  if (FULLWIDTH_FORMS.test(value)) {
    return 'Ba mẹ vui lòng không dùng ký tự rộng (fullwidth) nhé!';
  }
  if (DISALLOWED_SCRIPT.test(value.normalize('NFKC'))) {
    return 'Hiện tại chỉ hỗ trợ tiếng Việt và tiếng Anh, ba mẹ nhé!';
  }
  return null;
}
