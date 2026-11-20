import "./styles.css";

import { ApiError, api } from "./api";
import type {
  Bookmark,
  BookmarkInput,
  ListParams,
  SortKey,
  Stats,
  ViewKey,
} from "./types";

/* ------------------------------------------------------------------ */
/* Element helpers                                                     */
/* ------------------------------------------------------------------ */

function byId<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Expected element #${id} to exist`);
  }
  return element as T;
}

function create<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

interface AppState {
  bookmarks: Bookmark[];
  stats: Stats | null;
  view: ViewKey;
  q: string;
  category: string;
  sort: SortKey;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  editingId: number | null;
}

const state: AppState = {
  bookmarks: [],
  stats: null,
  view: "all",
  q: "",
  category: "",
  sort: "newest",
  loading: false,
  loaded: false,
  error: null,
  editingId: null,
};

let latestRequest = 0;
let searchTimer: number | undefined;
let toastTimer: number | undefined;

/* ------------------------------------------------------------------ */
/* Elements                                                            */
/* ------------------------------------------------------------------ */

const sidebarBackdrop = byId<HTMLElement>("sidebar-backdrop");
const menuButton = byId<HTMLButtonElement>("menu-button");
const navButtons = document.querySelectorAll<HTMLButtonElement>("[data-view]");
const categoryList = byId<HTMLElement>("category-list");
const statsTotal = byId<HTMLElement>("stats-total");
const statsFavorites = byId<HTMLElement>("stats-favorites");
const statsCategories = byId<HTMLElement>("stats-categories");
const navAllCount = byId<HTMLElement>("nav-all-count");
const navFavoritesCount = byId<HTMLElement>("nav-favorites-count");
const pageTitle = byId<HTMLElement>("page-title");
const pageSubtitle = byId<HTMLElement>("page-subtitle");
const themeToggle = byId<HTMLButtonElement>("theme-toggle");
const themeLabel = byId<HTMLElement>("theme-label");
const addButton = byId<HTMLButtonElement>("add-bookmark");
const searchForm = byId<HTMLFormElement>("search-form");
const searchInput = byId<HTMLInputElement>("search");
const sortSelect = byId<HTMLSelectElement>("sort");
const clearFiltersButton = byId<HTMLButtonElement>("clear-filters");
const resultSummary = byId<HTMLElement>("result-summary");
const activeFilter = byId<HTMLElement>("active-filter");
const toast = byId<HTMLElement>("toast");
const region = byId<HTMLElement>("bookmark-region");
const grid = byId<HTMLElement>("bookmark-grid");

const dialog = byId<HTMLDialogElement>("bookmark-dialog");
const form = byId<HTMLFormElement>("bookmark-form");
const dialogTitle = byId<HTMLElement>("dialog-title");
const dialogSubtitle = byId<HTMLElement>("dialog-subtitle");
const dialogClose = byId<HTMLButtonElement>("dialog-close");
const dialogCancel = byId<HTMLButtonElement>("dialog-cancel");
const saveButton = byId<HTMLButtonElement>("dialog-save");
const formError = byId<HTMLElement>("form-error");
const titleInput = byId<HTMLInputElement>("bookmark-title");
const urlInput = byId<HTMLInputElement>("bookmark-url");
const descriptionInput = byId<HTMLTextAreaElement>("bookmark-description");
const categoryInput = byId<HTMLInputElement>("bookmark-category");
const favoriteInput = byId<HTMLInputElement>("bookmark-favorite");
const categoryOptions = byId<HTMLDataListElement>("category-options");

const fieldErrors: Record<string, HTMLElement> = {
  title: byId<HTMLElement>("title-error"),
  url: byId<HTMLElement>("url-error"),
  description: byId<HTMLElement>("description-error"),
  category: byId<HTMLElement>("category-error"),
};

const fieldInputs: Record<string, HTMLInputElement | HTMLTextAreaElement> = {
  title: titleInput,
  url: urlInput,
  description: descriptionInput,
  category: categoryInput,
};

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

type Theme = "light" | "dark";

function applyTheme(theme: Theme, persist: boolean): void {
  document.documentElement.dataset.theme = theme;
  const isDark = theme === "dark";
  themeToggle.setAttribute("aria-pressed", String(isDark));
  themeLabel.textContent = isDark ? "Light mode" : "Dark mode";
  themeToggle.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
  if (persist) {
    try {
      localStorage.setItem("linkvault-theme", theme);
    } catch {
      /* storage can be unavailable in private mode */
    }
  }
}

