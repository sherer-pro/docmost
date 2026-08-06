import { renderToStaticMarkup } from 'react-dom/server';
import { PageMentionEmail } from './page-mention-email';

describe('notification email localization', () => {
  it('renders Russian language metadata and body copy', async () => {
    const template = PageMentionEmail({
      actorName: 'Алиса',
      pageTitle: 'План',
      pageUrl: 'https://example.test/page',
      locale: 'ru-RU',
    });

    const html = renderToStaticMarkup(template);

    expect(html).toContain('lang="ru"');
    expect(html).toContain('Алиса');
    expect(html).toContain('упоминает вас на странице');
    expect(html).toContain('Все права защищены');
  });
});
