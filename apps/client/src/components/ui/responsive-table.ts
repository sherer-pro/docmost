import clsx from "clsx";
import tableClasses from "./responsive-table.module.css";

type ResponsiveTableCellRole = "primary" | "meta" | "actions" | "details";

type ResponsiveTableCellProps = {
  "data-label": string;
  "data-card-role": ResponsiveTableCellRole;
  className?: string;
};

export function getResponsiveTableCellProps(
  label: string,
  role: ResponsiveTableCellRole = "meta",
  className?: string,
): ResponsiveTableCellProps {
  return {
    "data-label": label,
    "data-card-role": role,
    className,
  };
}

export function getResponsivePrimaryCellProps(
  label: string,
  className?: string,
): ResponsiveTableCellProps {
  return getResponsiveTableCellProps(label, "primary", className);
}

export function getResponsiveMetaCellProps(
  label: string,
  className?: string,
): ResponsiveTableCellProps {
  return getResponsiveTableCellProps(label, "meta", className);
}

export function getResponsiveActionCellProps(
  label = "",
  className?: string,
): ResponsiveTableCellProps {
  return getResponsiveTableCellProps(
    label,
    "actions",
    clsx(tableClasses.actionCell, className),
  );
}

export function getResponsiveDetailsCellProps(
  label = "",
  className?: string,
): ResponsiveTableCellProps {
  return getResponsiveTableCellProps(label, "details", className);
}
