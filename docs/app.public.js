const PUBLIC_CACHE_URL = "./data/news.json"
const SOURCES_CONFIG_URL = "../config/sources.json"
const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000
const SEEN_ITEMS_STORAGE_KEY = "cinema-news-seen-items"
const READER_SPEEDS = [0.85, 1, 1.2, 1.5]
const PROVIDER_ACCENTS = {
  TV4: "#ff6f66",
  "SVT Play": "#2fe4ff",
  "Amerikansk media": "#3c6bff",
  BBC: "#bd43ff",
  Omni: "#ffe26a",
  "El Comercio": "#ffb870",
  WSJ: "#e8cfb0",
  TechCrunch: "#4fd7a1",
  "The Verge": "#ff7aa8",
  Aftonbladet: "#ffd34d",
  Expressen: "#ff7c70",
  "Sveriges Radio": "#69f0d2",
}

const state = {
  payload: null,
  sourceCatalog: [],
  activeSvtSourceId: null,
  activeNewsroomSourceByProvider: {},
  hlsInstance: null,
  isRefreshing: false,
  autoRefreshTriggered: false,
  pollTimer: null,
  itemMap: new Map(),
  queues: {},
  currentQueueKey: null,
  currentQueueIndex: -1,
  currentItemId: null,
  currentModal: null,
  speechRateIndex: 1,
  seenItemIds: new Set(),
  activeRefreshElement: null,
}

const elements = {
  hero: document.querySelector("#hero"),
  generatedAt: document.querySelector("#generatedAt"),
  sourceCount: document.querySelector("#sourceCount"),
  storyCount: document.querySelector("#storyCount"),
  refreshButton: document.querySelector("#refreshButton"),
  refreshCommand: document.querySelector("#refreshCommand"),
  refreshMessage: document.querySelector("#refreshMessage"),
  tv4Rail: document.querySelector("#tv4Rail"),
  tv4Refresh: document.querySelector("#tv4Refresh"),
  tv4ViewAll: document.querySelector("#tv4ViewAll"),
  svtTabs: document.querySelector("#svtTabs"),
  svtRail: document.querySelector("#svtRail"),
  svtRefresh: document.querySelector("#svtRefresh"),
  svtViewAll: document.querySelector("#svtViewAll"),
  foxFeature: document.querySelector("#foxFeature"),
  foxRail: document.querySelector("#foxRail"),
  foxRefresh: document.querySelector("#foxRefresh"),
  foxViewAll: document.querySelector("#foxViewAll"),
  bbcList: document.querySelector("#bbcList"),
  bbcRefresh: document.querySelector("#bbcRefresh"),
  bbcViewAll: document.querySelector("#bbcViewAll"),
  newsroomHub: document.querySelector("#newsroomHub"),
  liveFeature: document.querySelector("#liveFeature"),
  liveRail: document.querySelector("#liveRail"),
  liveRefresh: document.querySelector("#liveRefresh"),
  bottomNavItems: Array.from(document.querySelectorAll(".bottom-nav__item")),
  playerModal: document.querySelector("#playerModal"),
  playerFrame: document.querySelector("#playerFrame"),
  playerVideo: document.querySelector("#playerVideo"),
  playerTitle: document.querySelector("#playerTitle"),
  playerFallback: document.querySelector("#playerFallback"),
  playerPrev: document.querySelector("#playerPrev"),
  playerNext: document.querySelector("#playerNext"),
  closePlayer: document.querySelector("#closePlayer"),
  readerModal: document.querySelector("#readerModal"),
  readerTitle: document.querySelector("#readerTitle"),
  readerHero: document.querySelector("#readerHero"),
  readerSource: document.querySelector("#readerSource"),
  readerDate: document.querySelector("#readerDate"),
  readerSummary: document.querySelector("#readerSummary"),
  readerBody: document.querySelector("#readerBody"),
  readerFallback: document.querySelector("#readerFallback"),
  closeReader: document.querySelector("#closeReader"),
  readerPrev: document.querySelector("#readerPrev"),
  readerSpeak: document.querySelector("#readerSpeak"),
  readerNext: document.querySelector("#readerNext"),
  readerSpeed: document.querySelector("#readerSpeed"),
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
}

