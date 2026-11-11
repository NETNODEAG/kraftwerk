import { deflateSync } from "node:zlib";
import { getSlides, savePresentation, type PresentationData } from "@office-kit/pptx";
import { renderSlideToImage, renderSlideToRgba } from "@office-kit/pptx-preview/node";
import { CANVAS } from "./template.js";

/**
 * Exports of a rendered deck. The PowerPoint model is the one source: the
 * PPTX is the model saved, a slide image is the model drawn by
 * pptx-preview (resvg, no browser), and the PDF is those drawings, one
 * page per slide, written by the small PDF writer below — so the file the
 * client gets, the preview in the editor and what an agent looks at are the
 * same picture.
 */

export const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export const toPptx = (pres: PresentationData): Promise<Uint8Array> => savePresentation(pres);

/** One slide as PNG, `width` pixels wide (16:9 → width × width·9/16). */
export function slidePng(pres: PresentationData, index: number, width = 1280): Uint8Array {
  const slide = getSlides(pres)[index];
  if (!slide) throw new Error(`no slide ${index + 1}`);
  return renderSlideToImage(pres, slide, { width });
}

/** Every slide as PNG. */
export const slidePngs = (pres: PresentationData, width = 1280): Uint8Array[] => getSlides(pres).map((_, i) => slidePng(pres, i, width));

/**
 * The deck as PDF: each slide rasterised at `width` pixels and placed on a
 * page of the canvas size in points. Images are raw RGB under FlateDecode —
 * the only encoding every PDF reader supports without a library here.
 */
export function toPdf(pres: PresentationData, size: "16:9" | "4:3" = "16:9", width = 1600): Uint8Array {
  const canvas = CANVAS[size];
  const pageW = canvas.w * 72;
  const pageH = canvas.h * 72;
  const pages = getSlides(pres).map((slide) => {
    const { image } = renderSlideToRgba(pres, slide, { width });
    const rgb = Buffer.alloc(image.width * image.height * 3);
    for (let i = 0, j = 0; i < image.data.length; i += 4, j += 3) {
      rgb[j] = image.data[i];
      rgb[j + 1] = image.data[i + 1];
      rgb[j + 2] = image.data[i + 2];
    }
    return { w: image.width, h: image.height, data: deflateSync(rgb) };
  });
  return writePdf(pages, pageW, pageH);
}

interface PdfImage {
  w: number;
  h: number;
  data: Buffer;
}

function writePdf(images: PdfImage[], pageW: number, pageH: number): Uint8Array {
  const objects: Buffer[] = [];
  const add = (body: Buffer | string): number => {
    objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1"));
    return objects.length;
  };
  // 1 catalog, 2 pages; then per slide: image, content, page.
  const catalog = add("<< /Type /Catalog /Pages 2 0 R >>");
  const pagesIdx = add(""); // placeholder, filled once the page ids are known
  const pageIds: number[] = [];
  for (const img of images) {
    const imgId = add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /Length ${img.data.length} >>\nstream\n`, "latin1"), img.data, Buffer.from("\nendstream", "latin1")]));
    const content = `q ${pageW.toFixed(2)} 0 0 ${pageH.toFixed(2)} 0 0 cm /Im0 Do Q`;
    const contentId = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    const pageId = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW.toFixed(2)} ${pageH.toFixed(2)}] /Resources << /XObject << /Im0 ${imgId} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[pagesIdx - 1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`, "latin1");

  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "latin1")];
  const offsets: number[] = [];
  let length = parts[0].length;
  objects.forEach((body, i) => {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, "latin1"), body, Buffer.from("\nendobj\n", "latin1")]);
    parts.push(chunk);
    length += chunk.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`, ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${length}\n%%EOF\n`, "latin1"));
  return new Uint8Array(Buffer.concat(parts));
}
