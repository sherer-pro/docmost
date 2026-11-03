import { timeAgo } from "@/lib/time.ts";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function useTimeAgo(date: Date | string) {
  const { i18n } = useTranslation();
  const language = i18n.language;
  const [value, setValue] = useState(() => timeAgo(new Date(date), language));

  useEffect(() => {
    const update = () => setValue(timeAgo(new Date(date), language));
    update();
    const interval = setInterval(update, 5 * 1000);

    return () => clearInterval(interval);
  }, [date, language]);

  return value;
}