function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function trimText(value, maxLength = 130) {
  const text = String(value ?? "").trim()
  if (!text) return ""
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 1).trimEnd()}...`
}

function formatDate(value) {
  if (!value) return "Time pending"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat("sv-SE", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function newestFirst(items) {
  return [...items].sort((left, right) => {
    const leftDate = left.published_at ? new Date(left.published_at).getTime() : 0
    const rightDate = right.published_at ? new Date(right.published_at).getTime() : 0
    if (leftDate === rightDate) return (left.sort_order ?? 0) - (right.sort_order ?? 0)
    return rightDate - leftDate
  })
}

function normalizeSource(source) {
  return {
    id: source.id,
    name: source.name,
    provider: source.provider || source.name,
    category: source.category || "Story",
    description: source.description || "",
    display_url: source.display_url || source.displayUrl || "#",
    fetch_url: source.fetch_url || source.fetchUrl || "#",
    surface: source.surface || "video",
    source_kind: source.source_kind || source.sourceKind || "video",
    live_section: Boolean(source.live_section ?? source.liveSection),
    status: source.status || "pending",
    article_count: source.article_count ?? (source.articles || []).length,
    priority_split: source.priority_split ?? source.prioritySplit ?? 0,
    articles: Array.isArray(source.articles) ? source.articles : [],
  }
}

function mergeCatalogWithPayload(payload) {
  const payloadSources = (payload?.sources || []).map((source) => normalizeSource(source))
  const payloadMap = new Map(payloadSources.map((source) => [source.id, source]))
  const baseSources = state.sourceCatalog.length ? state.sourceCatalog : payloadSources
  const sources = baseSources.map((source) => {
    const base = normalizeSource(source)
    const cached = payloadMap.get(base.id)
    return cached
      ? {
          ...base,
          ...cached,
          display_url: cached.display_url || base.display_url,
          fetch_url: cached.fetch_url || base.fetch_url,
          surface: cached.surface || base.surface,
          source_kind: cached.source_kind || base.source_kind,
          live_section: Boolean(cached.live_section ?? base.live_section),
          articles: cached.articles || [],
          article_count: cached.article_count ?? (cached.articles || []).length,
        }
      : base
  })

  for (const cached of payloadSources) {
    if (!sources.some((source) => source.id === cached.id)) sources.push(cached)
  }

  return {
    generated_at: payload?.generated_at || null,
    update_interval_minutes: payload?.update_interval_minutes || 20,
    sources,
  }
}

function allSources() {
  return state.payload?.sources ?? []
}

function sourceById(id) {
  return allSources().find((source) => source.id === id) || null
}

function providerSources(provider) {
  return allSources().filter((source) => source.provider === provider)
}

function allItems() {
  return newestFirst(allSources().flatMap((source) => source.articles || []))
}

function payloadSources(payload) {
  return (payload?.sources || []).map((source) => normalizeSource(source))
}

function sourceByIdFromPayload(payload, id) {
  return payloadSources(payload).find((source) => source.id === id) || null
}

function providerSourcesFromPayload(payload, provider) {
  return payloadSources(payload).filter((source) => source.provider === provider)
}

function nonLiveItems(items) {
  return items.filter((item) => !item.is_live)
}

function allVideos() {
  return nonLiveItems(allItems()).filter((item) => item.article_type === "video")
}

function newsroomSources() {
  return allSources().filter((source) => source.surface === "newsroom")
}

function newsroomGroups() {
  const groups = new Map()
  for (const source of newsroomSources()) {
    if (!groups.has(source.provider)) groups.set(source.provider, [])
    groups.get(source.provider).push(source)
  }
  return Array.from(groups.entries())
}

function liveItems() {
  return newestFirst(
    allSources().flatMap((source) =>
      (source.articles || []).filter((item) => source.surface === "live" || item.is_live)
    )
  )
}

function itemsForRefreshScope(payload, scope = { kind: "all" }) {
  const resolvedScope = scope || { kind: "all" }
  let items = []

  if (resolvedScope.kind === "source") {
    const source = sourceByIdFromPayload(payload, resolvedScope.sourceId)
    items = newestFirst(source?.articles || [])
    if ((resolvedScope.filter || "regular") === "regular" && source?.surface !== "live") return nonLiveItems(items)
    return items
  }

  if (resolvedScope.kind === "provider") {
    items = newestFirst(providerSourcesFromPayload(payload, resolvedScope.provider).flatMap((source) => source.articles || []))
    if ((resolvedScope.filter || "regular") === "regular") return nonLiveItems(items)
    return items
  }

  if (resolvedScope.kind === "live") return newestFirst(
    payloadSources(payload).flatMap((source) =>
      (source.articles || []).filter((item) => source.surface === "live" || item.is_live)
    )
  )

  return newestFirst(payloadSources(payload).flatMap((source) => source.articles || []))
}

function refreshScopeTitle(scope = { kind: "all" }) {
  if (!scope || scope.kind === "all") return "alla kallor"
  return scope.label || scope.provider || scope.sourceId || "sektionen"
}

function refreshScopeAttributes(scope = { kind: "all" }) {
  const attributes = [`data-action="refresh-scope"`]
  if (scope.kind) attributes.push(`data-refresh-kind="${escapeHtml(scope.kind)}"`)
  if (scope.provider) attributes.push(`data-refresh-provider="${escapeHtml(scope.provider)}"`)
  if (scope.sourceId) attributes.push(`data-refresh-source-id="${escapeHtml(scope.sourceId)}"`)
  if (scope.label) attributes.push(`data-refresh-label="${escapeHtml(scope.label)}"`)
  if (scope.filter) attributes.push(`data-refresh-filter="${escapeHtml(scope.filter)}"`)
  if (scope.target) attributes.push(`data-refresh-target="${escapeHtml(scope.target)}"`)
  return attributes.join(" ")
}

function applyRefreshScope(element, scope, label) {
  if (!element) return
  element.dataset.action = "refresh-scope"
  element.dataset.refreshKind = scope?.kind || "all"
  element.dataset.refreshProvider = scope?.provider || ""
  element.dataset.refreshSourceId = scope?.sourceId || ""
  element.dataset.refreshLabel = scope?.label || ""
  element.dataset.refreshFilter = scope?.filter || ""
  element.dataset.refreshTarget = scope?.target || ""
  if (label) element.textContent = label
}

function readRefreshScope(target) {
  if (!target?.dataset) return { kind: "all", label: "alla kallor" }
  return {
    kind: target.dataset.refreshKind || "all",
    provider: target.dataset.refreshProvider || "",
    sourceId: target.dataset.refreshSourceId || "",
    label: target.dataset.refreshLabel || "",
    filter: target.dataset.refreshFilter || "",
    target: target.dataset.refreshTarget || "",
  }
}

function newItemsForScope(previousPayload, nextPayload, scope) {
  const previousIds = new Set(itemsForRefreshScope(previousPayload, scope).map((item) => item.id))
  return itemsForRefreshScope(nextPayload, scope).filter((item) => !previousIds.has(item.id))
}

function sourceListSummary(items, max = 3) {
  const titles = items
    .slice(0, max)
    .map((item) => trimText(item.title, 58))
    .filter(Boolean)

  if (!titles.length) return ""
  if (titles.length === 1) return titles[0]
  if (titles.length === 2) return `${titles[0]} och ${titles[1]}`
  return `${titles.slice(0, -1).join(", ")} och ${titles[titles.length - 1]}`
}

function foundItemsMessage(scopeTitle, items, overflowLabel) {
  const count = items.length
  const summary = sourceListSummary(items)
  const itemWord = count === 1 ? "ny post" : "nya poster"
  if (!summary) return `Vi hittade ${count} ${itemWord} i ${scopeTitle}.`
  return `Vi hittade ${count} ${itemWord} i ${scopeTitle}: ${summary}${count > 3 ? ` ${overflowLabel}` : "."}`
}

function featuredLeadItem() {
  const tv4Primary = sourceById("tv4-nyheterna")
  if (tv4Primary?.articles?.length) return nonLiveItems(newestFirst(tv4Primary.articles))[0]
  return allVideos()[0] || allItems()[0] || null
}

function providerAccent(provider) {
  return PROVIDER_ACCENTS[provider] || "#2fe4ff"
}

function cardBackground(url, overlay) {
  if (!url) return ""
  return `style="background-image:${overlay},url('${escapeHtml(url)}')"`
}

function queueDataset(item, queueKey) {
  return `data-item-id="${escapeHtml(item.id)}" data-queue-key="${escapeHtml(queueKey)}"`
}

function registerQueue(queueKey, items) {
  state.queues[queueKey] = items.map((item) => item.id)
  return queueKey
}

function itemById(id) {
  return state.itemMap.get(id) || null
}

function currentQueueIds() {
  return state.queues[state.currentQueueKey] || []
}

function currentItem() {
  return itemById(state.currentItemId)
}

function loadSeenItemIds() {
  try {
    const raw = window.localStorage.getItem(SEEN_ITEMS_STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed : [])
  } catch (error) {
    return new Set()
  }
}

function persistSeenItemIds() {
  try {
    window.localStorage.setItem(SEEN_ITEMS_STORAGE_KEY, JSON.stringify([...state.seenItemIds]))
  } catch (error) {
    // Ignore storage failures and continue rendering.
  }
}

function isItemNew(item) {
  return Boolean(item?.id) && !state.seenItemIds.has(item.id)
}

function updateSeenMarkers(itemId) {
  document.querySelectorAll(`[data-item-id="${itemId}"]`).forEach((button) => {
    button.closest(".story-card")?.classList.remove("story-card--new")
    button.closest(".feature-panel")?.classList.remove("feature-panel--new")
    button.closest(".bbc-item")?.classList.remove("bbc-item--new")
    button.querySelectorAll(".story-new-badge").forEach((badge) => badge.remove())
  })
}

function markItemSeen(itemId) {
  if (!itemId || state.seenItemIds.has(itemId)) return
  state.seenItemIds.add(itemId)
  persistSeenItemIds()
  updateSeenMarkers(itemId)
}

function itemKindLabel(item) {
  if (item.is_live) return "LIVE"
  return item.article_type === "video" ? "VIDEO" : "TEXT"
}

function itemActionLabel(item) {
  return item.article_type === "video" ? "Watch" : "Play text"
}

function itemMeta(item) {
  return [item.source_name, item.category].filter(Boolean).join(" / ")
}

function buildItemMap() {
  state.itemMap = new Map()
  for (const item of allItems()) state.itemMap.set(item.id, item)
}

function emptyState(label, href, message, refreshScope = { kind: "all", label }) {
  return `
    <div class="empty-state">
      <strong>${escapeHtml(message)}</strong>
      <p>Tryck pa Hamta ${escapeHtml(refreshScopeTitle(refreshScope))} for att lasa om senaste publika cache for just den har delen av nyhetsvaggen. Alla med lank kan anvanda sidan utan login.</p>
      <div class="empty-state__actions">
        <button class="pill pill--action" type="button" ${refreshScopeAttributes(refreshScope)}>Hamta ${escapeHtml(refreshScopeTitle(refreshScope))}</button>
        <a class="section-link" href="${escapeHtml(href || "#")}" target="_blank" rel="noreferrer">Oppna ${escapeHtml(label)}</a>
      </div>
    </div>
  `
}

function newBadgeMarkup(item) {
  return isItemNew(item) ? `<span class="story-new-badge">Nytt</span>` : ""
}

function renderStoryCard(item, queueKey, variant = "standard") {
  const summary = trimText(item.summary || item.body_text, variant === "compact" ? 88 : 128)
  const overlay =
    item.article_type === "video"
      ? "linear-gradient(180deg, rgba(5, 8, 14, 0.12), rgba(5, 8, 14, 0.98))"
      : "linear-gradient(180deg, rgba(5, 8, 14, 0.12), rgba(5, 8, 14, 0.92)), linear-gradient(135deg, rgba(47, 228, 255, 0.16), rgba(7, 9, 13, 0.5))"

  return `
    <article class="story-card story-card--${escapeHtml(variant)} story-card--${escapeHtml(item.article_type)} ${item.is_live ? "story-card--live" : ""} ${isItemNew(item) ? "story-card--new" : ""}">
      <button class="story-card__button" type="button" ${queueDataset(item, queueKey)}>
        <div class="story-card__media" ${cardBackground(item.image_url, overlay)}>
          ${newBadgeMarkup(item)}
        </div>
        <div class="story-card__overlay">
          <div class="story-card__eyebrow">
            <span class="story-chip">${escapeHtml(itemKindLabel(item))}</span>
            <span class="video-card__meta">${escapeHtml(itemMeta(item))}</span>
          </div>
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(summary || "Oppna artikeln for att lasa eller spela upp mer.")}</p>
          <div class="story-card__footer">
            <span class="video-card__date">${escapeHtml(formatDate(item.published_at))}</span>
            <span class="story-card__cta">${escapeHtml(itemActionLabel(item))}</span>
          </div>
        </div>
      </button>
    </article>
  `
}

function renderFeaturePanel(item, queueKey, accentLabel) {
  return `
    <article class="feature-panel ${item.is_live ? "feature-panel--live" : ""} ${isItemNew(item) ? "feature-panel--new" : ""}">
      <button class="feature-panel__button" type="button" ${queueDataset(item, queueKey)}>
        <div
          class="feature-panel__media"
          ${cardBackground(item.image_url, "linear-gradient(180deg, rgba(5, 8, 14, 0.08), rgba(5, 8, 14, 0.98))")}
        >
          ${newBadgeMarkup(item)}
        </div>
        <div class="feature-panel__content">
          <span class="feature-panel__label">${escapeHtml(accentLabel || itemKindLabel(item))}</span>
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(trimText(item.summary || item.body_text, 180) || "Oppna detta inslag for att lasa, lyssna eller titta vidare.")}</p>
          <span class="feature-panel__cta">${escapeHtml(itemActionLabel(item))}</span>
        </div>
      </button>
    </article>
  `
}

function renderBbcItem(item, queueKey) {
  return `
    <article class="bbc-item ${isItemNew(item) ? "bbc-item--new" : ""}">
      <button class="bbc-item__button" type="button" ${queueDataset(item, queueKey)}>
        <div
          class="bbc-item__thumb"
          ${cardBackground(item.image_url, "linear-gradient(135deg, rgba(13, 16, 27, 0.3), rgba(13, 16, 27, 0.78))")}
        >
          ${newBadgeMarkup(item)}
        </div>
        <div class="bbc-item__copy">
          <div class="story-card__eyebrow">
            <span class="story-chip">${escapeHtml(itemKindLabel(item))}</span>
            <span class="video-card__meta">${escapeHtml(item.category || "BBC")}</span>
          </div>
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(trimText(item.summary || item.body_text, 92))}</span>
          <small>${escapeHtml(formatDate(item.published_at))}</small>
        </div>
      </button>
    </article>
  `
}

function renderHero() {
  const featured = featuredLeadItem()
  const queueKey = registerQueue("all-latest", allItems())
  const allScope = { kind: "all", label: "alla kallor", target: "#homeSection" }

  if (!featured) {
    elements.hero.innerHTML = `
      <div class="hero__backdrop"></div>
      <div class="hero__content">
        <div class="badge-row">
          <span class="hero-badge hero-badge--hot">Breaking news</span>
          <span class="hero-badge">Public cache</span>
        </div>
        <h1 class="hero__title">The cinematic news wall is loading.</h1>
        <p class="hero__summary">Sidan ar oppen for alla. Tryck pa Hamta alla kallor for att lasa om den senaste publika cachen nar som helst.</p>
        <div class="hero__actions">
          <button class="hero-button hero-button--primary" type="button" ${refreshScopeAttributes(allScope)}>Hamta alla kallor</button>
          <a class="hero-button hero-button--secondary" href="https://www.tv4play.se/nyheter" target="_blank" rel="noreferrer">Oppna kalla</a>
        </div>
      </div>
    `
    return
  }

  elements.hero.innerHTML = `
    <div
      class="hero__backdrop"
      ${cardBackground(featured.image_url, "linear-gradient(180deg, rgba(3, 6, 11, 0.18), rgba(3, 6, 11, 0.98)), linear-gradient(90deg, rgba(3, 6, 11, 0.94) 0%, rgba(3, 6, 11, 0.42) 54%, rgba(3, 6, 11, 0.88) 100%)")}
    ></div>
    <div class="hero__content">
      <div class="badge-row">
        <span class="hero-badge hero-badge--hot">${escapeHtml(itemKindLabel(featured))}</span>
        <span class="hero-badge">${escapeHtml(featured.provider)}</span>
      </div>
      <h1 class="hero__title">${escapeHtml(featured.title)}</h1>
      <p class="hero__summary">${escapeHtml(trimText(featured.summary || featured.body_text, 220) || "Latest lead item from the current news wall.")}</p>
      <div class="hero__actions">
        <button class="hero-button hero-button--primary" type="button" ${queueDataset(featured, queueKey)}>${escapeHtml(itemActionLabel(featured))}</button>
        <button class="hero-button hero-button--secondary" type="button" ${refreshScopeAttributes(allScope)}>Hamta alla kallor</button>
      </div>
      <div class="hero__meta">
        <span>${escapeHtml(featured.source_name)}</span>
        <span>${escapeHtml(formatDate(featured.published_at))}</span>
      </div>
    </div>
  `
}

function renderTv4() {
  const refreshScope = { kind: "provider", provider: "TV4", label: "TV4", filter: "regular", target: "#tv4Rail" }
  const items = nonLiveItems(newestFirst(providerSources("TV4").flatMap((source) => source.articles || []))).slice(0, 10)
  const queueKey = registerQueue("tv4", items)
  applyRefreshScope(elements.tv4Refresh, refreshScope, "Hamta TV4")
  elements.tv4ViewAll.href = sourceById("tv4-nyheterna")?.display_url || "#"
  elements.tv4Rail.innerHTML = items.length
    ? items.map((item) => renderStoryCard(item, queueKey)).join("")
    : emptyState("TV4", sourceById("tv4-nyheterna")?.display_url, "TV4-videor ar inte cachelagrade an.", refreshScope)
}

function ensureActiveSvtSource() {
  const sources = providerSources("SVT Play")
  if (!sources.length) return (state.activeSvtSourceId = null)
  if (!state.activeSvtSourceId || !sources.some((source) => source.id === state.activeSvtSourceId)) {
    state.activeSvtSourceId = sources[0].id
  }
}

function renderSvtTabs() {
  const sources = providerSources("SVT Play")
  ensureActiveSvtSource()
  elements.svtTabs.innerHTML = sources
    .map(
      (source) => `
        <button class="pill ${source.id === state.activeSvtSourceId ? "is-active" : ""}" type="button" data-svt-source="${escapeHtml(source.id)}">
          ${escapeHtml(source.name)}
        </button>
      `
    )
    .join("")
}

function renderSvtRail() {
  const source = sourceById(state.activeSvtSourceId)
  const refreshScope = {
    kind: "source",
    sourceId: source?.id || "",
    label: source ? `${source.provider} / ${source.name}` : "SVT",
    filter: "regular",
    target: "#svtRail",
  }
  const items = nonLiveItems(newestFirst(source?.articles || [])).slice(0, 10)
  const queueKey = registerQueue(`svt:${source?.id || "empty"}`, items)
  applyRefreshScope(elements.svtRefresh, refreshScope, `Hamta ${source?.name || "SVT"}`)
  if (elements.svtViewAll) elements.svtViewAll.href = source?.display_url || "#"
  elements.svtRail.innerHTML = items.length
    ? items.map((item) => renderStoryCard(item, queueKey)).join("")
    : emptyState(source?.name || "SVT", source?.display_url, "SVT-videor ar inte cachelagrade an.", refreshScope)
}

function renderFox() {
  const foxSource = sourceById("fox-news")
  const refreshScope = {
    kind: "source",
    sourceId: foxSource?.id || "",
    label: foxSource?.name || "Fox",
    filter: "regular",
    target: "#foxFeature",
  }
  const items = nonLiveItems([...(foxSource?.articles || [])].sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0)))
  const queueKey = registerQueue("fox", items)
  applyRefreshScope(elements.foxRefresh, refreshScope, "Hamta Fox")
  if (elements.foxViewAll) elements.foxViewAll.href = foxSource?.display_url || "#"
  elements.foxFeature.innerHTML = items[0]
    ? renderFeaturePanel(items[0], queueKey, "Top stories")
    : emptyState("Fox", foxSource?.display_url, "Fox-videor ar inte cachelagrade an.", refreshScope)
  elements.foxRail.innerHTML = items.slice(1, 7).map((item) => renderStoryCard(item, queueKey, "compact")).join("")
}

function renderBbc() {
  const bbcSource = sourceById("bbc-video")
  const refreshScope = {
    kind: "source",
    sourceId: bbcSource?.id || "",
    label: bbcSource?.name || "BBC",
    filter: "regular",
    target: "#bbcList",
  }
  const items = nonLiveItems(newestFirst(bbcSource?.articles || [])).slice(0, 6)
  const queueKey = registerQueue("bbc", items)
  applyRefreshScope(elements.bbcRefresh, refreshScope, "Hamta BBC")
  elements.bbcViewAll.href = bbcSource?.display_url || "#"
  elements.bbcList.innerHTML = items.length
    ? items.map((item) => renderBbcItem(item, queueKey)).join("")
    : emptyState("BBC", bbcSource?.display_url, "BBC-klipp ar inte cachelagrade an.", refreshScope)
}

function ensureActiveNewsroomTabs() {
  for (const [provider, sources] of newsroomGroups()) {
    const activeId = state.activeNewsroomSourceByProvider[provider]
    if (!activeId || !sources.some((source) => source.id === activeId)) {
      state.activeNewsroomSourceByProvider[provider] = sources[0]?.id || null
    }
  }
}

function renderNewsroomSections() {
  ensureActiveNewsroomTabs()
  elements.newsroomHub.innerHTML = newsroomGroups()
    .map(([provider, sources]) => {
      const activeSource = sourceById(state.activeNewsroomSourceByProvider[provider])
      const refreshScope = {
        kind: "source",
        sourceId: activeSource?.id || "",
        label: activeSource ? `${provider} / ${activeSource.name}` : provider,
        filter: "regular",
        target: `#provider-${slugify(provider)}`,
      }
      const items = nonLiveItems(newestFirst(activeSource?.articles || []))
      const queueKey = registerQueue(`newsroom:${slugify(provider)}:${activeSource?.id || "empty"}`, items)
      const accent = providerAccent(provider)
      return `
        <section class="stream-section stream-section--newsroom" id="provider-${escapeHtml(slugify(provider))}" style="--section-accent:${escapeHtml(accent)}">
          <div class="section-head">
            <div class="section-title">
              <span class="section-marker section-marker--dynamic" style="background:${escapeHtml(accent)}"></span>
              <h2>${escapeHtml(provider)}</h2>
            </div>
            <div class="section-actions">
              <button class="section-link section-link--button" type="button" ${refreshScopeAttributes(refreshScope)}>Hamta ${escapeHtml(activeSource?.name || provider)}</button>
              <a class="section-link" href="${escapeHtml(activeSource?.display_url || "#")}" target="_blank" rel="noreferrer">Open all</a>
            </div>
          </div>
          ${
            sources.length > 1
              ? `<div class="pill-row newsroom-tabs">${sources
                  .map(
                    (source) => `
                      <button class="pill ${source.id === activeSource?.id ? "is-active" : ""}" type="button" data-newsroom-provider="${escapeHtml(provider)}" data-newsroom-source="${escapeHtml(source.id)}">
                        ${escapeHtml(source.name)}
                      </button>
                    `
                  )
                  .join("")}</div>`
              : ""
          }
          <p class="section-caption section-caption--left">${escapeHtml(activeSource?.description || `${provider} uppdateras i samma publika cache som resten av nyhetsvaggen.`)}</p>
          ${
            items[0]
              ? `<div class="newsroom-feature">${renderFeaturePanel(items[0], queueKey, activeSource?.name || provider)}</div>
                 <div class="content-rail content-rail--compact">${items.slice(1, 8).map((item) => renderStoryCard(item, queueKey, "compact")).join("")}</div>`
              : emptyState(provider, activeSource?.display_url, `${provider} ar inte cachelagrad an.`, refreshScope)
          }
        </section>
      `
    })
    .join("")
}

