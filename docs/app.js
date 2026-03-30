const PUBLIC_CACHE_URL = "./data/news.json";
const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const state = {
  payload: null,
  activeSvtSourceId: null,
  hlsInstance: null,
  isRefreshing: false,
  autoRefreshTriggered: false,
  pollTimer: null,
};

const elements = {
  hero: document.querySelector("#hero"),
  generatedAt: document.querySelector("#generatedAt"),
  sourceCount: document.querySelector("#sourceCount"),
  videoCount: document.querySelector("#videoCount"),
  refreshButton: document.querySelector("#refreshButton"),
  refreshCommand: document.querySelector("#refreshCommand"),
  refreshMessage: document.querySelector("#refreshMessage"),
  tv4Rail: document.querySelector("#tv4Rail"),
  tv4ViewAll: document.querySelector("#tv4ViewAll"),
  svtTabs: document.querySelector("#svtTabs"),
  svtRail: document.querySelector("#svtRail"),
  foxFeature: document.querySelector("#foxFeature"),
  foxRail: document.querySelector("#foxRail"),
  bbcList: document.querySelector("#bbcList"),
  bbcViewAll: document.querySelector("#bbcViewAll"),
  playerModal: document.querySelector("#playerModal"),
  playerFrame: document.querySelector("#playerFrame"),
  playerVideo: document.querySelector("#playerVideo"),
  playerTitle: document.querySelector("#playerTitle"),
  playerFallback: document.querySelector("#playerFallback"),
  closePlayer: document.querySelector("#closePlayer"),
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatDate(value) {
  if (!value) {
    return "Time pending";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("sv-SE", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function newestFirst(items) {
  return [...items].sort((left, right) => {
    const leftDate = left.published_at ? new Date(left.published_at).getTime() : 0;
    const rightDate = right.published_at ? new Date(right.published_at).getTime() : 0;

    if (leftDate === rightDate) {
      return (left.sort_order ?? 0) - (right.sort_order ?? 0);
    }

    return rightDate - leftDate;
  });
}

function allSources() {
  return state.payload?.sources ?? [];
}

function sourceById(id) {
  return allSources().find((source) => source.id === id) || null;
}

function providerSources(provider) {
  return allSources().filter((source) => source.provider === provider);
}

function allVideos() {
  return newestFirst(allSources().flatMap((source) => source.articles || []));
}

function primaryVideo() {
  return allVideos()[0] || null;
}

function featuredVideo() {
  const tv4Primary = sourceById("tv4-nyheterna");
  if (tv4Primary?.articles?.length) {
    return newestFirst(tv4Primary.articles)[0];
  }

  return primaryVideo();
}

function cardBackground(url, overlay) {
  if (!url) {
    return "";
  }

  return `style="background-image:${overlay},url('${escapeHtml(url)}')"`;
}

function playDataset(item) {
  return `
    data-play-url="${escapeHtml(item.url)}"
    data-embed-url="${escapeHtml(item.embed_url || item.url)}"
    data-play-mode="${escapeHtml(item.play_mode || "page_iframe")}" 
    data-title="${escapeHtml(item.title)}"
  `;
}

function emptyState(label, href, message) {
  return `
    <div class="empty-state">
      <strong>${escapeHtml(message)}</strong>
      <p>Tryck pa Hamta senaste videos for att lasa om senaste publika videocache. Alla med lank kan anvanda sidan utan login.</p>
      <div class="empty-state__actions">
        <button class="pill pill--action" type="button" data-action="refresh-latest">Hamta senaste</button>
        <a class="section-link" href="${escapeHtml(href || "#")}" target="_blank" rel="noreferrer">Oppna ${escapeHtml(label)}</a>
      </div>
    </div>
  `;
}

function renderVideoCard(item, variant = "standard") {
  const meta = `${item.source_name} / ${item.category || "Video"}`;

  return `
    <article class="video-card video-card--${variant}">
      <button class="video-card__button" type="button" ${playDataset(item)}>
        <div
          class="video-card__media"
          ${cardBackground(
            item.image_url,
            "linear-gradient(180deg, rgba(5, 8, 14, 0.12), rgba(5, 8, 14, 0.96))"
          )}
        ></div>
        <div class="video-card__overlay">
          <span class="video-card__meta">${escapeHtml(meta)}</span>
          <strong>${escapeHtml(item.title)}</strong>
          <span class="video-card__date">${escapeHtml(formatDate(item.published_at))}</span>
        </div>
      </button>
    </article>
  `;
}

function renderBbcItem(item) {
  return `
    <article class="bbc-item">
      <button class="bbc-item__button" type="button" ${playDataset(item)}>
        <div
          class="bbc-item__thumb"
          ${cardBackground(
            item.image_url,
            "linear-gradient(135deg, rgba(13, 16, 27, 0.3), rgba(13, 16, 27, 0.78))"
          )}
        ></div>
        <div class="bbc-item__copy">
          <strong>${escapeHtml(item.title)}</strong>
          <span>${escapeHtml(item.category || "BBC")}</span>
          <small>${escapeHtml(formatDate(item.published_at))}</small>
        </div>
      </button>
    </article>
  `;
}

function renderHero() {
  const featured = featuredVideo();

  if (!featured) {
    elements.hero.innerHTML = `
      <div class="hero__backdrop"></div>
      <div class="hero__content">
        <div class="badge-row">
          <span class="hero-badge hero-badge--hot">Breaking news</span>
          <span class="hero-badge">Public cache</span>
        </div>
        <h1 class="hero__title">The cinematic news wall is loading.</h1>
        <p class="hero__summary">
          Sidan ar oppen for alla. Tryck pa Hamta senaste videos for att lasa om den senaste publika videocachen nar som helst.
        </p>
        <div class="hero__actions">
          <button class="hero-button hero-button--primary" type="button" data-action="refresh-latest">
            Hamta senaste
          </button>
          <a class="hero-button hero-button--secondary" href="https://www.tv4play.se/nyheter" target="_blank" rel="noreferrer">
            Oppna kalla
          </a>
        </div>
      </div>
    `;
    return;
  }

  elements.hero.innerHTML = `
    <div
      class="hero__backdrop"
      ${cardBackground(
        featured.image_url,
        "linear-gradient(180deg, rgba(3, 6, 11, 0.18), rgba(3, 6, 11, 0.98)), linear-gradient(90deg, rgba(3, 6, 11, 0.94) 0%, rgba(3, 6, 11, 0.42) 54%, rgba(3, 6, 11, 0.88) 100%)"
      )}
    ></div>
    <div class="hero__content">
      <div class="badge-row">
        <span class="hero-badge hero-badge--hot">Breaking news</span>
        <span class="hero-badge">${escapeHtml(featured.provider)}</span>
      </div>
      <h1 class="hero__title">${escapeHtml(featured.title)}</h1>
      <p class="hero__summary">${escapeHtml(featured.summary || "Latest lead video from the current news wall.")}</p>
      <div class="hero__actions">
        <button class="hero-button hero-button--primary" type="button" ${playDataset(featured)}>
          Watch now
        </button>
        <button class="hero-button hero-button--secondary" type="button" data-action="refresh-latest">
          Hamta senaste
        </button>
      </div>
      <div class="hero__meta">
        <span>${escapeHtml(featured.source_name)}</span>
        <span>${escapeHtml(formatDate(featured.published_at))}</span>
      </div>
    </div>
  `;
}

function renderTv4() {
  const tv4Sources = providerSources("TV4");
  const items = newestFirst(tv4Sources.flatMap((source) => source.articles || [])).slice(0, 10);
  elements.tv4ViewAll.href = sourceById("tv4-nyheterna")?.display_url || "#";

  elements.tv4Rail.innerHTML = items.length
    ? items.map((item) => renderVideoCard(item)).join("")
    : emptyState("TV4", sourceById("tv4-nyheterna")?.display_url, "TV4-videor ar inte cachelagrade an.");
}

function ensureActiveSvtSource() {
  const sources = providerSources("SVT Play");
  if (!sources.length) {
    state.activeSvtSourceId = null;
    return;
  }

  if (!state.activeSvtSourceId || !sources.some((source) => source.id === state.activeSvtSourceId)) {
    state.activeSvtSourceId = sources[0].id;
  }
}

function renderSvtTabs() {
  const sources = providerSources("SVT Play");
  ensureActiveSvtSource();

  elements.svtTabs.innerHTML = sources
    .map(
      (source) => `
        <button
          class="pill ${source.id === state.activeSvtSourceId ? "is-active" : ""}"
          type="button"
          data-svt-source="${escapeHtml(source.id)}"
        >
          ${escapeHtml(source.name)}
        </button>
      `
    )
    .join("");
}

function renderSvtRail() {
  const source = sourceById(state.activeSvtSourceId);
  const items = newestFirst(source?.articles || []).slice(0, 10);

  elements.svtRail.innerHTML = items.length
    ? items.map((item) => renderVideoCard(item)).join("")
    : emptyState("SVT", source?.display_url, "SVT-videor ar inte cachelagrade an.");
}

function renderFox() {
  const foxSource = sourceById("fox-news");
  const items = [...(foxSource?.articles || [])].sort((left, right) => (left.sort_order ?? 0) - (right.sort_order ?? 0));
  const heroItem = items[0];
  const secondary = items.slice(1, 7);

  if (!heroItem) {
    elements.foxFeature.innerHTML = emptyState("Fox", foxSource?.display_url, "Fox-videor ar inte cachelagrade an.");
    elements.foxRail.innerHTML = "";
    return;
  }

  elements.foxFeature.innerHTML = `
    <article class="fox-feature">
      <button class="fox-feature__button" type="button" ${playDataset(heroItem)}>
        <div
          class="fox-feature__media"
          ${cardBackground(
            heroItem.image_url,
            "linear-gradient(180deg, rgba(5, 8, 14, 0.12), rgba(5, 8, 14, 0.98))"
          )}
        ></div>
        <div class="fox-feature__content">
          <span class="fox-feature__label">Exclusive interview</span>
          <strong>${escapeHtml(heroItem.title)}</strong>
          <span class="fox-feature__cta">Watch full broadcast</span>
        </div>
      </button>
    </article>
  `;

  elements.foxRail.innerHTML = secondary.map((item) => renderVideoCard(item, "compact")).join("");
}

function renderBbc() {
  const bbcSource = sourceById("bbc-video");
  const items = newestFirst(bbcSource?.articles || []).slice(0, 5);
  elements.bbcViewAll.href = bbcSource?.display_url || "#";

  elements.bbcList.innerHTML = items.length
    ? items.map((item) => renderBbcItem(item)).join("")
    : emptyState("BBC", bbcSource?.display_url, "BBC-klipp ar inte cachelagrade an.");
}

function renderStatus() {
  elements.generatedAt.textContent = formatDate(state.payload?.generated_at);
  elements.sourceCount.textContent = String(allSources().length);
  elements.videoCount.textContent = String(allVideos().length);
}

function render() {
  renderHero();
  renderTv4();
  renderSvtTabs();
  renderSvtRail();
  renderFox();
  renderBbc();
  renderStatus();
}

function updateModalLock() {
  const playerOpen = Boolean(elements.playerModal && !elements.playerModal.hidden);
  document.body.classList.toggle("is-modal-open", playerOpen);
}

function stopPlayback() {
  if (state.hlsInstance) {
    state.hlsInstance.destroy();
    state.hlsInstance = null;
  }

  elements.playerFrame.src = "";
  elements.playerFrame.hidden = true;
  elements.playerVideo.pause();
  elements.playerVideo.removeAttribute("src");
  elements.playerVideo.load();
  elements.playerVideo.hidden = true;
}

function playMediaSource(url) {
  const video = elements.playerVideo;
  video.hidden = false;

  if (window.Hls && window.Hls.isSupported() && url.endsWith(".m3u8")) {
    state.hlsInstance = new window.Hls();
    state.hlsInstance.loadSource(url);
    state.hlsInstance.attachMedia(video);
  } else {
    video.src = url;
  }

  void video.play().catch(() => {});
}

function openPlayerFromItem(item) {
  if (!item) {
    return;
  }

  openPlayer({
    dataset: {
      embedUrl: item.embed_url || item.url,
      playUrl: item.url,
      playMode: item.play_mode || "page_iframe",
      title: item.title || "Video",
    },
  });
}

function openPlayer(trigger) {
  const embedUrl = trigger.dataset.embedUrl || trigger.dataset.playUrl;
  const fallbackUrl = trigger.dataset.playUrl;
  const title = trigger.dataset.title || "Video";
  const playMode = trigger.dataset.playMode || "page_iframe";

  stopPlayback();
  elements.playerTitle.textContent = title;
  elements.playerFallback.href = fallbackUrl;

  if (playMode === "media") {
    playMediaSource(embedUrl);
  } else {
    elements.playerFrame.hidden = false;
    elements.playerFrame.src = embedUrl;
  }

  elements.playerModal.hidden = false;
  updateModalLock();
}

function closePlayer() {
  stopPlayback();
  elements.playerModal.hidden = true;
  updateModalLock();
}

function setRefreshButtonState(isRefreshing) {
  if (elements.refreshButton) {
    elements.refreshButton.disabled = isRefreshing;
    elements.refreshButton.classList.toggle("is-loading", isRefreshing);
    elements.refreshButton.setAttribute("aria-busy", String(isRefreshing));
    elements.refreshButton.setAttribute("aria-label", isRefreshing ? "Hamtar senaste videos" : "Hamta senaste videos");
  }

  if (elements.refreshCommand) {
    elements.refreshCommand.disabled = isRefreshing;
    elements.refreshCommand.classList.toggle("is-loading", isRefreshing);
    elements.refreshCommand.textContent = isRefreshing ? "Hamtar senaste videos..." : "Hamta senaste videos";
  }
}

function setRefreshMessage(message, tone = "info") {
  if (!elements.refreshMessage) {
    return;
  }

  if (!message) {
    elements.refreshMessage.hidden = true;
    elements.refreshMessage.className = "sync-banner";
    elements.refreshMessage.textContent = "";
    return;
  }

  elements.refreshMessage.hidden = false;
  elements.refreshMessage.className = `sync-banner sync-banner--${tone}`;
  elements.refreshMessage.textContent = message;
}

function setIdleMessage() {
  const latest = primaryVideo();

  if (!latest) {
    setRefreshMessage(
      "Sidan ar publik och uppdateras automatiskt var 20:e minut. Tryck pa Hamta senaste videos for att lasa om senaste publika cache.",
      "warning"
    );
    return;
  }

  setRefreshMessage(
    `Publik videocache uppdaterad ${formatDate(state.payload?.generated_at)}. Sidan fortsatter att kontrollera nya klipp automatiskt medan den ar oppen.`,
    "info"
  );
}

async function fetchPayload() {
  const response = await fetch(`${PUBLIC_CACHE_URL}?ts=${Date.now()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Kunde inte lasa news.json (${response.status})`);
  }

  return response.json();
}

async function syncLatestCache(options = {}) {
  const {
    openLatestVideo = false,
    background = false,
    announce = background ? "Kontrollerar om en ny publik videocache finns..." : "Hamtar senaste publika videocache...",
  } = options;

  if (state.isRefreshing) {
    return;
  }

  state.isRefreshing = true;
  setRefreshButtonState(true);

  if (!background) {
    setRefreshMessage(announce, "info");
  }

  try {
    const previousGeneratedAt = state.payload?.generated_at || null;
    state.payload = await fetchPayload();
    render();

    const latest = primaryVideo();
    if (!latest) {
      setRefreshMessage(
        "Den publika videocachen ar laddad men innehaller inga videor an. GitHub Actions fortsatter att uppdatera var 20:e minut.",
        "warning"
      );
      return;
    }

    const generatedAt = state.payload?.generated_at;
    const hasNewerCache = previousGeneratedAt !== generatedAt;

    if (openLatestVideo) {
      setRefreshMessage(
        hasNewerCache
          ? `Senaste publika videocache hamtad ${formatDate(generatedAt)}. Oppnar senaste video nu.`
          : `Du ser redan senaste publika cache ${formatDate(generatedAt)}. Oppnar senaste video nu.`,
        "success"
      );
      openPlayerFromItem(latest);
      return;
    }

    if (background) {
      if (hasNewerCache) {
        setRefreshMessage(`Ny publik videocache hittad ${formatDate(generatedAt)}. Sidan ar uppdaterad.`, "success");
      }
      return;
    }

    setRefreshMessage(
      hasNewerCache
        ? `Publik videocache uppdaterad ${formatDate(generatedAt)}.`
        : `Du ser redan senaste publika videocache ${formatDate(generatedAt)}.`,
      "success"
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setRefreshMessage(message, "error");
    if (!state.payload) {
      elements.tv4Rail.innerHTML = `<p class="empty-copy">${escapeHtml(message)}</p>`;
    }
  } finally {
    state.isRefreshing = false;
    setRefreshButtonState(false);
  }
}

async function autoRefreshOnVisit() {
  if (state.autoRefreshTriggered) {
    return;
  }

  state.autoRefreshTriggered = true;
  await syncLatestCache({
    openLatestVideo: false,
    background: false,
    announce: "Uppdaterar den publika videocachen nar sidan oppnas...",
  });
}

function startBackgroundPolling() {
  if (state.pollTimer) {
    return;
  }

  state.pollTimer = window.setInterval(() => {
    if (document.visibilityState === "visible") {
      void syncLatestCache({
        openLatestVideo: false,
        background: true,
      });
    }
  }, AUTO_REFRESH_INTERVAL_MS);
}

document.addEventListener("click", (event) => {
  const playTarget = event.target.closest("[data-play-url]");
  if (playTarget) {
    openPlayer(playTarget);
    return;
  }

  const svtTarget = event.target.closest("[data-svt-source]");
  if (svtTarget) {
    state.activeSvtSourceId = svtTarget.dataset.svtSource;
    renderSvtTabs();
    renderSvtRail();
    return;
  }

  const refreshTarget = event.target.closest("[data-action='refresh-latest']");
  if (refreshTarget) {
    void syncLatestCache({ openLatestVideo: true });
    return;
  }

  const closeTarget = event.target.closest("[data-close-modal='true']");
  if (closeTarget) {
    closePlayer();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.playerModal.hidden) {
    closePlayer();
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    void syncLatestCache({
      openLatestVideo: false,
      background: true,
    });
  }
});

elements.closePlayer.addEventListener("click", closePlayer);
elements.refreshButton.addEventListener("click", () => void syncLatestCache({ openLatestVideo: true }));
elements.refreshCommand?.addEventListener("click", () => void syncLatestCache({ openLatestVideo: true }));

async function bootstrap() {
  try {
    state.payload = await fetchPayload();
    render();
    setIdleMessage();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setRefreshMessage(message, "error");
    elements.tv4Rail.innerHTML = `<p class="empty-copy">${escapeHtml(message)}</p>`;
  }

  await autoRefreshOnVisit();
  startBackgroundPolling();
}

void bootstrap();