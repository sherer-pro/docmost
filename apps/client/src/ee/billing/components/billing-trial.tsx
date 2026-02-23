import { Alert } from "@mantine/core";
import { useBillingQuery } from "@/ee/billing/queries/billing-query.ts";
import useTrial from "@/ee/hooks/use-trial.tsx";
import { getBillingTrialDays } from '@/lib/config.ts';
import { useTranslation } from "react-i18next";

export default function BillingTrial() {
  const { t } = useTranslation();
  const { data: billing, isLoading } = useBillingQuery();
  const { trialDaysLeft } = useTrial();

  if (isLoading) {
    return null;
  }

  return (
    <>
      {trialDaysLeft > 0 && !billing && (
        <Alert title={t("billing.trial.activeTitle")} color="blue" radius="md">
          {t("billing.trial.activeBody", {
            trialDaysLeft,
            dayLabel: trialDaysLeft === 1 ? t("billing.trial.day") : t("billing.trial.days"),
            totalTrialDays: getBillingTrialDays(),
          })}
        </Alert>
      )}

      {trialDaysLeft === 0 && (
        <Alert title={t("billing.trial.endedTitle")} color="red" radius="md">
          {t("billing.trial.endedBody", { totalTrialDays: getBillingTrialDays() })}
        </Alert>
      )}
    </>
  );
}