function renderLive() {
  const refreshScope = { kind: "live", label: "live", filter: "all", target: "#liveHub" }
  const items = liveItems().slice(0, 8)
  const queueKey = registerQueue("live", items)
  applyRefreshScope(elements.liveRefresh, refreshScope, "Hamta live")
  elements.liveFeature.innerHTML = items[0]
    ? renderFeaturePanel(items[0], queueKey, "Live now")
    : emptyState("Live", sourceById("expressen-direkt")?.display_url, "Inga livefloden ar cachelagrade an.", refreshScope)
  elements.liveRail.innerHTML = items.slice(1).map((item) => renderStoryCard(item, queueKey, "compact")).join("")
}

function renderStatus() {
  elements.generatedAt.textContent = formatDate(state.payload?.generated_at)
  elements.sourceCount.textContent = String(allSources().length)
  elements.storyCount.textContent = String(allItems().length)
}

function render() {
  state.queues = {}
  buildItemMap()
  renderHero()
  renderTv4()
  renderSvtTabs()
  renderSvtRail()
  renderFox()
  renderBbc()
  renderNewsroomSections()
  renderLive()
  renderStatus()
  updateQueueButtons()
  updateReaderSpeedLabel()
}

function updateModalLock() {
  const modalOpen =
    Boolean(elements.playerModal && !elements.playerModal.hidden) ||
    Boolean(elements.readerModal && !elements.readerModal.hidden)
  document.body.classList.toggle("is-modal-open", modalOpen)
}

