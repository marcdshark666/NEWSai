const GITHUB_CONFIG = {
  owner: "marcdshark666",
  repo: "NEWSai",
  branch: "main",
  workflowFile: "update-news.yml",
  tokenStorageKey: "newsai-github-token",
  contentsPath: "docs/data/news.json",
};

const state = {
  payload: null,
  activeSvtSourceId: null,
  hlsInstance: null,
  isRefreshing: false,
  githubToken: null,
  resumeRefreshAfterAuth: false,
  autoRefreshTriggered: false,
};

const elements = {
  hero: document.querySelector("#hero"),
  generatedAt: document.querySelector("#generatedAt"),
  sourceCount: document.querySelector("#sourceCount"),
  videoCount: document.querySelector("#videoCount"),
  refreshButton: document.querySelector("#refreshButton"),
  refreshCommand: document.querySelector("#refreshCommand"),
  refreshMessage: document.querySelector("#refreshMessage"),
  githubAuthTopbar: document.querySelector("#githubAuthTopbar"),
  githubAuthCommand: document.querySelector("#githubAuthCommand"),
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
  authModal: document.querySelector("#authModal"),
  authForm: document.querySelector("#authForm"),
  githubToken: document.querySelector("#githubToken"),
  rememberGithubToken: document.querySelector("#rememberGithubToken"),
  authStatus: document.querySelector("#authStatus"),
  closeAuth: document.querySelector("#closeAuth"),
  clearGithubToken: document.querySelector("#clearGithubToken"),
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

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function readStorage(area, key) {
  try {
    return area.getItem(key);
  } catch (error) {
    return null;
  }
}

function writeStorage(area, key, value) {
  try {
    area.setItem(key, value);
  } catch (error) {
    return;
  }
}

function removeStorage(area, key) {
  try {
    area.removeItem(key);
  } catch (error) {
    return;
  }
}

function loadStoredGithubToken() {
  const localToken = readStorage(window.localStorage, GITHUB_CONFIG.tokenStorageKey);
  if (localToken) {
    return {
      token: localToken,
      remember: true,
    };
  }

  const sessionToken = readStorage(window.sessionStorage, GITHUB_CONFIG.tokenStorageKey);
  if (sessionToken) {
    return {
      token: sessionToken,
      remember: false,
    };
  }

  return {
    token: null,
    remember: false,
  };
}

function saveGithubToken(token, remember) {
  removeStorage(window.localStorage, GITHUB_CONFIG.tokenStorageKey);
  removeStorage(window.sessionStorage, GITHUB_CONFIG.tokenStorageKey);

  const targetStorage = remember ? window.localStorage : window.sessionStorage;
  writeStorage(targetStorage, GITHUB_CONFIG.tokenStorageKey, token);
  state.githubToken = token;
}

function clearGithubTokenState() {
  removeStorage(window.localStorage, GITHUB_CONFIG.tokenStorageKey);
  removeStorage(window.sessionStorage, GITHUB_CONFIG.tokenStorageKey);
  state.githubToken = null;
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
      <p>Tryck pa Hamta senaste videos for att lasa in senaste sparade feeden eller starta en live-uppdatering via GitHub.</p>
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
          <span class="hero-badge">Loading</span>
        </div>
        <h1 class="hero__title">The cinematic news wall is loading.</h1>
        <p class="hero__summary">
          Din video-cache ar inte fylld an. Tryck pa Hamta senaste videos for att lasa in senaste sparade feed och spela senaste klippet direkt nar cachen ar redo.
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
  const authOpen = Boolean(elements.authModal && !elements.authModal.hidden);
  document.body.classList.toggle("is-modal-open", playerOpen || authOpen);
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

function setAuthStatus(message, tone = "info") {
  if (!elements.authStatus) {
    return;
  }

  if (!message) {
    elements.authStatus.hidden = true;
    elements.authStatus.className = "sync-banner";
    elements.authStatus.textContent = "";
    return;
  }

  elements.authStatus.hidden = false;
  elements.authStatus.className = `sync-banner sync-banner--${tone}`;
  elements.authStatus.textContent = message;
}

function syncGithubButtons() {
  const isConnected = Boolean(state.githubToken);
  const commandLabel = isConnected ? "GitHub klar" : "Koppla GitHub";
  const topbarLabel = isConnected ? "GitHub klar" : "Koppla GitHub";

  if (elements.githubAuthCommand) {
    elements.githubAuthCommand.textContent = commandLabel;
    elements.githubAuthCommand.classList.toggle("is-connected", isConnected);
    elements.githubAuthCommand.setAttribute(
      "aria-label",
      isConnected ? "GitHub ar kopplat for live-uppdatering" : "Koppla GitHub for live-uppdatering"
    );
  }

  if (elements.githubAuthTopbar) {
    elements.githubAuthTopbar.textContent = "GH";
    elements.githubAuthTopbar.classList.toggle("is-connected", isConnected);
    elements.githubAuthTopbar.setAttribute("aria-label", topbarLabel);
    elements.githubAuthTopbar.title = topbarLabel;
  }
}

function openAuthModal(message, tone = "info") {
  const stored = loadStoredGithubToken();
  elements.rememberGithubToken.checked = stored.remember;
  elements.githubToken.value = "";
  setAuthStatus(message || (state.githubToken ? "GitHub ar redan kopplat i denna webblasare." : ""), tone);
  elements.authModal.hidden = false;
  updateModalLock();
  window.setTimeout(() => {
    elements.githubToken.focus();
  }, 50);
}

function closeAuthModal() {
  elements.authModal.hidden = true;
  setAuthStatus("");
  updateModalLock();
}

function idleMessage() {
  const latest = primaryVideo();

  if (!latest) {
    setRefreshMessage(
      "Tryck pa Hamta senaste videos for att lasa in senaste sparade feed. Koppla GitHub om du vill starta en ny hamtning direkt fran sidan.",
      "warning"
    );
    return;
  }

  const prefix = state.githubToken ? "GitHub ar kopplat." : "Koppla GitHub for live-hamtning.";
  setRefreshMessage(
    `${prefix} Senaste cache ${formatDate(state.payload?.generated_at)}. Tryck pa Hamta senaste videos for att kontrollera nya klipp.`,
    "info"
  );
}

async function loadData(options = {}) {
  const response = await fetch(`./data/news.json?ts=${Date.now()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Kunde inte lasa news.json (${response.status})`);
  }

  state.payload = await response.json();
  render();

  if (!options.preserveMessage) {
    idleMessage();
  }
}

async function githubRequest(path, options = {}) {
  const { method = "GET", token = state.githubToken, body } = options;

  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    let detail = `GitHub-fel ${response.status}`;

    try {
      const payload = await response.json();
      if (payload?.message) {
        detail = payload.message;
      }
    } catch (error) {
      detail = `${detail}`;
    }

    throw new Error(detail);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

function decodeGitHubContent(content) {
  const binary = window.atob(String(content || "").replaceAll("\n", ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function validateGithubToken(token) {
  await githubRequest(`/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}`, { token });
}

async function getLatestWorkflowRun(token) {
  const payload = await githubRequest(
    `/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/actions/workflows/${GITHUB_CONFIG.workflowFile}/runs?per_page=5&branch=${GITHUB_CONFIG.branch}`,
    { token }
  );

  return payload.workflow_runs?.[0] || null;
}

async function dispatchWorkflow(token) {
  await githubRequest(
    `/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/actions/workflows/${GITHUB_CONFIG.workflowFile}/dispatches`,
    {
      method: "POST",
      token,
      body: {
        ref: GITHUB_CONFIG.branch,
      },
    }
  );
}

async function waitForTriggeredRun(token, baselineRunId, dispatchStartedAt) {
  for (let attempt = 0; attempt < 18; attempt += 1) {
    const payload = await githubRequest(
      `/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/actions/workflows/${GITHUB_CONFIG.workflowFile}/runs?per_page=10&branch=${GITHUB_CONFIG.branch}`,
      { token }
    );
    const run =
      payload.workflow_runs?.find(
        (item) =>
          item.event === "workflow_dispatch" &&
          item.id !== baselineRunId &&
          new Date(item.created_at).getTime() >= dispatchStartedAt - 20000
      ) || null;

    if (run) {
      return run;
    }

    setRefreshMessage("GitHub startar uppdateringsjobbet...", "info");
    await delay(4000);
  }

  throw new Error("Kunde inte hitta den nya GitHub-korningen.");
}

async function waitForWorkflowCompletion(token, runId) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const run = await githubRequest(`/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/actions/runs/${runId}`, {
      token,
    });

    if (run.status === "completed") {
      if (run.conclusion !== "success") {
        throw new Error(`GitHub-jobbet misslyckades (${run.conclusion || "unknown"}).`);
      }
      return run;
    }

    const label = run.status === "queued" ? "GitHub-jobbet ligger i ko..." : "GitHub hamtar de senaste videorna...";
    setRefreshMessage(label, "info");
    await delay(5000);
  }

  throw new Error("GitHub-jobbet hann inte bli klart i tid.");
}

async function fetchLatestNewsFromGitHub(token) {
  const payload = await githubRequest(
    `/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${GITHUB_CONFIG.contentsPath}?ref=${GITHUB_CONFIG.branch}`,
    { token }
  );

  if (!payload?.content) {
    throw new Error("GitHub returnerade ingen news.json att lasa.");
  }

  return JSON.parse(decodeGitHubContent(payload.content));
}

function isLikelyAuthError(message) {
  const normalized = String(message || "").toLowerCase();
  return normalized.includes("bad credentials") || normalized.includes("resource not accessible") || normalized.includes("requires");
}

async function refreshLatest() {
  if (state.isRefreshing) {
    return;
  }

  if (!state.githubToken) {
    state.resumeRefreshAfterAuth = true;
    openAuthModal("Lagg in din GitHub-token for att starta live-uppdateringen direkt fran sidan.", "warning");
    setRefreshMessage("Koppla GitHub for att hamta nytt innehall pa kommando.", "warning");
    return;
  }

  state.isRefreshing = true;
  setRefreshButtonState(true);
  setRefreshMessage("Skickar live-uppdatering till GitHub...", "info");

  try {
    const previousGeneratedAt = state.payload?.generated_at || null;
    const baselineRun = await getLatestWorkflowRun(state.githubToken);
    const dispatchStartedAt = Date.now();

    await dispatchWorkflow(state.githubToken);
    const run = await waitForTriggeredRun(state.githubToken, baselineRun?.id ?? null, dispatchStartedAt);
    await waitForWorkflowCompletion(state.githubToken, run.id);

    state.payload = await fetchLatestNewsFromGitHub(state.githubToken);
    render();

    const latest = primaryVideo();
    if (!latest) {
      setRefreshMessage("GitHub blev klar, men news-cachen innehaller fortfarande inga videor.", "warning");
      return;
    }

    const generatedAt = state.payload?.generated_at;
    const hasNewerCache = previousGeneratedAt !== generatedAt;
    setRefreshMessage(
      hasNewerCache
        ? `Ny videocache hamtad ${formatDate(generatedAt)}. Oppnar senaste video nu.`
        : `Kontroll klar. Senaste tillgangliga cache ar ${formatDate(generatedAt)}. Oppnar senaste video nu.`,
      "success"
    );
    openPlayerFromItem(latest);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setRefreshMessage(message, "error");
    if (isLikelyAuthError(message)) {
      clearGithubTokenState();
      syncGithubButtons();
      state.resumeRefreshAfterAuth = true;
      openAuthModal("GitHub-tokenen godkandes inte. Kontrollera att den har Actions: Read and write samt Contents: Read.", "error");
    }
    elements.tv4Rail.innerHTML = `<p class="empty-copy">${escapeHtml(message)}</p>`;
  } finally {
    state.isRefreshing = false;
    setRefreshButtonState(false);
  }
}

async function autoRefreshOnVisit() {
  if (!state.githubToken || state.autoRefreshTriggered) {
    return;
  }

  state.autoRefreshTriggered = true;
  setRefreshMessage("GitHub ar kopplat. Uppdaterar nyheterna automatiskt nar du oppnar sidan...", "info");
  await refreshLatest();
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
    void refreshLatest();
    return;
  }

  const closeTarget = event.target.closest("[data-close-modal='true']");
  if (closeTarget) {
    closePlayer();
    return;
  }

  const closeAuthTarget = event.target.closest("[data-close-auth='true']");
  if (closeAuthTarget) {
    closeAuthModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") {
    return;
  }

  if (!elements.playerModal.hidden) {
    closePlayer();
  }

  if (!elements.authModal.hidden) {
    closeAuthModal();
  }
});

elements.closePlayer.addEventListener("click", closePlayer);
elements.closeAuth.addEventListener("click", closeAuthModal);
elements.refreshButton.addEventListener("click", () => void refreshLatest());
elements.refreshCommand?.addEventListener("click", () => void refreshLatest());
elements.githubAuthTopbar?.addEventListener("click", () => {
  state.resumeRefreshAfterAuth = false;
  openAuthModal();
});
elements.githubAuthCommand?.addEventListener("click", () => {
  state.resumeRefreshAfterAuth = false;
  openAuthModal();
});
elements.clearGithubToken?.addEventListener("click", () => {
  clearGithubTokenState();
  syncGithubButtons();
  state.resumeRefreshAfterAuth = false;
  setAuthStatus("GitHub-tokenen ar borttagen fran denna webblasare.", "success");
  setRefreshMessage("GitHub ar fran kopplat. Du kan fortfarande visa befintlig cache.", "warning");
});

elements.authForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = elements.githubToken.value.trim();
  const remember = Boolean(elements.rememberGithubToken.checked);

  if (!token) {
    setAuthStatus("Fyll i en GitHub-token for att fortsatta.", "warning");
    return;
  }

  elements.githubToken.disabled = true;
  elements.rememberGithubToken.disabled = true;
  setAuthStatus("Verifierar GitHub-token...", "info");

  try {
    await validateGithubToken(token);
    saveGithubToken(token, remember);
    syncGithubButtons();
    closeAuthModal();
    setRefreshMessage("GitHub ar kopplat. Startar en direkt uppdatering av nyheterna nu.", "success");
    state.resumeRefreshAfterAuth = false;
    await refreshLatest();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setAuthStatus(`Kunde inte verifiera tokenen: ${message}`, "error");
  } finally {
    elements.githubToken.disabled = false;
    elements.rememberGithubToken.disabled = false;
    elements.githubToken.value = "";
  }
});

const storedAuth = loadStoredGithubToken();
state.githubToken = storedAuth.token;
syncGithubButtons();

async function bootstrap() {
  try {
    await loadData();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setRefreshMessage(message, "error");
    elements.tv4Rail.innerHTML = `<p class="empty-copy">${escapeHtml(message)}</p>`;
  }

  await autoRefreshOnVisit();
}

void bootstrap();
