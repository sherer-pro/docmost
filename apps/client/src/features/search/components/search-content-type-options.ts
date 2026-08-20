export function getSearchContentTypeOptions(t: (value: string) => string) {
  return [
    { value: "all", label: t("All") },
    { value: "page", label: t("Documents") },
    { value: "attachment", label: t("Attachments") },
    { value: "dictionary", label: t("Dictionary") },
  ];
}
