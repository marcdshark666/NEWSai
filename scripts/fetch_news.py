from __future__ import annotations

import hashlib
import json
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
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
    "januari": 1,
    "jan": 1,
    "februari": 2,
    "feb": 2,
    "mars": 3,
    "mar": 3,
    "april": 4,
    "apr": 4,
    "maj": 5,
    "juni": 6,
    "jun": 6,
    "juli": 7,
    "jul": 7,
    "augusti": 8,
    "aug": 8,
    "september": 9,
    "sep": 9,
    "oktober": 10,
    "okt": 10,
    "november": 11,
    "nov": 11,
    "december": 12,
    "dec": 12,
}

TITLE_BLOCKLIST = {
    "tv4",
    "start",
    "senaste",
    "sport",
    "nyhetsmorgon",
    "ekonomi",
    "inrikes",
    "utrikes",
    "politik",
    "noje",
    "tipsa tv4",
    "program a-o",
    "tabla",
    "spela",
    "min lista",
    "visa beskrivning",
    "mer om programmet",
    "kommande",
}


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    cleaned = re.sub(r"\s+", " ", value).strip()
    return cleaned.replace("\u00a0", " ")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def load_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default

    return json.loads(path.read_text(encoding="utf-8"))


def save_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def fetch_html(url: str) -> str:
    response = requests.get(url, headers=HEADERS, timeout=25)
    response.raise_for_status()
    return response.text


def absolute_url(base_url: str, href: str | None) -> str:
    if not href:
        return ""
    return urljoin(base_url, href)


def is_tv4_article_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.netloc.endswith("tv4.se") and "/artikel/" in parsed.path


def parse_date_value(value: str | None) -> str | None:
    text = normalize_text(value)
    if not text:
        return None

    candidate = (
        text.replace("•", " ")
        .replace("·", " ")
        .replace("Uppdaterad:", " ")
        .replace("Publicerad:", " ")
        .replace("Publicerades:", " ")
        .strip()
    )

    try:
        iso_value = candidate.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(iso_value)
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

    lower = candidate.lower()
    relative_match = re.search(r"\b(idag|igår|imorgon)\b\s*(?P<hour>\d{1,2})[:.](?P<minute>\d{2})", lower)
    if relative_match:
        now = datetime.now(timezone.utc)
        offset = {"igår": -1, "idag": 0, "imorgon": 1}[relative_match.group(1)]
        parsed = now.replace(
            hour=int(relative_match.group("hour")),
            minute=int(relative_match.group("minute")),
            second=0,
            microsecond=0,
        )
        parsed = parsed.replace(day=parsed.day)  # keeps datetime immutable branch explicit
        parsed = parsed.fromtimestamp(parsed.timestamp() + offset * 86400, tz=timezone.utc)
        return parsed.isoformat().replace("+00:00", "Z")

    match = re.search(
        r"(?:(?P<weekday>[A-Za-zÅÄÖåäö]{2,})\s+)?"
        r"(?P<day>\d{1,2})\s+"
        r"(?P<month>[A-Za-zÅÄÖåäö]+)\s+"
        r"(?:(?P<year>\d{4})\s+)?"
        r"(?:\s+(?P<hour>\d{1,2})[:.](?P<minute>\d{2}))?",
        candidate,
        flags=re.IGNORECASE,
    )
    if not match:
        return None

    month_name = match.group("month").lower()
    month_number = SWEDISH_MONTHS.get(month_name)
    if not month_number:
        return None

    current_year = datetime.now(timezone.utc).year
    parsed = datetime(
        year=int(match.group("year") or current_year),
        month=month_number,
        day=int(match.group("day")),
        hour=int(match.group("hour") or 0),
        minute=int(match.group("minute") or 0),
        tzinfo=timezone.utc,
    )
    return parsed.isoformat().replace("+00:00", "Z")


def extract_json_ld_values(soup: BeautifulSoup) -> list[dict[str, Any]]:
    values: list[dict[str, Any]] = []

    for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
        raw_text = script.string or script.get_text(strip=True)
        if not raw_text:
            continue

        try:
            payload = json.loads(raw_text)
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


def extract_article_metadata(article_url: str, fallback_title: str) -> dict[str, Any]:
    html = fetch_html(article_url)
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

    meta_candidates = [
        soup.find("meta", attrs={"property": "article:published_time"}),
        soup.find("meta", attrs={"name": "article:published_time"}),
        soup.find("meta", attrs={"property": "og:updated_time"}),
        soup.find("meta", attrs={"name": "date"}),
    ]

    for candidate in meta_candidates:
        if not candidate:
            continue
        published_at = parse_date_value(candidate.get("content"))
        if published_at:
            break

    if not published_at:
        for item in extract_json_ld_values(soup):
            for key in ("datePublished", "dateCreated", "dateModified", "uploadDate"):
                if key not in item:
                    continue
                published_at = parse_date_value(str(item[key]))
                if published_at:
                    break
            if published_at:
                break

    if not published_at:
        published_at = parse_date_value(soup.get_text(" ", strip=True))

    return {
        "title": title or fallback_title or article_url,
        "summary": summary,
        "image_url": image_url,
        "published_at": published_at,
    }


