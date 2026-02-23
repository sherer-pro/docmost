import { useTranslation } from "react-i18next";

export default function LicenseMessage() {
  const { t } = useTranslation();

  return <>{t("license.message.unlockEnterprise")}</>;
}
