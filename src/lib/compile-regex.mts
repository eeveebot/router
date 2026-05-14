import { log } from '@eeveebot/libeevee';

/** Maximum allowed length for a regex pattern string */
const MAX_PATTERN_LENGTH = 500;

/**
 * Regex that never matches anything. Used as a safe fallback when
 * a pattern is rejected (too long, invalid, or potentially dangerous).
 */
const MATCH_NOTHING = /.^/;

/**
 * Safely compile a regex pattern string into a RegExp.
 *
 * - Rejects patterns exceeding MAX_PATTERN_LENGTH characters
 * - Catches invalid regex syntax errors
 * - Returns MATCH_NOTHING (/.^/) on failure so the registration
 *   is stored but never matches, rather than crashing the router
 *
 * @param pattern - The regex pattern string
 * @param context - Description for logging (e.g. "command regex for emote")
 * @returns Compiled RegExp, or MATCH_NOTHING on failure
 */
export function compileRegex(pattern: string, context: string): RegExp {
  if (pattern.length > MAX_PATTERN_LENGTH) {
    log.error(`Regex pattern too long (${pattern.length} chars, max ${MAX_PATTERN_LENGTH}), using no-match fallback`, {
      producer: 'router',
      context,
      patternLength: pattern.length,
    });
    return MATCH_NOTHING;
  }

  try {
    return new RegExp(pattern);
  } catch (error) {
    log.error(`Invalid regex pattern, using no-match fallback`, {
      producer: 'router',
      context,
      pattern: pattern.slice(0, 100),
      error: (error as Error).message,
    });
    return MATCH_NOTHING;
  }
}
