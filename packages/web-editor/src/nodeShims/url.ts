/** See ./README.md — browser stand-in for the `url` API. */
export function fileURLToPath(url: string | URL): string {
  const href = typeof url === "string" ? url : url.href;
  return decodeURIComponent(href.replace(/^file:\/\//, "")) || "/";
}
export function pathToFileURL(path: string): URL {
  return new URL(`file://${encodeURI(path).replace(/#/g, "%23")}`);
}
export default { fileURLToPath, pathToFileURL };
