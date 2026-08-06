const translations = {
  en: {
    title: "Docmost - offline",
    heading: "You are offline",
    message:
      "There is no network connection. When the internet is available again, refresh the page to load the latest data.",
    retry: "Try again",
  },
  ru: {
    title: "Docmost - офлайн",
    heading: "Вы офлайн",
    message:
      "Подключение к сети отсутствует. Когда интернет снова станет доступен, обновите страницу, чтобы загрузить актуальные данные.",
    retry: "Повторить",
  },
};

const language = navigator.language?.toLowerCase().startsWith("ru")
  ? "ru"
  : "en";
const copy = translations[language];

document.documentElement.lang = language;
document.title = copy.title;
document.querySelector("[data-offline-heading]").textContent = copy.heading;
document.querySelector("[data-offline-message]").textContent = copy.message;
document.querySelector("[data-offline-retry]").textContent = copy.retry;

document
  .querySelector("[data-offline-retry]")
  .addEventListener("click", () => window.location.reload());