function stopPlayback() {
  if (state.hlsInstance) {
    state.hlsInstance.destroy()
    state.hlsInstance = null
  }
  elements.playerFrame.src = ""
  elements.playerFrame.hidden = true
  elements.playerVideo.pause()
  elements.playerVideo.removeAttribute("src")
  elements.playerVideo.load()
  elements.playerVideo.hidden = true
}

function playMediaSource(url) {
  const video = elements.playerVideo
  video.hidden = false
  if (window.Hls && window.Hls.isSupported() && url.endsWith(".m3u8")) {
    state.hlsInstance = new window.Hls()
    state.hlsInstance.loadSource(url)
    state.hlsInstance.attachMedia(video)
  } else {
    video.src = url
  }
  void video.play().catch(() => {})
}

function hasSpeechSupport() {
  return "speechSynthesis" in window && "SpeechSynthesisUtterance" in window
}

function languageForItem(item) {
  const provider = item?.provider || ""
  if (["Omni", "TV4", "SVT Play", "Aftonbladet", "Expressen", "Sveriges Radio"].includes(provider)) return "sv-SE"
  if (provider === "El Comercio") return "es-PE"
  return "en-US"
}

function updateReaderSpeakButton() {
  if (!elements.readerSpeak) return
  if (!hasSpeechSupport()) {
    elements.readerSpeak.textContent = "No speech"
    elements.readerSpeak.disabled = true
    return
  }
  elements.readerSpeak.disabled = false
  if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) return (elements.readerSpeak.textContent = "Pause")
  if (window.speechSynthesis.paused) return (elements.readerSpeak.textContent = "Resume")
  elements.readerSpeak.textContent = "Play text"
}

