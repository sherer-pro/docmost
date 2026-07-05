import { Token } from 'marked';
import { getTagLabel, getValidTagValue, TagValue } from '../../tag';

interface TagToken {
  type: 'tag';
  raw: string;
  value: TagValue;
}

const tagRegex = /^::tag\[(TBD|TODO)\]/i;
const tagStartRegex = /::tag\[(?:TBD|TODO)\]/i;

export const tagExtension = {
  name: 'tag',
  level: 'inline',
  start(src: string) {
    const index = src.search(tagStartRegex);
    return index === -1 ? undefined : index;
  },
  tokenizer(src: string): TagToken | undefined {
    const match = tagRegex.exec(src);

    if (!match) {
      return;
    }

    return {
      type: 'tag',
      raw: match[0],
      value: getValidTagValue(match[1]),
    };
  },
  renderer(token: Token) {
    const tagToken = token as TagToken;
    const value = getValidTagValue(tagToken.value);

    return `<span data-type="tag" data-tag-value="${value}">${getTagLabel(value)}</span>`;
  },
};
