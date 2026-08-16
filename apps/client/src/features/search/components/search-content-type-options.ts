export function getSearchContentTypeOptions(t: (value: string) => string) {
  return [
    { value: "page", label: t("Documents") },
    { value: "attachment", label: t("Attachments") },
  ];
}
