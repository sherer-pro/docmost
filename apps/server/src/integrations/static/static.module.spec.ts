import {
  injectWindowConfigScript,
  WINDOW_CONFIG_SCRIPT_TAG,
} from './static.module';

describe('injectWindowConfigScript', () => {
  it('replaces the placeholder with the runtime config script tag', () => {
    const html = '<body><div id="root"></div><!--window-config--></body>';

    expect(injectWindowConfigScript(html)).toBe(
      `<body><div id="root"></div>${WINDOW_CONFIG_SCRIPT_TAG}</body>`,
    );
  });

  it('does not duplicate an existing runtime config script tag', () => {
    const html = `<body>${WINDOW_CONFIG_SCRIPT_TAG}</body>`;

    expect(injectWindowConfigScript(html)).toBe(html);
  });

  it('injects the runtime config script before body close when no placeholder exists', () => {
    const html = '<body><div id="root"></div></body>';

    expect(injectWindowConfigScript(html)).toBe(
      `<body><div id="root"></div>${WINDOW_CONFIG_SCRIPT_TAG}\n  </body>`,
    );
  });
});