function updateReaderSpeedLabel() {
  if (!elements.readerSpeed) return
  elements.readerSpeed.textContent = `${READER_SPEEDS[state.speechRateIndex].toFixed(2).replace(/\.00$/, "")}x`
}

function cancelSpeech() {
  if (hasSpeechSupport()) window.speechSynthesis.cancel()
  updateReaderSpeakButton()
}

function textForReader(item) {
  return [item.title, item.summary, item.body_text].filter(Boolean).join(". ")
}

function startSpeechForCurrentItem() {
  const item = currentItem()
  if (!item || !hasSpeechSupport()) return
  const text = textForReader(item)
  if (!text) return
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = languageForItem(item)
  utterance.rate = READER_SPEEDS[state.speechRateIndex]
  utterance.onend = () => updateReaderSpeakButton()
  utterance.onerror = () => updateReaderSpeakButton()
  window.speechSynthesis.cancel()
  window.speechSynthesis.speak(utterance)
  updateReaderSpeakButton()
}

function toggleSpeech() {
  if (!hasSpeechSupport()) return setRefreshMessage("Din webblasare stodjer inte upplasning pa den har sidan.", "warning")
  if (window.speechSynthesis.speaking && !window.speechSynthesis.paused) {
    window.speechSynthesis.pause()
    return updateReaderSpeakButton()
  }
  if (window.speechSynthesis.paused) {
    window.speechSynthesis.resume()
    return updateReaderSpeakButton()
  }
  startSpeechForCurrentItem()
}

