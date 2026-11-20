export interface Bookmark {
  id: number;
  title: string;
  url: string;
  description: string;
  category: string;
  is_favorite: boolean;
  created_at: string;
  updated_at: string;
}

export interface BookmarkInput {
  title: string;
  url: string;
  description: string;
  category: string;
  is_favorite: boolean;
}

export interface CategoryCount {
  category: string;
  count: number;
}

export interface Stats {
  total: number;
  favorites: number;
  categories: CategoryCount[];
}

export type SortKey = "newest" | "oldest" | "alpha";
export type ViewKey = "all" | "favorites";

export interface ListParams {
  q?: string;
  category?: string;
  favorite?: boolean;
  sort: SortKey;
}
