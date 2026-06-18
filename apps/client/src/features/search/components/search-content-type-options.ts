export function getSearchContentTypeOptions(t: (value: string) => string) {
  return [
    { value: "page", label: t("Pages") },
    { value: "attachment", label: t("Attachments") },
  ];
}
