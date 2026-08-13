/** See ./README.md — browser stand-in for the `path` API. */
export function dirname(p: string): string {
  const i = p.replace(/\/+$/, "").lastIndexOf("/");
  if (i < 0) return ".";
  return i === 0 ? "/" : p.slice(0, i);
}
export function isAbsolute(p: string): boolean {
  return p.startsWith("/");
}
export function resolve(...parts: string[]): string {
  let out: string[] = [];
  let absolute = false;
  for (const part of parts) {
    if (!part) continue;
    if (part.startsWith("/")) {
      absolute = true;
      out = [];
    }
    for (const seg of part.split("/")) {
      if (!seg || seg === ".") continue;
      if (seg === "..") out.pop();
      else out.push(seg);
    }
  }
  return (absolute ? "/" : "") + out.join("/");
}
export default { dirname, isAbsolute, resolve };
