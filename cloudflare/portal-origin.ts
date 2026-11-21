/** Both explicitly configured hosts work during DNS propagation. Mutations
 * still require a same-host Origin; cookies never cross between the hosts. */
export function portalOriginAllowed(
  request: Request,
  configuredUrls: string[],
) {
  const origin = new URL(request.url).origin;
  return (
    request.headers.get("origin") === origin &&
    configuredUrls.some((url) => new URL(url).origin === origin)
  );
}