function initialTheme(): Theme {
  const current = document.documentElement.dataset.theme;
  if (current === "light" || current === "dark") return current;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/* ------------------------------------------------------------------ */
/* Feedback                                                            */
/* ------------------------------------------------------------------ */

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

function showToast(message: string, type: "success" | "error" = "success"): void {
  toast.textContent = message;
  toast.className = `toast is-visible toast--${type}`;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.className = "toast";
    toast.textContent = "";
  }, 3500);
}

/* ------------------------------------------------------------------ */
/* Data loading                                                        */
/* ------------------------------------------------------------------ */

async function refresh(): Promise<void> {
  const requestId = ++latestRequest;
  state.loading = true;
  state.error = null;
  updateBusy();

  const params: ListParams = { sort: state.sort };
  if (state.q) params.q = state.q;
  if (state.category) params.category = state.category;
  if (state.view === "favorites") params.favorite = true;

  try {
    const [bookmarks, stats] = await Promise.all([api.list(params), api.stats()]);
    if (requestId !== latestRequest) return;
    state.bookmarks = bookmarks;
    state.stats = stats;
    state.loaded = true;
  } catch (error) {
    if (requestId !== latestRequest) return;
    state.error = messageOf(error);
    state.bookmarks = [];
  } finally {
    if (requestId === latestRequest) {
      state.loading = false;
      render();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

function updateBusy(): void {
  region.setAttribute("aria-busy", String(state.loading));
  region.classList.toggle("is-refreshing", state.loading && state.loaded);
}

function pluralise(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function renderStats(): void {
  const stats = state.stats;
  statsTotal.textContent = String(stats?.total ?? 0);
  statsFavorites.textContent = String(stats?.favorites ?? 0);
  statsCategories.textContent = String(stats?.categories.length ?? 0);
  navAllCount.textContent = String(stats?.total ?? 0);
  navFavoritesCount.textContent = String(stats?.favorites ?? 0);
}

function renderCategories(): void {
  categoryList.replaceChildren();
  const stats = state.stats;

  if (!stats || stats.categories.length === 0) {
    categoryList.append(create("p", "muted-note", "No categories yet."));
    return;
  }

  const entries: { label: string; value: string; count: number }[] = [
    { label: "All categories", value: "", count: stats.total },
    ...stats.categories.map((entry) => ({
      label: entry.category,
      value: entry.category,
      count: entry.count,
    })),
  ];

  for (const entry of entries) {
    const button = create("button", "category-item");
    button.type = "button";
    button.dataset.category = entry.value;
    button.dataset.testid = "category-filter";
    const isActive = state.category === entry.value;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));

    const name = create("span", "category-name", entry.label);
    const count = create("span", "category-count", String(entry.count));
    button.append(name, count);
    categoryList.append(button);
  }
}

function renderNav(): void {
  for (const button of navButtons) {
    const isActive = button.dataset.view === state.view;
    button.classList.toggle("is-active", isActive);
    if (isActive) button.setAttribute("aria-current", "true");
    else button.removeAttribute("aria-current");
  }

  const isFavorites = state.view === "favorites";
  pageTitle.textContent = isFavorites ? "Favorites" : "All bookmarks";
  pageSubtitle.textContent = isFavorites
    ? "The links you reach for most often."
    : "Every link worth keeping, in one place.";
}

function renderSummary(): void {
  if (state.loading && !state.loaded) {
    resultSummary.textContent = "Loading bookmarks…";
  } else if (state.error) {
    resultSummary.textContent = "Bookmarks could not be loaded.";
  } else {
    const count = state.bookmarks.length;
    const noun = state.view === "favorites" ? "favorite" : "bookmark";
    resultSummary.textContent = pluralise(count, noun);
  }

  const filterParts: string[] = [];
  if (state.category) filterParts.push(`Category: ${state.category}`);
  if (state.q) filterParts.push(`Search: “${state.q}”`);
  activeFilter.textContent = filterParts.join(" · ");
  activeFilter.hidden = filterParts.length === 0;
  clearFiltersButton.hidden = filterParts.length === 0;
}

function formatUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return `${parsed.hostname}${path === "/" ? "" : path}`;
  } catch {
    return raw;
  }
}

function safeHref(raw: string): string | null {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.href
      : null;
  } catch {
    return null;
  }
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Just added";
  return `Added ${new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date)}`;
}

