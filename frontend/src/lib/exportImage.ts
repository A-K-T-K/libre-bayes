import { renderNetworkSvg, type NetworkExportOptions } from "./networkExport";
import { saveBinaryFile, saveTextFile } from "./saveFile";

/** True vector SVG -- exactly the hand-built markup, no rasterization. */
export async function exportNetworkAsSvg(opts: NetworkExportOptions, filename: string): Promise<void> {
  const { svg } = renderNetworkSvg(opts);
  await saveTextFile(svg, filename, "image/svg+xml");
}

/** True vector PDF: the same SVG is drawn into the PDF with svg2pdf.js's
 * vector primitives (paths/text/shapes), not embedded as a raster image. */
export async function exportNetworkAsPdf(opts: NetworkExportOptions, filename: string): Promise<void> {
  const { svg, width, height } = renderNetworkSvg(opts);
  const { jsPDF } = await import("jspdf");
  await import("svg2pdf.js");

  const doc = new jsPDF({
    orientation: width >= height ? "landscape" : "portrait",
    unit: "px",
    format: [width, height],
    hotfixes: ["px_scaling"],
  });

  const svgElement = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement;
  await doc.svg(svgElement, { x: 0, y: 0, width, height });

  const bytes = doc.output("arraybuffer");
  await saveBinaryFile(new Uint8Array(bytes), filename, "application/pdf");
}

/** Raster PNG, rendered from the same vector SVG at a fixed pixel-density
 * multiplier so it stays crisp rather than exporting at 1:1 canvas size. */
export async function exportNetworkAsPng(opts: NetworkExportOptions, filename: string, scale = 3): Promise<void> {
  const { svg, width, height } = renderNetworkSvg(opts);
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("could not get a 2D canvas context");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("could not encode PNG");
    const buffer = new Uint8Array(await blob.arrayBuffer());
    await saveBinaryFile(buffer, filename, "image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}
