const TITLE_STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'the',
  'to',
  'of',
  'in',
  'и',
  'в',
  'на',
  'о',
  'об',
  'для',
  'как',
  'що',
  'та',
]);

export function normalizeAiConversationTitle(
  value: string,
  locale = 'en-US',
  removeStopWords = false,
): string {
  const clean = value
    .replace(/[`"'«»„“”]/g, '')
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!?,:;—–-]+$/u, '');
  if (!clean) return '';

  const Segmenter = (
    Intl as typeof Intl & {
      Segmenter: new (
        locale: string,
        options: { granularity: 'word' },
      ) => {
        segment: (input: string) => Iterable<{
          segment: string;
          isWordLike?: boolean;
        }>;
      };
    }
  ).Segmenter;
  const segmenter = new Segmenter(locale || 'en-US', {
    granularity: 'word',
  });
  let words = [...segmenter.segment(clean)]
    .filter((segment) => segment.isWordLike)
    .map((segment) => segment.segment);

  if (removeStopWords) {
    const significant = words.filter(
      (word) => !TITLE_STOP_WORDS.has(word.toLocaleLowerCase(locale)),
    );
    if (significant.length > 0) words = significant;
  }

  const separator = /^(ja|zh)/i.test(locale) ? '' : ' ';
  return Array.from(words.slice(0, 4).join(separator))
    .slice(0, 80)
    .join('')
    .trim();
}

export function fallbackAiConversationTitle(
  inputSnapshot: string | null,
  locale = 'en-US',
): string {
  let firstMessage = '';
  if (inputSnapshot) {
    try {
      firstMessage = JSON.parse(inputSnapshot)?.firstMessage?.toString() ?? '';
    } catch {
      firstMessage = '';
    }
  }
  return (
    normalizeAiConversationTitle(firstMessage, locale, true) ||
    'AI conversation'
  );
}
