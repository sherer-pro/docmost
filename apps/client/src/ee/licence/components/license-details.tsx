import { Badge, Table } from "@mantine/core";
import { format } from "date-fns";
import { useLicenseInfo } from "@/ee/licence/queries/license-query.ts";
import { isLicenseExpired } from "@/ee/licence/license.utils.ts";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";

export default function LicenseDetails() {
  const { t } = useTranslation();
  const { data: license, isError } = useLicenseInfo();
  const [workspace] = useAtom(workspaceAtom);

  if (!license) {
    return null;
  }
  if (isError) {
    return null;
  }

  return (
    <Table.ScrollContainer minWidth={500} py="md">
      <Table
        variant="vertical"
        verticalSpacing="sm"
        layout="fixed"
        withTableBorder
      >
        <Table.Caption>
          {t("license.details.caption")}
        </Table.Caption>
        <Table.Tbody>
          <Table.Tr>
            <Table.Th w={160}>{t("license.details.edition")}</Table.Th>
            <Table.Td>
              {t("license.details.enterprise")} {license.trial && <Badge color="green">{t("license.details.trial")}</Badge>}
            </Table.Td>
          </Table.Tr>

          <Table.Tr>
            <Table.Th>{t("license.details.licensedTo")}</Table.Th>
            <Table.Td>{license.customerName}</Table.Td>
          </Table.Tr>

          <Table.Tr>
            <Table.Th>{t("license.details.seatCount")}</Table.Th>
            <Table.Td>
              {license.seatCount} ({workspace?.memberCount} {t("license.details.used")})
            </Table.Td>
          </Table.Tr>

          <Table.Tr>
            <Table.Th>{t("license.details.issuedAt")}</Table.Th>
            <Table.Td>{format(license.issuedAt, "dd MMMM, yyyy")}</Table.Td>
          </Table.Tr>

          <Table.Tr>
            <Table.Th>{t("license.details.expiresAt")}</Table.Th>
            <Table.Td>{format(license.expiresAt, "dd MMMM, yyyy")}</Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Th>{t("license.details.licenseId")}</Table.Th>
            <Table.Td>{license.id}</Table.Td>
          </Table.Tr>
          <Table.Tr>
            <Table.Th>{t("license.details.status")}</Table.Th>
            <Table.Td>
              {isLicenseExpired(license) ? (
                <Badge color="red" variant="light">
                  {t("license.details.expired")}
                </Badge>
              ) : (
                <Badge color="blue" variant="light">
                  {t("license.details.valid")}
                </Badge>
              )}
            </Table.Td>
          </Table.Tr>
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
