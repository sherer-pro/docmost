import {
  fallbackAiConversationTitle,
  normalizeAiConversationTitle,
} from './ai-title.util';

describe('AI conversation title utilities', () => {
  it('limits generated titles to four Unicode words and 80 characters', () => {
    expect(
      normalizeAiConversationTitle(
        '"A detailed title about production readiness today."',
        'en-US',
      ),
    ).toBe('A detailed title about');
    expect(normalizeAiConversationTitle('x'.repeat(100), 'en-US')).toHaveLength(
      80,
    );
  });

  it('segments CJK titles without inserting spaces', () => {
    expect(
      normalizeAiConversationTitle(
        '人工智能 文档 搜索 上下文 额外内容',
        'zh-CN',
      ),
    ).toBe('人工智能文档');
  });

  it('builds a meaningful fallback from the first message', () => {
    expect(
      fallbackAiConversationTitle(
        JSON.stringify({
          firstMessage: 'Расскажи о плане запуска продукта завтра',
        }),
        'ru-RU',
      ),
    ).toBe('Расскажи плане запуска продукта');
  });
});
