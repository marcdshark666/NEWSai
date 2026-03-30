const state = {
  payload: null,
};

const elements = {
  hero: document.querySelector("#hero"),
  generatedAt: document.querySelector("#generatedAt"),
  sourceCount: document.querySelector("#sourceCount"),
  videoCount: document.querySelector("#videoCount"),
  latestRow: document.querySelector("#latestRow"),
  providerSections: document.querySelector("#providerSections"),
  refreshButton: document.querySelector("#refreshButton"),
  playerModal: document.querySelector("#playerModal"),
  playerFrame: document.querySelector("#playerFrame"),
  playerTitle: document.querySelector("#playerTitle"),
  playerFallback: document.querySelector("#playerFallback"),
  closePlayer: document.querySelector("#closePlayer"),
};

const PROVIDER_ORDER = ["TV4", "SVT Play", "Amerikansk media", "BBC"];

function formatDate(value) {
  if (!value) {
    return "Tid saknas";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("sv-SE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function newestFirst(items) {
  return [...items].sort((left, right) => {
    const leftDate = left.published_at ? new Date(left.published_at).getTime() : 0;
    const rightDate = right.published_at ? new Date(right.published_at).getTime() : 0;
    return rightDate - leftDate;
  });
}

function getSources() {
  return state.payload?.sources ?? [];
}

function getAllVideos() {
  return newestFirst(getSources().flatMap((source) => source.articles || []));
}

function getFeaturedVideo() {
  const tv4Source = getSources().find((source) => source.id === "tv4-nyheterna" && source.articles?.length);
  if (tv4Source) {
    return tv4Source.articles[0];
  }
  return getAllVideos()[0] || null;
}

function groupByProvider() {
  const groups = new Map();
  for (const source of getSources()) {
    const provider = source.provider || "Ovrigt";
    if (!groups.has(provider)) {
      groups.set(provider, []);
    }
    groups.get(provider).push(source);
  }

  return [...groups.entries()].sort((left, right) => {
    const leftIndex = PROVIDER_ORDER.indexOf(left[0]);
    const rightIndex = PROVIDER_ORDER.indexOf(right[0]);
    const safeLeft = leftIndex === -1 ? 99 : leftIndex;
    const safeRight = rightIndex === -1 ? 99 : rightIndex;
    return safeLeft - safeRight;
  });
}

function createVideoCard(item, variant = "standard") {
  const imageStyle = item.image_url
    ? `style="background-image: linear-gradient(180deg, rgba(4, 6, 12, 0.18), rgba(4, 6, 12, 0.9)), url('${item.image_url}')"`
    : "";

  return `
    <article class="video-card video-card--${variant}">
      <button
        class="video-hit"
        type="button"
        data-play-url="${item.url}"
        data-embed-url="${item.embed_url || item.url}"
        data-play-mode="${item.play_mode || "page_iframe"}"
        data-title="${item.title.replace(/"/g, "&quot;")}"
      >
        <div class="video-poster" ${imageStyle}></div>
        <div class="video-copy">
          <span class="video-meta">${item.source_name} · ${item.category || "Video"}</span>
          <strong>${item.title}</strong>
          <span class="video-date">${formatDate(item.published_at)}</span>
        </div>
        <span class="play-badge">Spela</span>
      </button>
    </article>
  `;
}

function createSourceCard(source) {
  const latest = newestFirst(source.articles || [])[0];
  const imageStyle = latest?.image_url
    ? `style="background-image: linear-gradient(180deg, rgba(6, 8, 16, 0.2), rgba(6, 8, 16, 0.95)), url('${latest.image_url}')"`
    : "";

  if (!latest) {
    return `
      <article class="source-poster is-empty">
        <div class="source-poster__media"></div>
        <div class="source-poster__copy">
          <span>${source.category}</span>
          <strong>${source.name}</strong>
          <p>Vantar pa forsta uppdateringen.</p>
        </div>
      </article>
    `;
  }

  return `
    <article class="source-poster">
      <button
        class="video-hit source-poster__button"
        type="button"
        data-play-url="${latest.url}"
        data-embed-url="${latest.embed_url || latest.url}"
        data-play-mode="${latest.play_mode || "page_iframe"}"
        data-title="${latest.title.replace(/"/g, "&quot;")}"
      >
        <div class="source-poster__media" ${imageStyle}></div>
        <div class="source-poster__copy">
          <span>${source.category}</span>
          <strong>${source.name}</strong>
          <p>${latest.title}</p>
        </div>
      </button>
    </article>
  `;
}

function renderHero() {
  const featured = getFeaturedVideo();
  if (!featured) {
    elements.hero.innerHTML = `
      <div class="hero-copy">
        <p class="hero-kicker">NEWSai Video Wall</p>
        <h1>Streamingkansla for nyhetsvideo.</h1>
        <p>
          Lagger nyaste videor fran TV4, SVT Play, Fox News och BBC pa en plats. Data kommer in
          sa fort forsta schemakorningen har fyllt cachen.
        </p>
      </div>
    `;
    return;
  }

  const backgroundStyle = featured.image_url
    ? `style="background-image: linear-gradient(90deg, rgba(4, 6, 12, 0.88) 12%, rgba(4, 6, 12, 0.42) 55%, rgba(4, 6, 12, 0.8) 100%), url('${featured.image_url}')"`
    : "";

  elements.hero.innerHTML = `
    <div class="hero-backdrop" ${backgroundStyle}></div>
    <div class="hero-copy">
      <p class="hero-kicker">${featured.provider} · ${featured.source_name}</p>
      <h1>${featured.title}</h1>
      <p>${featured.summary || "Direkt vald från det senaste videoflodet."}</p>
      <div class="hero-actions">
        <button
          class="hero-button hero-button--primary"
          type="button"
          data-play-url="${featured.url}"
          data-embed-url="${featured.embed_url || featured.url}"
          data-play-mode="${featured.play_mode || "page_iframe"}"
          data-title="${featured.title.replace(/"/g, "&quot;")}"
        >
          Spela senaste
        </button>
        <a class="hero-button hero-button--ghost" href="${featured.url}" target="_blank" rel="noreferrer">
          Oppna hos kallan
        </a>
      </div>
      <div class="hero-info">
        <span>${formatDate(featured.published_at)}</span>
        <span>${featured.category || "Video"}</span>
      </div>
    </div>
  `;
}

function renderLatestRow() {
  const latest = getAllVideos().slice(0, 16);
  elements.latestRow.innerHTML = latest.map((item) => createVideoCard(item, "large")).join("");
}

function renderProviderSections() {
  const providerMarkup = groupByProvider()
    .map(([provider, sources]) => {
      if (provider === "SVT Play") {
        const svtVideos = newestFirst(sources.flatMap((source) => source.articles || [])).slice(0, 16);
        return `
          <section class="provider-band provider-band--svt">
            <div class="section-heading">
              <p class="section-kicker">SVT Play</p>
              <h2>Nyhetskategorier i karusell</h2>
            </div>
            <div class="source-rail">
              ${sources.map((source) => createSourceCard(source)).join("")}
            </div>
            <div class="shelf rail">
              ${svtVideos.map((item) => createVideoCard(item)).join("")}
            </div>
          </section>
        `;
      }

      return `
        <section class="provider-band provider-band--${provider.toLowerCase().replace(/\s+/g, "-")}">
          <div class="section-heading">
            <p class="section-kicker">${provider}</p>
            <h2>${provider === "TV4" ? "TV4-banderoll" : provider === "Amerikansk media" ? "Amerikansk medierad" : "Videorad"}</h2>
          </div>
          ${sources
            .map((source) => {
              const items = source.priority_split
                ? [...(source.articles || [])].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
                : newestFirst(source.articles || []);
              const primary = source.priority_split ? items.slice(0, source.priority_split) : items;
              const secondary = source.priority_split ? items.slice(source.priority_split) : [];

              return `
                <div class="source-block">
                  <div class="source-heading">
                    <div>
                      <p class="source-kicker">${source.category}</p>
                      <h3>${source.name}</h3>
                    </div>
                    <a href="${source.display_url}" target="_blank" rel="noreferrer">Oppna kallsidan</a>
                  </div>
                  <p class="source-description">${source.description || ""}</p>
                  <div class="shelf rail ${source.priority_split ? "is-priority" : ""}">
                    ${primary.map((item) => createVideoCard(item, source.priority_split ? "priority" : "standard")).join("")}
                  </div>
                  ${
                    secondary.length
                      ? `
                        <div class="subheading-row">
                          <p class="source-kicker">Fler videor</p>
                          <span>Viktigast forst ovan, resten ligger i denna andra karusell.</span>
                        </div>
                        <div class="shelf rail rail-secondary">
                          ${secondary.map((item) => createVideoCard(item, "compact")).join("")}
                        </div>
                      `
                      : ""
                  }
                </div>
              `;
            })
            .join("")}
        </section>
      `;
    })
    .join("");

  elements.providerSections.innerHTML = providerMarkup;
}

function renderSummary() {
  elements.generatedAt.textContent = formatDate(state.payload?.generated_at);
  elements.sourceCount.textContent = String(getSources().length);
  elements.videoCount.textContent = String(getAllVideos().length);
}

function render() {
  renderSummary();
  renderHero();
  renderLatestRow();
  renderProviderSections();
}

function openPlayerFromTrigger(trigger) {
  const embedUrl = trigger.dataset.embedUrl || trigger.dataset.playUrl;
  const fallbackUrl = trigger.dataset.playUrl;
  const title = trigger.dataset.title || "Video";

  elements.playerTitle.textContent = title;
  elements.playerFallback.href = fallbackUrl;
  elements.playerFrame.src = embedUrl;
  elements.playerModal.hidden = false;
  document.body.classList.add("is-modal-open");
}

function closePlayer() {
  elements.playerFrame.src = "";
  elements.playerModal.hidden = true;
  document.body.classList.remove("is-modal-open");
}

async function loadData() {
  const response = await fetch(`./data/news.json?ts=${Date.now()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Kunde inte lasa news.json (${response.status})`);
  }

  state.payload = await response.json();
  render();
}

document.addEventListener("click", (event) => {
  const playTarget = event.target.closest("[data-play-url]");
  if (playTarget) {
    openPlayerFromTrigger(playTarget);
    return;
  }

  const closeTarget = event.target.closest("[data-close-modal='true']");
  if (closeTarget) {
    closePlayer();
  }
});

elements.closePlayer.addEventListener("click", closePlayer);
elements.refreshButton.addEventListener("click", () => {
  loadData().catch((error) => {
    elements.latestRow.innerHTML = `<p class="error-text">${error.message}</p>`;
  });
});

loadData().catch((error) => {
  elements.latestRow.innerHTML = `<p class="error-text">${error.message}</p>`;
});