function cycleSpeechRate() {
  state.speechRateIndex = (state.speechRateIndex + 1) % READER_SPEEDS.length
  updateReaderSpeedLabel()
  if (hasSpeechSupport() && (window.speechSynthesis.speaking || window.speechSynthesis.paused)) startSpeechForCurrentItem()
}

function setCurrentQueue(queueKey, itemId) {
  const ids = state.queues[queueKey] || []
  state.currentQueueKey = queueKey
  state.currentQueueIndex = Math.max(ids.indexOf(itemId), 0)
  state.currentItemId = ids[state.currentQueueIndex] || itemId
  updateQueueButtons()
}

function updateQueueButtons() {
  const hasQueue = currentQueueIds().length > 1
  for (const button of [elements.playerPrev, elements.playerNext, elements.readerPrev, elements.readerNext]) {
    if (button) button.disabled = !hasQueue
  }
}

function closePlayer() {
  stopPlayback()
  elements.playerModal.hidden = true
  if (state.currentModal === "player") state.currentModal = null
  updateModalLock()
}

function closeReader() {
  cancelSpeech()
  elements.readerModal.hidden = true
  if (state.currentModal === "reader") state.currentModal = null
  updateModalLock()
}

function openPlayerFromItem(item) {
  if (!item) return
  closeReader()
  stopPlayback()
  elements.playerTitle.textContent = item.title || "Video"
  elements.playerFallback.href = item.url
  if ((item.play_mode || "page_iframe") === "media") {
    playMediaSource(item.embed_url || item.url)
  } else {
    elements.playerFrame.hidden = false
    elements.playerFrame.src = item.embed_url || item.url
  }
  elements.playerModal.hidden = false
  state.currentModal = "player"
  updateModalLock()
  updateQueueButtons()
}

function readerParagraphs(item) {
  return (item.body_text || item.summary || "")
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
}

