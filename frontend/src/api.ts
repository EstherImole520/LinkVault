import type { Bookmark, BookmarkInput, ListParams, Stats } from "./types";

export interface FieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly details: FieldError[];

  constructor(message: string, status: number, details: FieldError[] = []) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/$/, "");

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json" };
  if (init.body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(
      "Cannot reach the LinkVault server. Make sure the backend is running.",
      0,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  let data: unknown = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }

  if (!response.ok) {
    const error = (data as { error?: { message?: string; details?: FieldError[] } } | null)
      ?.error;
    throw new ApiError(
      error?.message ?? `Request failed with status ${response.status}.`,
      response.status,
      error?.details ?? [],
    );
  }

  return data as T;
}

function buildQuery(params: ListParams): string {
  const search = new URLSearchParams();
  if (params.q) search.set("q", params.q);
  if (params.category) search.set("category", params.category);
  if (params.favorite !== undefined) search.set("favorite", String(params.favorite));
  search.set("sort", params.sort);
  return search.toString();
}

export const api = {
  list(params: ListParams): Promise<Bookmark[]> {
    return request<Bookmark[]>(`/api/bookmarks?${buildQuery(params)}`);
  },
  stats(): Promise<Stats> {
    return request<Stats>("/api/stats");
  },
  create(payload: BookmarkInput): Promise<Bookmark> {
    return request<Bookmark>("/api/bookmarks", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  },
  update(id: number, payload: BookmarkInput): Promise<Bookmark> {
    return request<Bookmark>(`/api/bookmarks/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  },
  remove(id: number): Promise<void> {
    return request<void>(`/api/bookmarks/${id}`, { method: "DELETE" });
  },
  toggleFavorite(id: number, isFavorite?: boolean): Promise<Bookmark> {
    const body =
      isFavorite === undefined ? undefined : JSON.stringify({ is_favorite: isFavorite });
    return request<Bookmark>(`/api/bookmarks/${id}/favorite`, {
      method: "PATCH",
      ...(body === undefined ? {} : { body }),
    });
  },
};