function buildCard(bookmark: Bookmark): HTMLElement {
  const card = create("article", "card");
  card.dataset.testid = "bookmark-card";
  card.dataset.id = String(bookmark.id);

  const head = create("div", "card-head");
  const badge = create("span", "badge", bookmark.category);
  head.append(badge);

  const star = create("button", "star-button");
  star.type = "button";
  star.dataset.action = "favorite";
  star.dataset.id = String(bookmark.id);
  star.dataset.testid = "favorite-button";
  star.classList.toggle("is-active", bookmark.is_favorite);
  star.setAttribute("aria-pressed", String(bookmark.is_favorite));
  star.setAttribute(
    "aria-label",
    bookmark.is_favorite
      ? `Remove ${bookmark.title} from favorites`
      : `Add ${bookmark.title} to favorites`,
  );
  star.textContent = bookmark.is_favorite ? "★" : "☆";
  head.append(star);

  const title = create("h3", "card-title");
  const href = safeHref(bookmark.url);
  if (href) {
    const link = create("a", undefined, bookmark.title);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.title = bookmark.url;
    title.append(link);
  } else {
    title.textContent = bookmark.title;
  }

  const url = create("p", "card-url", formatUrl(bookmark.url));
  url.title = bookmark.url;

  const body = create("div", "card-body");
  body.append(title, url);
  if (bookmark.description) {
    body.append(create("p", "card-description", bookmark.description));
  }

  const foot = create("div", "card-foot");
  const time = create("time", "card-time", formatDate(bookmark.created_at));
  time.dateTime = bookmark.created_at;

  const actions = create("div", "card-actions");
  const edit = create("button", "text-button", "Edit");
  edit.type = "button";
  edit.dataset.action = "edit";
  edit.dataset.id = String(bookmark.id);
  edit.dataset.testid = "edit-bookmark";
  edit.setAttribute("aria-label", `Edit ${bookmark.title}`);

  const remove = create("button", "text-button text-button--danger", "Delete");
  remove.type = "button";
  remove.dataset.action = "delete";
  remove.dataset.id = String(bookmark.id);
  remove.dataset.testid = "delete-bookmark";
  remove.setAttribute("aria-label", `Delete ${bookmark.title}`);

  actions.append(edit, remove);
  foot.append(time, actions);

  card.append(head, body, foot);
  return card;
}

function buildSkeletons(): DocumentFragment {
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < 6; index += 1) {
    const card = create("div", "card skeleton");
    card.setAttribute("aria-hidden", "true");
    card.append(
      create("span", "skeleton-line skeleton-line--short"),
      create("span", "skeleton-line skeleton-line--title"),
      create("span", "skeleton-line"),
      create("span", "skeleton-line"),
      create("span", "skeleton-line skeleton-line--short"),
    );
    fragment.append(card);
  }
  return fragment;
}

function buildEmptyState(
  title: string,
  message: string,
  actionLabel: string,
  onAction: () => void,
): HTMLElement {
  const wrapper = create("div", "state");
  wrapper.dataset.testid = "empty-state";
  wrapper.append(
    create("span", "state-icon", "◈"),
    create("h2", "state-title", title),
    create("p", "state-text", message),
  );
  const action = create("button", "button button--primary", actionLabel);
  action.type = "button";
  action.addEventListener("click", onAction);
  wrapper.append(action);
  return wrapper;
}

function renderGrid(): void {
  grid.replaceChildren();

  if (state.loading && !state.loaded) {
    grid.append(buildSkeletons());
    return;
  }

  if (state.error) {
    const wrapper = create("div", "state state--error");
    wrapper.dataset.testid = "error-state";
    wrapper.append(
      create("span", "state-icon", "!"),
      create("h2", "state-title", "Something went wrong"),
      create("p", "state-text", state.error),
    );
    const retry = create("button", "button button--primary", "Try again");
    retry.type = "button";
    retry.addEventListener("click", () => void refresh());
    wrapper.append(retry);
    grid.append(wrapper);
    return;
  }

  if (state.bookmarks.length === 0) {
    if (state.category || state.q) {
      grid.append(
        buildEmptyState(
          "No matching bookmarks",
          "Try a different search term or category.",
          "Clear filters",
          clearFilters,
        ),
      );
    } else if (state.view === "favorites") {
      grid.append(
        buildEmptyState(
          "No favorites yet",
          "Star a bookmark and it will show up here.",
          "Browse all bookmarks",
          () => setView("all"),
        ),
      );
    } else {
      grid.append(
        buildEmptyState(
          "No bookmarks yet",
          "Save your first link to start building your vault.",
          "Add your first bookmark",
          () => openDialog(),
        ),
      );
    }
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const bookmark of state.bookmarks) {
    fragment.append(buildCard(bookmark));
  }
  grid.append(fragment);
}

