import { Affix, Button } from "@mantine/core";
import { useTranslation } from "react-i18next";

export default function ShareBranding() {
  const { t } = useTranslation();

  return (
    <Affix position={{ bottom: 20, right: 20 }}>
      <Button
        variant="default"
        component="a"
        target="_blank"
        href="https://docmost.com?ref=public-share"
      >
        {t("Powered by Docmost")}
      </Button>
    </Affix>
  );
}
