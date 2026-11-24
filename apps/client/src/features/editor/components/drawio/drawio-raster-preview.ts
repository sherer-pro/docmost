// makeDrawioSvg stores the escaped model in the root and one PNG as its only
// visible child. An editor export can have the same filename and its own theme.
const wrapperStart =
  '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="';
const rasterBody =
  /^<image width="\d+" height="\d+" xlink:href="data:image\/png;base64,[A-Za-z0-9+/]+=*"\/><\/svg>$/;

// Includes the escaped 1 MiB model and the Base64-encoded 2 MiB PNG.
const maxWrapperBytes = 10 * 1024 * 1024;

export async function isDrawioRasterPreview(src: string, signal: AbortSignal) {
  const url = new URL(src, window.location.href);
  if (
    url.origin !== window.location.origin ||
    !/^\/api\/(?:attachments\/)?files\/(?:public\/)?[^/]+\/[^/]+\.svg$/i.test(
      url.pathname,
    )
  ) {
    return false;
  }

  const response = await fetch(url, { mode: "same-origin", signal });
  const reader = response.body?.getReader();
  if (!reader) return false;

  try {
    if (!response.ok) return false;
    let bytes = 0;
    let svg = "";
    const decoder = new TextDecoder();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > maxWrapperBytes) return false;
      const checkPrefix = svg.length < wrapperStart.length;
      svg += decoder.decode(value, { stream: true });
      if (checkPrefix && !svg.startsWith(wrapperStart.slice(0, svg.length))) {
        return false;
      }
    }
    svg += decoder.decode();
    const rootEnd = svg.indexOf(">");
    return (
      svg.lastIndexOf(' content="', rootEnd) !== -1 &&
      rasterBody.test(svg.slice(rootEnd + 1))
    );
  } finally {
    await reader.cancel();
  }
}