def clean_html_text(value: str | None) -> str:
    if not value:
        return ""
    return normalize_text(BeautifulSoup(value, "html.parser").get_text(" ", strip=True))


def collect_listing_candidates(fetch_url: str, limit: int) -> list[dict[str, str]]:
    html = fetch_html(fetch_url)
    soup = BeautifulSoup(html, "html.parser")

    candidates: list[dict[str, str]] = []
    seen_urls: set[str] = set()

    for anchor in soup.select("main a[href], a[href]"):
        href = absolute_url(fetch_url, anchor.get("href"))
        if not is_tv4_article_url(href) or href in seen_urls:
            continue

        title = normalize_text(anchor.get_text(" ", strip=True))
        if len(title) < 14 or title.lower() in TITLE_BLOCKLIST:
            continue

        seen_urls.add(href)
        candidates.append({"url": href, "list_title": title})
        if len(candidates) >= limit * 3:
            return candidates

    for raw_url in re.findall(r"https://www\.tv4\.se/artikel/[A-Za-z0-9/_-]+", html):
        if raw_url in seen_urls:
            continue
        seen_urls.add(raw_url)
        candidates.append({"url": raw_url, "list_title": ""})
        if len(candidates) >= limit * 3:
            break

    return candidates


def is_svt_video_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.netloc.endswith("svtplay.se") and "/video/" in parsed.path


def collect_svt_candidates(fetch_url: str, limit: int) -> list[dict[str, str]]:
    html = fetch_html(fetch_url)
    soup = BeautifulSoup(html, "html.parser")

    candidates: list[dict[str, str]] = []
    seen_urls: set[str] = set()

    for anchor in soup.select("main a[href], a[href]"):
        href = absolute_url(fetch_url, anchor.get("href"))
        if not is_svt_video_url(href) or href in seen_urls:
            continue

        title = normalize_text(anchor.get_text(" ", strip=True))
        if len(title) < 6 or title.lower() in TITLE_BLOCKLIST:
            continue

        seen_urls.add(href)
        candidates.append({"url": href, "list_title": title})
        if len(candidates) >= limit * 3:
            return candidates

    for raw_url in re.findall(r"https://www\.svtplay\.se/video/[A-Za-z0-9/_-]+", html):
        if raw_url in seen_urls:
            continue
        seen_urls.add(raw_url)
        candidates.append({"url": raw_url, "list_title": ""})
        if len(candidates) >= limit * 3:
            break

    return candidates


def extract_svt_video_metadata(video_url: str, fallback_title: str) -> dict[str, Any]:
    html = fetch_html(video_url)
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

    for item in extract_json_ld_values(soup):
        for key in ("datePublished", "dateCreated", "dateModified", "uploadDate"):
            if key not in item:
                continue
            published_at = parse_date_value(str(item[key]))
            if published_at:
                break
        if published_at:
            break

    if not published_at:
        published_at = parse_date_value(soup.get_text(" ", strip=True))

    return {
        "title": title or fallback_title or video_url,
        "summary": summary,
        "image_url": image_url,
        "published_at": published_at,
    }


def build_ranked_articles(
    candidates: list[dict[str, str]],
    source: dict[str, Any],
    metadata_loader: Any,
) -> list[dict[str, Any]]:
    articles: list[dict[str, Any]] = []
    seen_titles: set[str] = set()
    max_items = int(source.get("maxItems", 12))

    for candidate in candidates:
        try:
            metadata = metadata_loader(candidate["url"], candidate.get("list_title", ""))
        except requests.RequestException:
            metadata = {
                "title": candidate.get("list_title") or candidate["url"],
                "summary": "",
                "image_url": "",
                "published_at": None,
            }

        title = normalize_text(metadata["title"])
        title_key = title.lower()
        if not title or title_key in seen_titles:
            continue

        seen_titles.add(title_key)
        articles.append(
            {
                "id": hashlib.sha1(candidate["url"].encode("utf-8")).hexdigest()[:12],
                "source_id": source["id"],
                "source_name": source["name"],
                "provider": source.get("provider", source["name"]),
                "category": source.get("category", "Nyheter"),
                "title": title,
                "summary": metadata["summary"],
                "url": candidate["url"],
                "image_url": metadata["image_url"],
                "published_at": metadata["published_at"],
                "sort_order": len(articles),
            }
        )
        if len(articles) >= max_items:
            break

    return articles


