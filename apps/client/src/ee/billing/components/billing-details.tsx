import {
  useBillingPlans,
  useBillingQuery,
} from "@/ee/billing/queries/billing-query.ts";
import { Group, Text, SimpleGrid, Paper } from "@mantine/core";
import classes from "./billing.module.css";
import { format } from "date-fns";
import { formatInterval } from "@/ee/billing/utils.ts";
import { useTranslation } from "react-i18next";

export default function BillingDetails() {
  const { t } = useTranslation();
  const { data: billing } = useBillingQuery();
  const { data: plans } = useBillingPlans();

  if (!billing || !plans) {
    return null;
  }

  return (
    <div className={classes.root}>
      <SimpleGrid cols={{ base: 1, xs: 2, sm: 3 }}>
        <Paper p="md" radius="md">
          <Group justify="apart">
            <div>
              <Text
                c="dimmed"
                tt="uppercase"
                fw={700}
                fz="xs"
                className={classes.label}
              >
                {t("Plan")}
              </Text>
              <Text fw={700} fz="lg" tt="capitalize">
                {plans.find(
                  (plan) => plan.productId === billing.stripeProductId,
                )?.name ||
                  billing.planName ||
                  t("Standard")}
              </Text>
            </div>
          </Group>
        </Paper>

        <Paper p="md" radius="md">
          <Group justify="apart">
            <div>
              <Text
                c="dimmed"
                tt="uppercase"
                fw={700}
                fz="xs"
                className={classes.label}
              >
                {t("Billing Period")}
              </Text>
              <Text fw={700} fz="lg" tt="capitalize">
                {formatInterval(billing.interval)}
              </Text>
            </div>
          </Group>
        </Paper>

        <Paper p="md" radius="md">
          <Group justify="apart">
            <div>
              <Text
                c="dimmed"
                tt="uppercase"
                fw={700}
                fz="xs"
                className={classes.label}
              >
                {billing.cancelAtPeriodEnd
                  ? t("Cancellation date")
                  : t("Renewal date")}
              </Text>
              <Text fw={700} fz="lg">
                {format(billing.periodEndAt, "dd MMM, yyyy")}
              </Text>
            </div>
          </Group>
        </Paper>
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, xs: 2, sm: 3 }}>
        <Paper p="md" radius="md">
          <Group justify="apart">
            <div>
              <Text
                c="dimmed"
                tt="uppercase"
                fw={700}
                fz="xs"
                className={classes.label}
              >
                {t("Seat count")}
              </Text>
              <Text fw={700} fz="lg">
                {billing.quantity}
              </Text>
            </div>
          </Group>
        </Paper>

        <Paper p="md" radius="md">
          <Group justify="apart">
            <div>
              <Text
                c="dimmed"
                tt="uppercase"
                fw={700}
                fz="xs"
                className={classes.label}
              >
                {t("Cost")}
              </Text>
              {billing.billingScheme === "tiered" && (
                <>
                  <Text fw={700} fz="lg">
                    ${billing.amount / 100} {billing.currency.toUpperCase()} /{" "}
                    {billing.interval}
                  </Text>
                  <Text c="dimmed" fz="sm">
                    {t("per {{interval}}", { interval: billing.interval })}
                  </Text>
                </>
              )}

              {billing.billingScheme !== "tiered" && (
                <>
                  <Text fw={700} fz="lg">
                    {(billing.amount / 100) * billing.quantity}{" "}
                    {billing.currency.toUpperCase()} / {billing.interval}
                  </Text>
                  <Text c="dimmed" fz="sm">
                    ${billing.amount / 100} /user/{billing.interval}
                  </Text>
                </>
              )}
            </div>
          </Group>
        </Paper>

        {billing.billingScheme === "tiered" && billing.tieredUpTo && (
          <Paper p="md" radius="md">
            <Group justify="apart">
              <div>
                <Text
                  c="dimmed"
                  tt="uppercase"
                  fw={700}
                  fz="xs"
                  className={classes.label}
                >
                  {t("Current Tier")}
                </Text>
                <Text fw={700} fz="lg">
                  {t("For {{count}} users", {
                    count: Number(billing.tieredUpTo),
                  })}
                </Text>
                {/*billing.tieredFlatAmount && (
                  <Text c="dimmed" fz="sm">
                  </Text>
                )*/}
              </div>
            </Group>
          </Paper>
        )}
      </SimpleGrid>
    </div>
  );
}
