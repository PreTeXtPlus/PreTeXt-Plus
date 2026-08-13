/** See ./README.md — browser stand-in for the `fs` API. */
const unavailable = (): never => {
  throw new Error("fs is not available in the browser");
};
export const readFileSync = unavailable;
export const existsSync = () => false;
export default { readFileSync, existsSync };
