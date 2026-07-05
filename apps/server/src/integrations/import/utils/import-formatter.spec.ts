import { load } from 'cheerio';
import { defaultHtmlFormatter } from './import-formatter';

describe('defaultHtmlFormatter', () => {
  it('builds embed nodes through Cheerio attributes instead of raw HTML strings', () => {
    const maliciousUrl =
      'https://example.com/embed?x=" onload="alert(1)" data-extra="bad';
    const $ = load('<iframe></iframe>');
    $('iframe').attr('src', maliciousUrl);
    const $root = $.root();

    defaultHtmlFormatter($, $root);

    const $embed = $root.find('div[data-type="embed"]');
    expect($embed).toHaveLength(1);
    expect($embed.attr('data-src')).toBe(maliciousUrl);
    expect($embed.attr('onload')).toBeUndefined();
    expect($embed.attr('data-extra')).toBeUndefined();
  });
});
