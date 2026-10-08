/** Client helper for authenticated dashboard actions. Throws with the server's message on failure. */
export async function postAction<T = Record<string, unknown>>(ws: string, path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`/api/app/${encodeURIComponent(ws)}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let data: { ok?: boolean; error?: string } & Record<string, unknown>;
  try {
    data = await res.json();
  } catch {
    throw new Error("Unexpected response from the server");
  }
  if (!res.ok || data.ok === false) throw new Error(data.error ?? "Request failed");
  return data as T;
}
