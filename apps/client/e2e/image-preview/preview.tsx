import "@mantine/core/styles.css";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { ImagePreviewModal } from "../../src/features/editor/components/common/image-preview-modal";
import { MermaidDiagram } from "../../src/features/editor/components/common/mermaid-diagram";

const params = new URLSearchParams(location.search);
const [en, ru] = await Promise.all([
  fetch("/locales/en-US/translation.json").then((response) => response.json()),
  fetch("/locales/ru-RU/translation.json").then((response) => response.json()),
]);
const i18n = createInstance();
await i18n.init({
  lng: params.get("locale") ?? "en-US",
  resources: { "en-US": { translation: en }, "ru-RU": { translation: ru } },
});
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000"><rect width="1600" height="1000" fill="#edf2ff"/><path d="M100 250H1500M800 250V750" stroke="#364fc7" stroke-width="8"/><text x="800" y="150" text-anchor="middle" font-size="52" fill="#1c2c70">Large diagram</text><text x="800" y="800" text-anchor="middle" font-size="26" fill="#1c2c70">Details become readable when zoomed</text></svg>';

export function Preview() {
  const [kind, setKind] = useState<string | null>(null);
  return (
    <>
      <button onClick={() => setKind("image")}>Open image</button>
      <button onClick={() => setKind("svg")}>Open SVG</button>
      <MermaidDiagram
        source={"flowchart LR\n A[Start] --> B[Detailed diagram] --> C[End]"}
        accessibleName="Mermaid diagram"
        previewTitle="Mermaid preview"
        expandLabel="Open Mermaid"
        invalidLabel="Invalid diagram"
        showErrorDetails
      />
      <ImagePreviewModal
        opened={kind !== null}
        onClose={() => setKind(null)}
        title="Preview"
      >
        {kind === "image" ? (
          <img
            src={`data:image/svg+xml,${encodeURIComponent(svg)}`}
            alt="Large diagram"
          />
        ) : (
          <div
            role="img"
            aria-label="Inline diagram"
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
      </ImagePreviewModal>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <MantineProvider
    forceColorScheme={params.get("theme") === "dark" ? "dark" : "light"}
  >
    <I18nextProvider i18n={i18n}>
      <Preview />
    </I18nextProvider>
  </MantineProvider>,
);
