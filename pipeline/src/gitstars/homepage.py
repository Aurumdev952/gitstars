"""Homepage boundary: fetch a project's website and extract title, description and main text."""

from __future__ import annotations

import asyncio
from urllib.parse import urlparse

import httpx
import trafilatura

from gitstars.domain import HomepageDoc

MAX_BYTES = 2 * 1024 * 1024
TEXT_CHARS = 2000
MIRROR_HOSTS = (
    "github.com", "www.github.com", "npmjs.com", "www.npmjs.com", "npmjs.org", "npm.im", "www.npm.im", "pypi.org", "pypi.python.org",
    "crates.io", "docs.rs", "lib.rs", "pkg.go.dev", "rubygems.org", "packagist.org", "nuget.org", "www.nuget.org",
    "hub.docker.com", "gitlab.com", "marketplace.visualstudio.com", "chromewebstore.google.com",
    "chrome.google.com", "addons.mozilla.org", "huggingface.co", "x.com", "twitter.com", "youtube.com",
    "www.youtube.com", "youtu.be", "discord.gg", "discord.com", "t.me",
)


def normalize_url(url: str | None) -> str | None:
    if not url or not url.strip():
        return None
    url = url.strip()
    if "://" not in url:
        url = "https://" + url
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return None
    return url


def worth_fetching(url: str | None) -> bool:
    url = normalize_url(url)
    if not url:
        return False
    host = urlparse(url).netloc.lower().split(":")[0]
    return not (host in MIRROR_HOSTS or host.endswith(".github.com"))


def extract(url: str, html: str) -> HomepageDoc:
    meta = trafilatura.extract_metadata(html)
    text = trafilatura.extract(html, include_comments=False, include_tables=False, favor_precision=True) or ""
    return HomepageDoc(
        url=url,
        title=(meta.title if meta else None) or None,
        description=(meta.description if meta else None) or None,
        text=" ".join(text.split())[:TEXT_CHARS],
    )


class HomepageFetcher:
    # Not the plan's 16: at 16-way the local stub resolver answered ~90% of lookups with a spurious
    # "Name or service not known"; at 6-way about 5% failed, mostly dead domains.
    def __init__(self, concurrency: int = 6):
        self.client = httpx.AsyncClient(
            # IPv4 only: this host has no IPv6 route and httpx doesn't fall back the way curl does.
            transport=httpx.AsyncHTTPTransport(local_address="0.0.0.0", retries=1),
            timeout=httpx.Timeout(10.0),
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) gitstars/0.1", "Accept": "text/html,*/*;q=0.5"},
        )
        self.sem = asyncio.Semaphore(concurrency)

    async def aclose(self) -> None:
        await self.client.aclose()

    async def fetch(self, url: str) -> tuple[HomepageDoc | None, str | None]:
        """(doc, error). Bodies over 2 MB are cut off; non-HTML responses are skipped."""
        async with self.sem:
            try:
                async with asyncio.timeout(15):
                    async with self.client.stream("GET", url) as resp:
                        if resp.status_code >= 400:
                            return None, f"http {resp.status_code}"
                        ctype = resp.headers.get("content-type", "")
                        if "html" not in ctype and "xml" not in ctype:
                            return None, f"content-type {ctype[:40]}"
                        chunks: list[bytes] = []
                        size = 0
                        async for chunk in resp.aiter_bytes():
                            chunks.append(chunk)
                            size += len(chunk)
                            if size >= MAX_BYTES:
                                break
                        body = b"".join(chunks)[:MAX_BYTES].decode(resp.encoding or "utf-8", errors="replace")
            except (httpx.HTTPError, TimeoutError, UnicodeError) as exc:
                return None, f"{type(exc).__name__}: {str(exc)[:120]}"
        doc = await asyncio.to_thread(extract, url, body)
        return doc, None