function render(): void {
  renderStats();
  renderCategories();
  renderNav();
  renderSummary();
  renderGrid();
  updateBusy();
}

/* ------------------------------------------------------------------ */
/* Filters & navigation                                                */
/* ------------------------------------------------------------------ */

function closeSidebar(): void {
  document.body.classList.remove("nav-open");
  menuButton.setAttribute("aria-expanded", "false");
  menuButton.setAttribute("aria-label", "Open navigation");
  sidebarBackdrop.hidden = true;
}

function openSidebar(): void {
  document.body.classList.add("nav-open");
  menuButton.setAttribute("aria-expanded", "true");
  menuButton.setAttribute("aria-label", "Close navigation");
  sidebarBackdrop.hidden = false;
  navButtons[0]?.focus();
}

function setView(view: ViewKey): void {
  state.view = view;
  state.category = "";
  closeSidebar();
  renderNav();
  renderCategories();
  renderSummary();
  void refresh();
}

function clearFilters(): void {
  state.q = "";
  state.category = "";
  searchInput.value = "";
  void refresh();
  searchInput.focus();
}

/* ------------------------------------------------------------------ */
/* Bookmark actions                                                    */
/* ------------------------------------------------------------------ */

async function handleFavorite(bookmark: Bookmark, button: HTMLButtonElement): Promise<void> {
  button.disabled = true;
  try {
    await api.toggleFavorite(bookmark.id);
    showToast(bookmark.is_favorite ? "Removed from favorites" : "Added to favorites");
    await refresh();
  } catch (error) {
    showToast(messageOf(error), "error");
  } finally {
    button.disabled = false;
  }
}

async function handleDelete(bookmark: Bookmark, button: HTMLButtonElement): Promise<void> {
  const confirmed = window.confirm(`Delete “${bookmark.title}”? This cannot be undone.`);
  if (!confirmed) return;

  button.disabled = true;
  try {
    await api.remove(bookmark.id);
    showToast("Bookmark deleted");
    await refresh();
  } catch (error) {
    showToast(messageOf(error), "error");
    button.disabled = false;
  }
}

/* ------------------------------------------------------------------ */
/* Dialog                                                              */
/* ------------------------------------------------------------------ */

function clearFieldErrors(): void {
  formError.hidden = true;
  formError.textContent = "";
  for (const [key, element] of Object.entries(fieldErrors)) {
    element.hidden = true;
    element.textContent = "";
    fieldInputs[key]?.removeAttribute("aria-invalid");
  }
}

function setFieldError(field: string, message: string): void {
  const element = fieldErrors[field];
  if (!element) return;
  element.textContent = message;
  element.hidden = false;
  fieldInputs[field]?.setAttribute("aria-invalid", "true");
}

function populateCategories(): void {
  categoryOptions.replaceChildren();
  const seen = new Set<string>();
  for (const entry of state.stats?.categories ?? []) {
    if (seen.has(entry.category)) continue;
    seen.add(entry.category);
    const option = document.createElement("option");
    option.value = entry.category;
    categoryOptions.append(option);
  }
}

function openDialog(bookmark?: Bookmark): void {
  state.editingId = bookmark?.id ?? null;
  form.reset();
  clearFieldErrors();
  populateCategories();

  if (bookmark) {
    dialogTitle.textContent = "Edit bookmark";
    dialogSubtitle.textContent = "Update the details, then save your changes.";
    titleInput.value = bookmark.title;
    urlInput.value = bookmark.url;
    descriptionInput.value = bookmark.description;
    categoryInput.value = bookmark.category;
    favoriteInput.checked = bookmark.is_favorite;
    saveButton.textContent = "Save changes";
  } else {
    dialogTitle.textContent = "Add bookmark";
    dialogSubtitle.textContent = "Save a link and give it a home.";
    categoryInput.value = state.category;
    favoriteInput.checked = false;
    saveButton.textContent = "Save bookmark";
  }

  dialog.showModal();
  titleInput.focus();
}

function closeDialog(): void {
  dialog.close();
}

function readForm(): BookmarkInput {
  return {
    title: titleInput.value.trim(),
    url: urlInput.value.trim(),
    description: descriptionInput.value.trim(),
    category: categoryInput.value.trim() || "Uncategorized",
    is_favorite: favoriteInput.checked,
  };
}

