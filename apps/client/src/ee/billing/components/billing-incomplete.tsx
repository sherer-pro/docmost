import { Alert } from "@mantine/core";
import React from "react";
import { useTranslation } from "react-i18next";

export default function BillingIncomplete() {
  const { t } = useTranslation();
  return (
    <>
      <Alert variant="light" color="blue">
        {t(
          "Your subscription is in an incomplete state. Please refresh this page if you recently made your payment.",
        )}
      </Alert>
    </>
  );
}
