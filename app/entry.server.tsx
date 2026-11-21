import { renderToReadableStream } from "react-dom/server.browser";
import { ServerRouter } from "react-router";
import { type EntryContext } from "react-router";
import { isbot } from "isbot";
import { addDocumentResponseHeaders } from "./shopify.server";

export const streamTimeout = 5000;

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  reactRouterContext: EntryContext,
) {
  addDocumentResponseHeaders(request, responseHeaders);
  const body = await renderToReadableStream(
    <ServerRouter context={reactRouterContext} url={request.url} />,
    {
      signal: AbortSignal.timeout(streamTimeout),
      onError() {
        responseStatusCode = 500;
        console.error("Server rendering failed");
      },
    },
  );
  if (isbot(request.headers.get("user-agent") ?? "")) await body.allReady;
  responseHeaders.set("Content-Type", "text/html; charset=utf-8");
  return new Response(body, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
