import React from "react";
import { describe, expect, it, vi } from "vitest";
import { SearchResultItem } from "./search-result-item";
import { buildDatabaseUrl, buildPageUrl } from "@/features/page/page.utils";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (value: string) => value,
  }),
}));

function getDetailsChildren(element: any) {
  const group = element.props.children;
  const details = group.props.children[1];
  return React.Children.toArray(details.props.children).filter(Boolean);
}

describe("SearchResultItem", () => {
  it("builds database URL for database search results and renders breadcrumbs", () => {
    const result = {
      id: "page-1",
      title: "Database Page",
      icon: "📊",
      parentPageId: "parent-1",
      databaseId: "db-1",
      slugId: "slug-1",
      creatorId: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
      rank: 1,
      highlight: "",
      breadcrumbs: [
        { id: "root", title: "Root" },
        { id: "parent", title: "Parent" },
      ],
      space: {
        id: "space-1",
        name: "Engineering",
        slug: "engineering",
      },
    };

    const element = SearchResultItem({
      result,
      isAttachmentResult: false,
      showSpace: true,
    });

    expect(element.props.to).toBe(
      buildDatabaseUrl("engineering", "slug-1", "Database Page"),
    );

    const detailsChildren = getDetailsChildren(element);
    expect(
      detailsChildren.some(
        (child: any) => child.props?.children === "Root / Parent",
      ),
    ).toBe(true);
  });

  it("builds page URL for regular page search results", () => {
    const result = {
      id: "page-1",
      title: "Regular Page",
      icon: "📄",
      parentPageId: null,
      databaseId: null,
      slugId: "slug-2",
      creatorId: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
      rank: 1,
      highlight: "",
      breadcrumbs: [],
      space: {
        id: "space-1",
        name: "Engineering",
        slug: "engineering",
      },
    };

    const element = SearchResultItem({
      result,
      isAttachmentResult: false,
      showSpace: true,
    });

    expect(element.props.to).toBe(
      buildPageUrl("engineering", "slug-2", "Regular Page"),
    );
  });

  it("does not render breadcrumbs text when breadcrumbs are missing", () => {
    const result = {
      id: "page-1",
      title: "Page Without Breadcrumbs",
      icon: "📄",
      parentPageId: null,
      databaseId: null,
      slugId: "slug-3",
      creatorId: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
      rank: 1,
      highlight: "",
      space: {
        id: "space-1",
        name: "Engineering",
        slug: "engineering",
      },
    };

    const element = SearchResultItem({
      result,
      isAttachmentResult: false,
      showSpace: true,
    });

    const detailsChildren = getDetailsChildren(element);
    expect(
      detailsChildren.some(
        (child: any) =>
          typeof child.props?.children === "string" &&
          child.props.children.includes(" / "),
      ),
    ).toBe(false);
  });

  it("renders matching page label chips", () => {
    const result = {
      id: "page-1",
      title: "Labeled Page",
      icon: "рџ“„",
      parentPageId: null,
      databaseId: null,
      slugId: "slug-4",
      creatorId: "user-1",
      createdAt: new Date(),
      updatedAt: new Date(),
      rank: 1,
      highlight: "",
      labels: [
        { id: "label-1", name: "urgent", spaceId: "space-1", type: "page" as const },
      ],
      space: {
        id: "space-1",
        name: "Engineering",
        slug: "engineering",
        icon: "",
      },
    };

    const element = SearchResultItem({
      result,
      isAttachmentResult: false,
      showSpace: false,
    });

    const detailsChildren = getDetailsChildren(element);
    const badgeGroup = detailsChildren.find((child: any) =>
      React.Children.toArray(child.props?.children).some(
        (badge: any) => badge.props?.children === "urgent",
      ),
    );

    expect(badgeGroup).toBeTruthy();
  });

  it("renders attachment download outside the linked result action", () => {
    const result = {
      id: "attachment-1",
      pageId: "page-1",
      creatorId: "user-1",
      fileName: "brief.pdf",
      highlight: "",
      createdAt: new Date(),
      updatedAt: new Date(),
      rank: 1,
      space: {
        id: "space-1",
        name: "Engineering",
        slug: "engineering",
        icon: "",
      },
      page: {
        id: "page-1",
        title: "Regular Page",
        slugId: "slug-2",
      },
    };

    const element = SearchResultItem({
      result,
      isAttachmentResult: true,
    });
    const children = React.Children.toArray(element.props.children) as any[];
    const linkedAction = children[0];
    const downloadTooltip = children[1];
    const downloadButton = downloadTooltip.props.children;

    expect(linkedAction.props.to).toBe(
      buildPageUrl("engineering", "slug-2", "Regular Page"),
    );
    expect(downloadButton.props["aria-label"]).toBe("Download attachment");
    expect(downloadButton.props.size).toBe(32);

    const openSpy = vi.fn();
    vi.stubGlobal("window", { open: openSpy });
    downloadButton.props.onClick({
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    });
    expect(openSpy).toHaveBeenCalledWith(
      "/api/attachments/files/attachment-1/brief.pdf",
      "_blank",
    );
    vi.unstubAllGlobals();
  });
});
