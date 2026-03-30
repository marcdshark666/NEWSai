from __future__ import annotations

import hashlib
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config" / "sources.json"
OUTPUT_PATH = ROOT / "docs" / "data" / "news.json"

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36"
    ),
    "Accept-Language": "sv-SE,sv;q=0.9,en;q=0.8",
}

SWEDISH_MONTHS = {
    "jan": 1,
    "januari": 1,
    "feb": 2,
    "februari": 2,
    "mar": 3,
    "mars": 3,
    "apr": 4,
    "april": 4,
    "maj": 5,
    "jun": 6,
    "juni": 6,
    "jul": 7,
    "juli": 7,
    "aug": 8,
    "augusti": 8,
    "sep": 9,
    "september": 9,
    "okt": 10,
    "oktober": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}

VIDEO_BLOCKLIST = {
    "start",
    "home",
    "spela",
    "play",
    "watch",
    "watch now",
    "watch live",
    "my list",
    "min lista",
    "visa beskrivning",
    "mer om programmet",
    "see more",
    "authorize",
}

DIRECT_MEDIA_EXTENSIONS = (".m3u8", ".mp4", ".webm")


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    value = value.replace("\u00a0", " ")
    return re.sub(r"\s+", " ", value).strip()


def fold_text(value: str | None) -> str:
    text = normalize_text(value).lower()
    return (
        text.replace("a", "a")
        .replace("ä", "a")
        .replace("ö", "o")
        .replace("é", "e")
        .replace("i", "i")
    )


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def fetch_text(url: str) -> str:
    response = requests.get(url, headers=HEADERS, timeout=30)
    response.raise_for_status()
    return response.text


def absolute_url(base_url: str, href: str | None) -> str:
    if not href:
        return ""
    return urljoin(base_url, href)