function openReaderFromItem(item) {
  if (!item) return
  closePlayer()
  cancelSpeech()
  elements.readerTitle.textContent = item.title || "Story"
  elements.readerSource.textContent = itemMeta(item) || item.provider || "Source"
  elements.readerDate.textContent = formatDate(item.published_at)
  elements.readerFallback.href = item.url
  elements.readerSummary.textContent = item.summary || ""
  elements.readerHero.innerHTML = `
    <div class="reader-hero__image" ${cardBackground(item.image_url, "linear-gradient(135deg, rgba(7, 9, 13, 0.16), rgba(7, 9, 13, 0.84))")}></div>
    <div class="reader-hero__content">
      <span class="story-chip">${escapeHtml(itemKindLabel(item))}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <small>${escapeHtml(item.provider)}</small>
    </div>
  `
  elements.readerBody.innerHTML = readerParagraphs(item).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")
  elements.readerModal.hidden = false
  state.currentModal = "reader"
  updateModalLock()
  updateQueueButtons()
  updateReaderSpeakButton()
}

function openItemById(itemId, queueKey) {
  const item = itemById(itemId)
  if (!item) return
  markItemSeen(itemId)
  setCurrentQueue(queueKey, itemId)
  if (item.article_type === "video") return openPlayerFromItem(item)
  openReaderFromItem(item)
}

function stepQueue(direction) {
  const ids = currentQueueIds()
  if (!ids.length) return
  const nextIndex = (state.currentQueueIndex + direction + ids.length) % ids.length
  openItemById(ids[nextIndex], state.currentQueueKey)
}

function setRefreshButtonState(isRefreshing) {
  if (elements.refreshButton) {
    elements.refreshButton.disabled = isRefreshing
    elements.refreshButton.classList.toggle("is-loading", isRefreshing)
    elements.refreshButton.setAttribute("aria-busy", String(isRefreshing))
    elements.refreshButton.setAttribute("aria-label", "Hamta alla kallor")
  }
  if (elements.refreshCommand) {
    elements.refreshCommand.disabled = isRefreshing
    elements.refreshCommand.classList.toggle("is-loading", isRefreshing)
    elements.refreshCommand.textContent = isRefreshing ? "Hamtar alla kallor..." : "Hamta alla kallor"
  }
}

function setScopedRefreshElement(element) {
  if (state.activeRefreshElement && state.activeRefreshElement !== element) {
    state.activeRefreshElement.removeAttribute("aria-busy")
    if (state.activeRefreshElement instanceof HTMLButtonElement) state.activeRefreshElement.disabled = false
  }
  state.activeRefreshElement = element || null
  if (!state.activeRefreshElement) return
  state.activeRefreshElement.setAttribute("aria-busy", "true")
  if (state.activeRefreshElement instanceof HTMLButtonElement) state.activeRefreshElement.disabled = true
}

function clearScopedRefreshElement() {
  if (!state.activeRefreshElement) return
  state.activeRefreshElement.removeAttribute("aria-busy")
  if (state.activeRefreshElement instanceof HTMLButtonElement) state.activeRefreshElement.disabled = false
  state.activeRefreshElement = null
}

function setRefreshMessage(message, tone = "info") {
  if (!elements.refreshMessage) return
  if (!message) {
    elements.refreshMessage.hidden = true
    elements.refreshMessage.className = "sync-banner"
    elements.refreshMessage.textContent = ""
    return
  }
  elements.refreshMessage.hidden = false
  elements.refreshMessage.className = `sync-banner sync-banner--${tone}`
  elements.refreshMessage.textContent = message
}

function setIdleMessage() {
  const latest = featuredLeadItem()
  if (!latest) {
    return setRefreshMessage("Sidan ar publik och uppdateras automatiskt var 20:e minut. Tryck pa Hamta alla kallor for att lasa om hela den publika cachen.", "warning")
  }
  setRefreshMessage(`Publik cache for alla kallor uppdaterad ${formatDate(state.payload?.generated_at)}. Sidan fortsatter att kontrollera nya klipp och stories automatiskt medan den ar oppen.`, "info")
}

function setNavButtonState(targetSelector) {
  elements.bottomNavItems.forEach((button) => button.classList.toggle("is-active", button.dataset.scrollTarget === targetSelector))
}

function scrollToTarget(targetSelector) {
  const target = document.querySelector(targetSelector)
  if (!target) return
  target.scrollIntoView({ behavior: "smooth", block: "start" })
  setNavButtonState(targetSelector)
}

async function fetchJson(url) {
  const response = await fetch(`${url}?ts=${Date.now()}`, { cache: "no-store" })
  if (!response.ok) throw new Error(`Kunde inte lasa ${url} (${response.status})`)
  return response.json()
}

async function ensureSourceCatalog() {
  if (state.sourceCatalog.length) return
  try {
    state.sourceCatalog = await fetchJson(SOURCES_CONFIG_URL)
  } catch (error) {
    state.sourceCatalog = []
  }
}

async function fetchPayload() {
  return mergeCatalogWithPayload(await fetchJson(PUBLIC_CACHE_URL))
}