function validate(payload: BookmarkInput): boolean {
  clearFieldErrors();
  let valid = true;

  if (!payload.title) {
    setFieldError("title", "Enter a title.");
    valid = false;
  }

  if (!payload.url) {
    setFieldError("url", "Enter a URL.");
    valid = false;
  } else {
    try {
      const parsed = new URL(payload.url);
      if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) {
        throw new Error("unsupported scheme");
      }
    } catch {
      setFieldError("url", "Enter a valid http:// or https:// URL.");
      valid = false;
    }
  }

  if (payload.description.length > 1000) {
    setFieldError("description", "Description must be 1000 characters or fewer.");
    valid = false;
  }

  if (payload.category.length > 60) {
    setFieldError("category", "Category must be 60 characters or fewer.");
    valid = false;
  }

  if (!valid) {
    formError.textContent = "Please fix the highlighted fields.";
    formError.hidden = false;
  }

  return valid;
}

function applyApiError(error: unknown): void {
  clearFieldErrors();
  const message = messageOf(error);
  formError.textContent = message;
  formError.hidden = false;

  if (error instanceof ApiError) {
    for (const detail of error.details) {
      if (detail.field in fieldErrors) {
        setFieldError(detail.field, detail.message);
      }
    }
  }
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */

function bindEvents(): void {
  themeToggle.addEventListener("click", () => {
    const next: Theme = initialTheme() === "dark" ? "light" : "dark";
    applyTheme(next, true);
  });

  addButton.addEventListener("click", () => openDialog());

  menuButton.addEventListener("click", () => {
    if (document.body.classList.contains("nav-open")) closeSidebar();
    else openSidebar();
  });

  sidebarBackdrop.addEventListener("click", closeSidebar);

  for (const button of navButtons) {
    button.addEventListener("click", () => {
      const view = button.dataset.view;
      if (view === "all" || view === "favorites") setView(view);
    });
  }

  categoryList.addEventListener("click", (event) => {
    const target = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      "button[data-category]",
    );
    if (!target) return;
    state.category = target.dataset.category ?? "";
    closeSidebar();
    renderCategories();
    void refresh();
  });

  searchForm.addEventListener("submit", (event) => {
    event.preventDefault();
    window.clearTimeout(searchTimer);
    state.q = searchInput.value.trim();
    void refresh();
  });

  searchInput.addEventListener("input", () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.q = searchInput.value.trim();
      void refresh();
    }, 250);
  });

  sortSelect.addEventListener("change", () => {
    state.sort = sortSelect.value as SortKey;
    void refresh();
  });

  clearFiltersButton.addEventListener("click", clearFilters);

  grid.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement | null)?.closest<HTMLButtonElement>(
      "button[data-action]",
    );
    if (!button) return;
    const id = Number(button.dataset.id);
    const bookmark = state.bookmarks.find((item) => item.id === id);
    if (!bookmark) return;

    if (button.dataset.action === "favorite") void handleFavorite(bookmark, button);
    else if (button.dataset.action === "edit") openDialog(bookmark);
    else if (button.dataset.action === "delete") void handleDelete(bookmark, button);
  });

  dialogClose.addEventListener("click", closeDialog);
  dialogCancel.addEventListener("click", closeDialog);
  dialog.addEventListener("close", () => {
    state.editingId = null;
    clearFieldErrors();
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const payload = readForm();
    if (!validate(payload)) {
      formError.scrollIntoView({ block: "nearest" });
      return;
    }

    const editingId = state.editingId;
    const originalLabel = saveButton.textContent ?? "Save bookmark";
    saveButton.disabled = true;
    saveButton.textContent = "Saving…";

    const action =
      editingId === null ? api.create(payload) : api.update(editingId, payload);

    action
      .then(() => {
        showToast(editingId === null ? "Bookmark added" : "Bookmark updated");
        dialog.close();
        return refresh();
      })
      .catch((error: unknown) => {
        applyApiError(error);
      })
      .finally(() => {
        saveButton.disabled = false;
        saveButton.textContent = originalLabel;
      });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.classList.contains("nav-open")) {
      closeSidebar();
      menuButton.focus();
    }
  });

  window
    .matchMedia("(min-width: 901px)")
    .addEventListener("change", (event) => {
      if (event.matches) closeSidebar();
    });
}

/* ------------------------------------------------------------------ */
/* Boot                                                                */
/* ------------------------------------------------------------------ */

applyTheme(initialTheme(), false);
sortSelect.value = state.sort;
bindEvents();
render();
void refresh();