def parse_date_value(value: str | None) -> str | None:
    text = normalize_text(value)
    if not text:
        return None

    candidate = (
        text.replace("•", " ")
        .replace("·", " ")
        .replace("Publicerad:", " ")
        .replace("Publicerades:", " ")
        .replace("Uppdaterad:", " ")
        .strip()
    )

    try:
        parsed = datetime.fromisoformat(candidate.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    except ValueError:
        pass

    try:
        parsed = parsedate_to_datetime(candidate)
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    except (TypeError, ValueError, IndexError):
        pass

    folded = fold_text(candidate)
    relative_match = re.search(r"\b(idag|igar|imorgon)\b\s*(\d{1,2})[:.](\d{2})", folded)
    if relative_match:
        offsets = {"igar": -1, "idag": 0, "imorgon": 1}
        base = datetime.now(timezone.utc) + timedelta(days=offsets[relative_match.group(1)])
        parsed = base.replace(
            hour=int(relative_match.group(2)),
            minute=int(relative_match.group(3)),
            second=0,
            microsecond=0,
        )
        return parsed.isoformat().replace("+00:00", "Z")

    match = re.search(
        r"(?:(?:man|tis|ons|tor|fre|lor|son)\s+)?"
        r"(?P<day>\d{1,2})\s+"
        r"(?P<month>[a-z]+)"
        r"(?:\s+(?P<year>\d{4}))?"
        r"(?:\s+(?P<hour>\d{1,2})[:.](?P<minute>\d{2}))?",
        folded,
    )
    if not match:
        return None

    month = SWEDISH_MONTHS.get(match.group("month"))
    if not month:
        return None

    parsed = datetime(
        year=int(match.group("year") or datetime.now(timezone.utc).year),
        month=month,
        day=int(match.group("day")),
        hour=int(match.group("hour") or 0),
        minute=int(match.group("minute") or 0),
        tzinfo=timezone.utc,
    )
    return parsed.isoformat().replace("+00:00", "Z")


def extract_json_ld_values(soup: BeautifulSoup) -> list[dict[str, Any]]:
    values: list[dict[str, Any]] = []

    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw = script.string or script.get_text(strip=True)
        if not raw:
            continue

        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            continue

        stack: list[Any] = [payload]
        while stack:
            current = stack.pop()
            if isinstance(current, list):
                stack.extend(current)
                continue
            if not isinstance(current, dict):
                continue

            values.append(current)
            for key in ("@graph", "itemListElement", "mainEntity", "mainEntityOfPage"):
                if key in current:
                    stack.append(current[key])

    return values


def media_mode(url: str) -> str:
    lowered = url.lower()
    return "media" if lowered.endswith(DIRECT_MEDIA_EXTENSIONS) else "iframe"


def extract_embed_target(url: str, soup: BeautifulSoup) -> tuple[str, str]:
    fox_match = re.search(r"/video/(\d+)", url)
    if fox_match:
        return (f"https://video.foxnews.com/v/video-embed.html?video_id={fox_match.group(1)}", "iframe")

    meta_candidates = [
        soup.find("meta", attrs={"name": "twitter:player"}),
        soup.find("meta", attrs={"property": "twitter:player"}),
        soup.find("meta", attrs={"property": "og:video:url"}),
        soup.find("meta", attrs={"property": "og:video:secure_url"}),
        soup.find("meta", attrs={"property": "og:video"}),
    ]

    for candidate in meta_candidates:
        if not candidate:
            continue
        target = normalize_text(candidate.get("content"))
        if target:
            return (target, media_mode(target))

    for item in extract_json_ld_values(soup):
        for key in ("embedUrl", "contentUrl"):
            target = normalize_text(item.get(key))
            if target:
                return (target, media_mode(target))

    return (url, "page_iframe")


def generic_page_metadata(url: str, fallback_title: str) -> dict[str, Any]:
    html = fetch_text(url)
    soup = BeautifulSoup(html, "html.parser")

    title = ""
    summary = ""
    image_url = ""
    published_at = None

    og_title = soup.find("meta", attrs={"property": "og:title"})
    if og_title:
        title = normalize_text(og_title.get("content"))

    if not title:
        h1 = soup.find("h1")
        title = normalize_text(h1.get_text(" ", strip=True) if h1 else fallback_title)

    description = soup.find("meta", attrs={"name": "description"}) or soup.find(
        "meta", attrs={"property": "og:description"}
    )
    if description:
        summary = normalize_text(description.get("content"))

    if not summary:
        paragraph = soup.find("p")
        if paragraph:
            summary = normalize_text(paragraph.get_text(" ", strip=True))

    og_image = soup.find("meta", attrs={"property": "og:image"})
    if og_image:
        image_url = normalize_text(og_image.get("content"))

    for meta_node in [
        soup.find("meta", attrs={"property": "article:published_time"}),
        soup.find("meta", attrs={"name": "article:published_time"}),
        soup.find("meta", attrs={"property": "og:updated_time"}),
        soup.find("meta", attrs={"name": "date"}),
    ]:
        if not meta_node:
            continue
        published_at = parse_date_value(meta_node.get("content"))
        if published_at:
            break

    if not published_at:
        for item in extract_json_ld_values(soup):
            for key in ("datePublished", "dateCreated", "dateModified", "uploadDate"):
                published_at = parse_date_value(str(item.get(key, "")))
                if published_at:
                    break
            if published_at:
                break

    if not published_at:
        published_at = parse_date_value(soup.get_text(" ", strip=True))

    embed_url, play_mode = extract_embed_target(url, soup)

    return {
        "title": title or fallback_title or url,
        "summary": summary,
        "image_url": image_url,
        "published_at": published_at,
        "embed_url": embed_url,
        "play_mode": play_mode,
    }


def looks_like_video_title(title: str) -> bool:
    folded = fold_text(title)
    return bool(title) and folded not in VIDEO_BLOCKLIST and len(title) > 4


def collect_candidates(fetch_url: str, pattern: str, limit: int, require_anchor_text: bool = False) -> list[dict[str, str]]:
    html = fetch_text(fetch_url)
    soup = BeautifulSoup(html, "html.parser")

    candidates: list[dict[str, str]] = []
    seen: set[str] = set()

    for anchor in soup.select("main a[href], a[href]"):
        href = absolute_url(fetch_url, anchor.get("href"))
        if not re.search(pattern, href):
            continue
        if href in seen:
            continue

        title = normalize_text(anchor.get_text(" ", strip=True))
        if require_anchor_text and not looks_like_video_title(title):
            continue

        seen.add(href)
        candidates.append({"url": href, "list_title": title})
        if len(candidates) >= limit * 4:
            return candidates

    for raw_url in re.findall(pattern, html):
        if raw_url in seen:
            continue
        seen.add(raw_url)
        candidates.append({"url": raw_url, "list_title": ""})
        if len(candidates) >= limit * 4:
            break

    return candidates


def empty_source_payload(source: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": source["id"],
        "name": source["name"],
        "provider": source.get("provider", source["name"]),
        "category": source.get("category", "Video"),
        "description": source.get("description", ""),
        "display_url": source["displayUrl"],
        "fetch_url": source["fetchUrl"],
        "status": "pending",
        "article_count": 0,
        "priority_split": int(source.get("prioritySplit", 0)),
        "articles": [],
    }


def build_video_items(source: dict[str, Any], candidates: list[dict[str, str]], order_by_time: bool) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    seen_titles: set[str] = set()
    max_items = int(source.get("maxItems", 12))

    for candidate in candidates:
        try:
            metadata = generic_page_metadata(candidate["url"], candidate.get("list_title", ""))
        except requests.RequestException:
            metadata = {
                "title": candidate.get("list_title") or candidate["url"],
                "summary": "",
                "image_url": "",
                "published_at": None,
                "embed_url": candidate["url"],
                "play_mode": "page_iframe",
            }

        title = normalize_text(metadata["title"])
        key = fold_text(title)
        if not title or key in seen_titles:
            continue
        seen_titles.add(key)

        items.append(
            {
                "id": hashlib.sha1(candidate["url"].encode("utf-8")).hexdigest()[:12],
                "source_id": source["id"],
                "source_name": source["name"],
                "provider": source.get("provider", source["name"]),
                "category": source.get("category", "Video"),
                "title": title,
                "summary": metadata["summary"],
                "url": candidate["url"],
                "image_url": metadata["image_url"],
                "published_at": metadata["published_at"],
                "embed_url": metadata["embed_url"],
                "play_mode": metadata["play_mode"],
                "sort_order": len(items),
            }
        )

        if len(items) >= max_items:
            break

    if order_by_time:
        items.sort(key=lambda item: item.get("published_at") or "", reverse=True)
        for index, item in enumerate(items):
            item["sort_order"] = index

    return items


def build_rss_payload(source: dict[str, Any]) -> dict[str, Any]:
    payload = empty_source_payload(source)
    max_items = int(source.get("maxItems", 12))

    try:
        xml_text = fetch_text(source["fetchUrl"])
        root = ET.fromstring(xml_text)
        channel_items = root.findall("./channel/item")
        media_ns = "{http://search.yahoo.com/mrss/}"

        items: list[dict[str, Any]] = []
        for index, item in enumerate(channel_items[:max_items]):
            title = normalize_text(item.findtext("title"))
            url = normalize_text(item.findtext("link"))
            summary = normalize_text(BeautifulSoup(item.findtext("description") or "", "html.parser").get_text(" ", strip=True))
            published_at = parse_date_value(item.findtext("pubDate"))

            image_url = ""
            media_node = item.find(f"{media_ns}content") or item.find(f"{media_ns}thumbnail")
            if media_node is not None:
                image_url = normalize_text(media_node.attrib.get("url"))

            if not title or not url:
                continue

            embed_url = url
            play_mode = "page_iframe"
            try:
                page_metadata = generic_page_metadata(url, title)
                title = normalize_text(page_metadata["title"]) or title
                summary = page_metadata["summary"] or summary
                image_url = page_metadata["image_url"] or image_url
                published_at = page_metadata["published_at"] or published_at
                embed_url = page_metadata["embed_url"]
                play_mode = page_metadata["play_mode"]
            except requests.RequestException:
                pass

            items.append(
                {
                    "id": hashlib.sha1(url.encode("utf-8")).hexdigest()[:12],
                    "source_id": source["id"],
                    "source_name": source["name"],
                    "provider": source.get("provider", source["name"]),
                    "category": source.get("category", "Video"),
                    "title": title,
                    "summary": summary,
                    "url": url,
                    "image_url": image_url,
                    "published_at": published_at,
                    "embed_url": embed_url,
                    "play_mode": play_mode,
                    "sort_order": index,
                }
            )

        payload["articles"] = items
        payload["article_count"] = len(items)
        payload["status"] = "ok" if items else "pending"
    except Exception as exc:  # noqa: BLE001
        payload["status"] = "error"
        payload["error"] = str(exc)

    return payload


def build_source_payload(source: dict[str, Any]) -> dict[str, Any]:
    strategy = source.get("strategy")
    payload = empty_source_payload(source)
    max_items = int(source.get("maxItems", 12))

    try:
        if strategy == "tv4play_listing":
            candidates = collect_candidates(
                source["fetchUrl"],
                r"https://www\.tv4play\.se/(?:klipp|video)/[A-Za-z0-9/_-]+",
                max_items,
            )
            items = build_video_items(source, candidates, order_by_time=True)
        elif strategy == "tv4_listing":
            candidates = collect_candidates(
                source["fetchUrl"],
                r"https://www\.tv4\.se/artikel/[A-Za-z0-9/_-]+",
                max_items,
                require_anchor_text=True,
            )
            items = build_video_items(source, candidates, order_by_time=True)
        elif strategy == "svt_program":
            candidates = collect_candidates(
                source["fetchUrl"],
                r"https://www\.svtplay\.se/video/[A-Za-z0-9/_-]+",
                max_items,
            )
            items = build_video_items(source, candidates, order_by_time=True)
        elif strategy == "fox_video_listing":
            candidates = collect_candidates(
                source["fetchUrl"],
                r"https://www\.foxnews\.com/video/\d+",
                max_items,
            )
            items = build_video_items(source, candidates, order_by_time=False)
        elif strategy == "bbc_rss":
            return build_rss_payload(source)
        else:
            raise ValueError(f"Unsupported strategy: {strategy}")

        payload["articles"] = items
        payload["article_count"] = len(items)
        payload["status"] = "ok" if items else "pending"
    except Exception as exc:  # noqa: BLE001
        payload["status"] = "error"
        payload["error"] = str(exc)

    return payload


def build_payload() -> dict[str, Any]:
    sources = load_json(CONFIG_PATH, [])
    compiled_sources = [build_source_payload(source) for source in sources]
    existing = load_json(OUTPUT_PATH, {})

    payload = {
        "generated_at": now_iso(),
        "update_interval_minutes": 20,
        "sources": compiled_sources,
    }

    if existing.get("sources") == compiled_sources and existing.get("update_interval_minutes") == 20:
        payload["generated_at"] = existing.get("generated_at")

    return payload


def main() -> int:
    payload = build_payload()
    existing = load_json(OUTPUT_PATH, {})

    if payload != existing:
        save_json(OUTPUT_PATH, payload)

    total_items = sum(source.get("article_count", 0) for source in payload["sources"])
    print(f"Updated {len(payload['sources'])} sources and {total_items} videos.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

