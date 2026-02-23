import {
  Button,
  Card,
  List,
  ThemeIcon,
  Title,
  Text,
  Group,
  Select,
  Container,
  Stack,
  Badge,
  Flex,
  Switch,
  Alert,
} from "@mantine/core";
import { useState } from "react";
import { IconCheck, IconInfoCircle } from "@tabler/icons-react";
import { getCheckoutLink } from "@/ee/billing/services/billing-service.ts";
import { useBillingPlans } from "@/ee/billing/queries/billing-query.ts";
import { useAtomValue } from "jotai";
import { useTranslation } from "react-i18next";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom";

export default function BillingPlans() {
  const { t } = useTranslation();
  const { data: plans } = useBillingPlans();
  const workspace = useAtomValue(workspaceAtom);
  const [isAnnual, setIsAnnual] = useState(true);
  const [selectedTierValue, setSelectedTierValue] = useState<string | null>(
    null,
  );

  const handleCheckout = async (priceId: string) => {
    try {
      const checkoutLink = await getCheckoutLink({
        priceId: priceId,
      });
      window.location.href = checkoutLink.url;
    } catch (err) {
      console.error("Failed to get checkout link", err);
    }
  };

  // TODO: remove by July 30.
  // Check if workspace was created between June 28 and July 14, 2025
  const showTieredPricingNotice = (() => {
    if (!workspace?.createdAt) return false;
    const createdDate = new Date(workspace.createdAt);
    const startDate = new Date('2025-06-20');
    const endDate = new Date('2025-07-14');
    return createdDate >= startDate && createdDate <= endDate;
  })();

  if (!plans || plans.length === 0) {
    return null;
  }

  // Check if any plan is tiered
  const hasTieredPlans = plans.some(plan => plan.billingScheme === 'tiered' && plan.pricingTiers?.length > 0);
  const firstTieredPlan = plans.find(plan => plan.billingScheme === 'tiered' && plan.pricingTiers?.length > 0);

  // Set initial tier value if not set and we have tiered plans
  if (hasTieredPlans && !selectedTierValue && firstTieredPlan) {
    setSelectedTierValue(firstTieredPlan.pricingTiers[0].upTo.toString());
    return null;
  }

  // For tiered plans, ensure we have a selected tier
  if (hasTieredPlans && !selectedTierValue) {
    return null;
  }

  const selectData = firstTieredPlan?.pricingTiers
    ?.filter((tier) => !tier.custom)
    .map((tier, index) => {
      const prevMaxUsers =
        index > 0 ? firstTieredPlan.pricingTiers[index - 1].upTo : 0;
      return {
        value: tier.upTo.toString(),
        label: t("billing.plans.userRange", { min: prevMaxUsers + 1, max: tier.upTo }),
      };
    }) || [];

  return (
    <Container size="xl" py="xl">
      {/* Tiered pricing notice for eligible workspaces */}
      {showTieredPricingNotice && !hasTieredPlans && (
        <Alert
          icon={<IconInfoCircle size={16} />} 
          title={t("billing.plans.oldTieredPricingTitle")} 
          color="blue"
          mb="lg"
        >
          {t("billing.plans.oldTieredPricingBody")}
        </Alert>
      )}

      {/* Controls Section */}
      <Stack gap="xl" mb="md">
        {/* Team Size and Billing Controls */}
        <Group justify="center" align="center" gap="sm">
          {hasTieredPlans && (
            <Select
              label={t("billing.plans.teamSize")}
              description={t("billing.plans.selectUsersCount")}
              value={selectedTierValue}
              onChange={setSelectedTierValue}
              data={selectData}
              w={250}
              size="md"
              allowDeselect={false}
            />
          )}

          <Group justify="center" align="start">
            <Flex justify="center" gap="md" align="center">
              <Text size="md">{t("billing.plans.monthly")}</Text>
              <Switch
                defaultChecked={isAnnual}
                onChange={(event) => setIsAnnual(event.target.checked)}
                size="sm"
              />
              <Text size="md">
                {t("billing.plans.annually")}
                <Badge component="span" variant="light" color="blue">
                  {t("billing.plans.fifteenPercentOff")}
                </Badge>
              </Text>
            </Flex>
          </Group>
        </Group>
      </Stack>

      {/* Plans Grid */}
      <Group justify="center" gap="lg" align="stretch">
        {plans.map((plan, index) => {
          let price;
          let displayPrice;
          const priceId = isAnnual ? plan.yearlyId : plan.monthlyId;

          if (plan.billingScheme === 'tiered' && plan.pricingTiers?.length > 0) {
            // Tiered billing logic
            const planSelectedTier =
              plan.pricingTiers.find(
                (tier) => tier.upTo.toString() === selectedTierValue,
              ) || plan.pricingTiers[0];

            price = isAnnual
              ? planSelectedTier.yearly
              : planSelectedTier.monthly;
            displayPrice = isAnnual ? (price / 12).toFixed(0) : price;
          } else {
            // Per-unit billing logic
            const monthlyPrice = parseFloat(plan.price?.monthly || '0');
            const yearlyPrice = parseFloat(plan.price?.yearly || '0');
            price = isAnnual ? yearlyPrice : monthlyPrice;
            displayPrice = isAnnual ? (yearlyPrice / 12).toFixed(0) : monthlyPrice;
          }

          return (
            <Card
              key={plan.name}
              withBorder
              radius="lg"
              shadow="sm"
              p="xl"
              w={350}
              miw={300}
              style={{
                position: "relative",
              }}
            >
              <Stack gap="lg">
                {/* Plan Header */}
                <Stack gap="xs">
                  <Title order={3} size="h4">
                    {plan.name}
                  </Title>
                  {plan.description && (
                    <Text size="sm" c="dimmed">
                      {plan.description}
                    </Text>
                  )}
                </Stack>

                {/* Pricing */}
                <Stack gap="xs">
                  <Group align="baseline" gap="xs">
                    <Title order={1} size="h1">
                      ${displayPrice}
                    </Title>
                    <Text size="lg" c="dimmed">
                      {plan.billingScheme === 'per_unit' 
                        ? t("billing.plans.perUserMonth")
                        : t("billing.plans.perMonth")}
                    </Text>
                  </Group>
                  <Text size="sm" c="dimmed">
                    {isAnnual ? t("billing.plans.billedAnnually") : t("billing.plans.billedMonthly")}
                  </Text>
                  {plan.billingScheme === 'tiered' && plan.pricingTiers && (
                    <Text size="md" fw={500}>
                      {t("billing.plans.forUsers", { count: plan.pricingTiers.find(tier => tier.upTo.toString() === selectedTierValue)?.upTo || plan.pricingTiers[0].upTo })}
                    </Text>
                  )}
                </Stack>

                {/* CTA Button */}
                <Button onClick={() => handleCheckout(priceId)} fullWidth>
                  {t("billing.plans.subscribe")}
                </Button>

                {/* Features */}
                <List
                  spacing="xs"
                  size="sm"
                  icon={
                    <ThemeIcon size={20} radius="xl">
                      <IconCheck size={14} />
                    </ThemeIcon>
                  }
                >
                  {plan.features.map((feature, featureIndex) => (
                    <List.Item key={featureIndex}>{feature}</List.Item>
                  ))}
                </List>
              </Stack>
            </Card>
          );
        })}
      </Group>
    </Container>
  );
}