async function syncLatestCache(options = {}) {
  const scope = options.scope || { kind: "all", label: "alla kallor" }
  const scopeTitle = refreshScopeTitle(scope)
  const {
    openLatestItem = false,
    background = false,
    triggerElement = null,
    announce = background
      ? `Kontrollerar om en ny publik cache finns for ${scopeTitle}...`
      : `Hamtar senaste publika cache for ${scopeTitle}...`,
  } = options
  if (state.isRefreshing) return
  state.isRefreshing = true
  setRefreshButtonState(true)
  setScopedRefreshElement(triggerElement)
  if (!background) setRefreshMessage(announce, "info")
  try {
    await ensureSourceCatalog()
    const previousPayload = state.payload
    const previousGeneratedAt = state.payload?.generated_at || null
    state.payload = await fetchPayload()
    render()
    const scopedItems = itemsForRefreshScope(state.payload, scope)
    const scopedNewItems = newItemsForScope(previousPayload, state.payload, scope)
    const generatedAt = state.payload?.generated_at
    const hasNewerCache = previousGeneratedAt !== generatedAt

    if (!scopedItems.length) {
      return setRefreshMessage(
        `Vi hittade inga sparade poster i ${scopeTitle} an. Den publika cachen ar uppdaterad ${formatDate(generatedAt)} och kontrolleras igen var 20:e minut.`,
        "warning"
      )
    }

    const latest = scopedItems[0]

    if (openLatestItem) {
      if (scopedNewItems.length) {
        setRefreshMessage(foundItemsMessage(scopeTitle, scopedNewItems, "Fler poster ligger nu i raden."), "success")
        return
      }
      setRefreshMessage(
        hasNewerCache
          ? `${scopeTitle} ar uppdaterad mot senaste publika cache ${formatDate(generatedAt)}.`
          : `${scopeTitle} visar redan senaste publika cache ${formatDate(generatedAt)}.`,
        "success"
      )
      return
    }

    if (background) {
      if (scopedNewItems.length) {
        setRefreshMessage(foundItemsMessage(scopeTitle, scopedNewItems, "Fler poster ligger nu i cachen."), "success")
        return
      }
      if (hasNewerCache) setRefreshMessage(`Ny publik cache hittad for ${scopeTitle} ${formatDate(generatedAt)}. Sidan ar uppdaterad.`, "success")
      return
    }

    if (scopedNewItems.length) {
      setRefreshMessage(foundItemsMessage(scopeTitle, scopedNewItems, "Fler poster ligger nu i sektionen."), "success")
      return
    }

    setRefreshMessage(
      hasNewerCache
        ? `${scopeTitle} ar omladdad mot senaste publika cache ${formatDate(generatedAt)}. Senaste posten ar ${trimText(latest.title, 72)}.`
        : `Inga nya poster i ${scopeTitle} just nu. Senaste sparade posten ar ${trimText(latest.title, 72)}.`,
      "success"
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setRefreshMessage(message, "error")
    if (!state.payload) elements.tv4Rail.innerHTML = `<p class="empty-copy">${escapeHtml(message)}</p>`
  } finally {
    state.isRefreshing = false
    setRefreshButtonState(false)
    clearScopedRefreshElement()
  }
}

async function autoRefreshOnVisit() {
  if (state.autoRefreshTriggered) return
  state.autoRefreshTriggered = true
  await syncLatestCache({ openLatestItem: false, background: false, announce: "Uppdaterar den publika cachen for alla kallor nar sidan oppnas..." })
}

function startBackgroundPolling() {
  if (state.pollTimer) return
  state.pollTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") void syncLatestCache({ openLatestItem: false, background: true })
  }, AUTO_REFRESH_INTERVAL_MS)
}

document.addEventListener("click", (event) => {
  const itemTarget = event.target.closest("[data-item-id]")
  if (itemTarget) return openItemById(itemTarget.dataset.itemId, itemTarget.dataset.queueKey)
  const svtTarget = event.target.closest("[data-svt-source]")
  if (svtTarget) {
    state.activeSvtSourceId = svtTarget.dataset.svtSource
    return render()
  }
  const newsroomTarget = event.target.closest("[data-newsroom-source]")
  if (newsroomTarget) {
    state.activeNewsroomSourceByProvider[newsroomTarget.dataset.newsroomProvider] = newsroomTarget.dataset.newsroomSource
    return render()
  }
  const scopedRefreshTarget = event.target.closest("[data-action='refresh-scope']")
  if (scopedRefreshTarget) {
    return void syncLatestCache({
      openLatestItem: false,
      scope: readRefreshScope(scopedRefreshTarget),
      triggerElement: scopedRefreshTarget,
    })
  }
  const refreshTarget = event.target.closest("[data-action='refresh-latest']")
  if (refreshTarget) return void syncLatestCache({ openLatestItem: false, scope: { kind: "all", label: "alla kallor" } })
  const navTarget = event.target.closest("[data-scroll-target]")
  if (navTarget) return scrollToTarget(navTarget.dataset.scrollTarget)
  const closeTarget = event.target.closest("[data-close-modal]")
  if (!closeTarget) return
  if (closeTarget.dataset.closeModal === "player") closePlayer()
  if (closeTarget.dataset.closeModal === "reader") closeReader()
})

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closePlayer()
    closeReader()
    return
  }
  if (event.key === "ArrowRight" && state.currentModal) stepQueue(1)
  if (event.key === "ArrowLeft" && state.currentModal) stepQueue(-1)
})

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") void syncLatestCache({ openLatestItem: false, background: true })
})

elements.closePlayer?.addEventListener("click", closePlayer)
elements.closeReader?.addEventListener("click", closeReader)
elements.playerPrev?.addEventListener("click", () => stepQueue(-1))
elements.playerNext?.addEventListener("click", () => stepQueue(1))
elements.readerPrev?.addEventListener("click", () => stepQueue(-1))
elements.readerNext?.addEventListener("click", () => stepQueue(1))
elements.readerSpeak?.addEventListener("click", toggleSpeech)
elements.readerSpeed?.addEventListener("click", cycleSpeechRate)
elements.refreshButton?.addEventListener("click", () => void syncLatestCache({ openLatestItem: false, scope: { kind: "all", label: "alla kallor" } }))
elements.refreshCommand?.addEventListener("click", () => void syncLatestCache({ openLatestItem: false, scope: { kind: "all", label: "alla kallor" } }))

async function bootstrap() {
  try {
    state.seenItemIds = loadSeenItemIds()
    await ensureSourceCatalog()
    state.payload = await fetchPayload()
    render()
    setIdleMessage()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    setRefreshMessage(message, "error")
    elements.tv4Rail.innerHTML = `<p class="empty-copy">${escapeHtml(message)}</p>`
  }
  updateReaderSpeakButton()
  updateReaderSpeedLabel()
  await autoRefreshOnVisit()
  startBackgroundPolling()
}

void bootstrap()
