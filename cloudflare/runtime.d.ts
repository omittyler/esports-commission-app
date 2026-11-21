declare module "virtual:react-router/server-build" {
  const build: import("react-router").ServerBuild;
  export = build;
}
declare module "react-dom/server.browser" {
  export { renderToReadableStream } from "react-dom/server";
}
