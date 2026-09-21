export async function api(path, options = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 8000);
  try {
    const response = await fetch(`/api${path}`, {
      credentials: "same-origin",
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "X-Helio-Request": "1",
        ...options.headers,
      },
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      if (response.status === 401 && !path.startsWith("/auth/"))
        window.dispatchEvent(new Event("session-expired"));
      throw new Error(
        typeof body.detail === "string"
          ? body.detail
          : "Could not complete the request. Please try again.",
      );
    }
    return body;
  } catch (error) {
    if (controller.signal.aborted && !options.signal?.aborted)
      throw new Error("Workspace did not respond. Reconnecting…");
    throw error;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