def build_fox_rss_payload(source: dict[str, Any]) -> dict[str, Any]:
    max_items = int(source.get("maxItems", 16))
    payload: dict[str, Any] = {
        "id": source["id"],
        "name": source["name"],
        "provider": source.get("provider", "Amerikansk media"),
        "category": source.get("category", "USA"),
        "description": source.get("description", ""),
        "display_url": source["displayUrl"],
        "fetch_url": source["fetchUrl"],
        "status": "pending",
        "article_count": 0,
        "priority_split": int(source.get("prioritySplit", 0)),
        "articles": [],
    }

    try:
        xml_text = fetch_html(source["fetchUrl"])
        root = ET.fromstring(xml_text)
        items = root.findall("./channel/item")
        articles: list[dict[str, Any]] = []

        media_namespace = "{http://search.yahoo.com/mrss/}"
        for index, item in enumerate(items[:max_items]):
            title = normalize_text(item.findtext("title"))
            url = normalize_text(item.findtext("link"))
            summary = clean_html_text(item.findtext("description"))
            published_at = parse_date_value(item.findtext("pubDate"))

            image_url = ""
            media_node = item.find(f"{media_namespace}content") or item.find(f"{media_namespace}thumbnail")
            if media_node is not None:
                image_url = normalize_text(media_node.attrib.get("url"))

            if not image_url:
                enclosure = item.find("enclosure")
                if enclosure is not None:
                    image_url = normalize_text(enclosure.attrib.get("url"))

            if not title or not url:
                continue

            articles.append(
                {
                    "id": hashlib.sha1(url.encode("utf-8")).hexdigest()[:12],
                    "source_id": source["id"],
                    "source_name": source["name"],
                    "provider": source.get("provider", "Amerikansk media"),
                    "category": source.get("category", "USA"),
                    "title": title,
                    "summary": summary,
                    "url": url,
                    "image_url": image_url,
                    "published_at": published_at,
                    "sort_order": index,
                }
            )

        payload["articles"] = articles
        payload["article_count"] = len(articles)
        payload["status"] = "ok" if articles else "pending"
    except Exception as exc:  # noqa: BLE001
        payload["status"] = "error"
        payload["error"] = str(exc)

    return payload


def build_source_payload(source: dict[str, Any]) -> dict[str, Any]:
    source_id = source["id"]
    max_items = int(source.get("maxItems", 12))

    payload: dict[str, Any] = {
        "id": source_id,
        "name": source["name"],
        "provider": source.get("provider", source["name"]),
        "category": source.get("category", "Nyheter"),
        "description": source.get("description", ""),
        "display_url": source["displayUrl"],
        "fetch_url": source["fetchUrl"],
        "status": "pending",
        "article_count": 0,
        "priority_split": int(source.get("prioritySplit", 0)),
        "articles": [],
    }

    try:
        strategy = source.get("strategy")
        if strategy == "fox_rss":
            return build_fox_rss_payload(source)

        if strategy == "tv4_listing":
            candidates = collect_listing_candidates(source["fetchUrl"], max_items)
            articles = build_ranked_articles(candidates, source, extract_article_metadata)
        elif strategy == "svt_program":
            candidates = collect_svt_candidates(source["fetchUrl"], max_items)
            articles = build_ranked_articles(candidates, source, extract_svt_video_metadata)
        else:
            raise ValueError(f"Unsupported strategy: {strategy}")

        articles.sort(key=lambda item: item.get("published_at") or "", reverse=True)
        for index, article in enumerate(articles):
            article["sort_order"] = index

        payload["articles"] = articles
        payload["article_count"] = len(articles)
        payload["status"] = "ok" if articles else "pending"
    except Exception as exc:  # noqa: BLE001
        payload["status"] = "error"
        payload["error"] = str(exc)

    return payload


def build_payload() -> dict[str, Any]:
    configured_sources = load_json(CONFIG_PATH, [])
    sources = [build_source_payload(source) for source in configured_sources]
    existing = load_json(OUTPUT_PATH, {})

    payload = {
        "generated_at": now_iso(),
        "update_interval_minutes": 20,
        "sources": sources,
    }

    if existing.get("sources") == sources and existing.get("update_interval_minutes") == 20:
        payload["generated_at"] = existing.get("generated_at")

    return payload


def main() -> int:
    payload = build_payload()
    existing = load_json(OUTPUT_PATH, {})

    if payload != existing:
        save_json(OUTPUT_PATH, payload)

    total_articles = sum(source.get("article_count", 0) for source in payload["sources"])
    print(f"Updated {len(payload['sources'])} sources and {total_articles} articles.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
