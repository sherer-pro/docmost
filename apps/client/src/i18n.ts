import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import Backend from "i18next-http-backend";

i18n
  // load translation using http -> see /public/locales (i.e. https://github.com/i18next/react-i18next/tree/master/example/react/public/locales)
  // learn more: https://github.com/i18next/i18next-http-backend
  // want your translations to be loaded from a professional CDN? => https://github.com/locize/react-tutorial#step-2---use-the-locize-cdn
  .use(Backend)
  // pass the i18n instance to react-i18next.
  .use(initReactI18next)
  // init i18next
  // for all options read: https://www.i18next.com/overview/configuration-options
  .init({
    fallbackLng: (code) => {
      const language = (code || '').toLowerCase();
      if (language.startsWith('ru')) return ['ru-RU'];
      if (language.startsWith('de')) return ['de-DE'];
      if (language.startsWith('es')) return ['es-ES'];
      if (language.startsWith('fr')) return ['fr-FR'];
      if (language.startsWith('it')) return ['it-IT'];
      if (language.startsWith('ja')) return ['ja-JP'];
      if (language.startsWith('ko')) return ['ko-KR'];
      if (language.startsWith('nl')) return ['nl-NL'];
      if (language.startsWith('pt')) return ['pt-BR'];
      if (language.startsWith('uk')) return ['uk-UA'];
      if (language.startsWith('zh')) return ['zh-CN'];
      return ['en-US'];
    },
    debug: false,
    load: 'all',

    interpolation: {
      escapeValue: false, // not needed for react as it escapes by default
    },
    react: {
      useSuspense: false,
    }
  });

export default i18n;
