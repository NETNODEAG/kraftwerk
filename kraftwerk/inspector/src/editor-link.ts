/** Hash route of the full-screen document editor for one concept. */
export function editorHref(bundle: string, conceptId: string): string {
  return `/edit/${encodeURIComponent(bundle)}/${conceptId.split("/").map(encodeURIComponent).join("/")}`;
}
