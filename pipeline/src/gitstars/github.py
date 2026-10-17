"""GitHub boundary: GraphQL star pages, REST trees, and batched blob reads, parsed into domain types."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any

import httpx
from tenacity import AsyncRetrying, retry_if_exception, stop_after_attempt, wait_exponential

from gitstars.domain import Repo, TreeEntry

GRAPHQL = "https://api.github.com/graphql"
REST = "https://api.github.com"
MAX_BLOB_BYTES = 64 * 1024

_BLOB = "... on Blob { text byteSize isBinary }"
_STARS_QUERY = (
    "query($first: Int!, $after: String) { viewer { login starredRepositories(first: $first, after: $after,"
    " orderBy: {field: STARRED_AT, direction: DESC}) { totalCount pageInfo { hasNextPage endCursor }"
    " edges { starredAt node { nameWithOwner url owner { login } description homepageUrl"
    " repositoryTopics(first: 20) { nodes { topic { name } } } primaryLanguage { name }"
    " languages(first: 5, orderBy: {field: SIZE, direction: DESC}) { nodes { name } }"
    " stargazerCount pushedAt createdAt isArchived isFork licenseInfo { spdxId }"
    " defaultBranchRef { target { oid } } } } } } }"
)


class GitHubError(RuntimeError):
    pass


class GitHubTimeout(GitHubError):
    pass


def _retryable(exc: BaseException) -> bool:
    if isinstance(exc, (httpx.TransportError, GitHubTimeout)):
        return True
    return isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code in (502, 503, 504)


def blob_text(obj: dict[str, Any] | None, path: str) -> str | None:
    """Text of a GraphQL Blob, or None when absent, binary, or not UTF-8. Over 64 KiB: skipped, except a README,
    which keeps its head because long READMEs (awesome lists) are still the best description there is."""
    if not obj or obj.get("isBinary") or obj.get("text") is None:
        return None
    if (obj.get("byteSize") or 0) > MAX_BLOB_BYTES:
        return obj["text"][:MAX_BLOB_BYTES] if path.lower().startswith("readme") else None
    return obj["text"]


def parse_star_edge(edge: dict[str, Any]) -> Repo:
    n = edge["node"]
    target = (n.get("defaultBranchRef") or {}).get("target") or {}
    return Repo(
        full_name=n["nameWithOwner"],
        owner=n["owner"]["login"],
        head_oid=target.get("oid") or "",
        url=n["url"],
        description=(n.get("description") or None),
        homepage=(n.get("homepageUrl") or None),
        topics=[t["topic"]["name"] for t in n["repositoryTopics"]["nodes"]],
        language=(n.get("primaryLanguage") or {}).get("name"),
        languages=[x["name"] for x in n["languages"]["nodes"]],
        stars=n["stargazerCount"],
        pushed_at=n.get("pushedAt"),
        created_at=n.get("createdAt"),
        starred_at=edge["starredAt"],
        archived=n["isArchived"],
        fork=n["isFork"],
        license=(n.get("licenseInfo") or {}).get("spdxId"),
    )


def depth2(entries: list[dict[str, Any]]) -> list[TreeEntry]:
    return [TreeEntry(path=e["path"], type=e["type"], size=e.get("size")) for e in entries if e["path"].count("/") <= 1]


class GitHub:
    def __init__(self, token: str, concurrency: int = 8):
        self.client = httpx.AsyncClient(
            http2=True,
            timeout=httpx.Timeout(30.0, connect=10.0),
            headers={"Authorization": f"bearer {token}", "Accept": "application/vnd.github+json", "User-Agent": "gitstars"},
        )
        self.sem = asyncio.Semaphore(concurrency)

    async def aclose(self) -> None:
        await self.client.aclose()

    async def _graphql(self, query: str, variables: dict[str, Any]) -> dict[str, Any]:
        resp = await self.client.post(GRAPHQL, json={"query": query, "variables": variables})
        resp.raise_for_status()
        try:
            body = resp.json()
        except ValueError as exc:
            # GitHub answers a query that ran into its ~10 s limit with an empty 200 as well as a 502.
            raise GitHubTimeout(f"unparseable {len(resp.content)}-byte body") from exc
        if body.get("errors") and not body.get("data"):
            raise GitHubError(str(body["errors"])[:500])
        return body["data"]

    async def stars(
        self, page_size: int = 50, log: Callable[[str], None] = lambda _: None
    ) -> tuple[str, list[Repo]]:
        """Every starred repo, newest star first. A page that times out (GitHub's ~10 s limit) is retried at half size."""
        out: list[Repo] = []
        after: str | None = None
        login = ""
        size = page_size
        while True:
            try:
                data = await self._graphql(_STARS_QUERY, {"first": size, "after": after})
            except (httpx.HTTPStatusError, httpx.TransportError, GitHubTimeout) as exc:
                if not _retryable(exc) or size <= 1:
                    raise
                size = max(1, size // 2)
                log(f"stars page timed out ({type(exc).__name__}: {str(exc)[:80]}); retrying at {size}")
                continue
            viewer = data["viewer"]
            login = viewer["login"]
            sr = viewer["starredRepositories"]
            out.extend(parse_star_edge(e) for e in sr["edges"])
            log(f"stars {len(out)}/{sr['totalCount']} (page {size})")
            if not sr["pageInfo"]["hasNextPage"]:
                return login, out
            after = sr["pageInfo"]["endCursor"]
            size = min(page_size, size * 2)

    async def tree(self, full_name: str, oid: str) -> list[TreeEntry]:
        async with self.sem:
            async for attempt in AsyncRetrying(
                retry=retry_if_exception(_retryable), stop=stop_after_attempt(4), wait=wait_exponential(1, max=20), reraise=True
            ):
                with attempt:
                    resp = await self.client.get(f"{REST}/repos/{full_name}/git/trees/{oid}", params={"recursive": "1"})
                    if resp.status_code in (404, 409, 422):
                        return []
                    resp.raise_for_status()
        return depth2(resp.json().get("tree", []))

    async def blobs(self, wanted: dict[str, tuple[str, list[str]]]) -> dict[str, dict[str, str | None]]:
        """Batched reads: {full_name: (oid, [paths])} → {full_name: {path: text|None}}, one GraphQL call per ~15 repos."""
        items = [(fn, oid, paths) for fn, (oid, paths) in wanted.items() if paths and oid]
        out: dict[str, dict[str, str | None]] = {}

        async def run(chunk: list[tuple[str, str, list[str]]]) -> None:
            parts = []
            for i, (fn, oid, paths) in enumerate(chunk):
                owner, name = fn.split("/", 1)
                fields = " ".join(
                    f'f{j}: object(expression: "{oid}:{_gql_escape(p)}") {{ {_BLOB} }}' for j, p in enumerate(paths)
                )
                parts.append(f'r{i}: repository(owner: "{_gql_escape(owner)}", name: "{_gql_escape(name)}") {{ {fields} }}')
            query = "query { " + " ".join(parts) + " }"
            async with self.sem:
                async for attempt in AsyncRetrying(
                    retry=retry_if_exception(_retryable), stop=stop_after_attempt(4), wait=wait_exponential(1, max=20), reraise=True
                ):
                    with attempt:
                        data = await self._graphql(query, {})
            for i, (fn, _oid, paths) in enumerate(chunk):
                node = data.get(f"r{i}") or {}
                out[fn] = {p: blob_text(node.get(f"f{j}"), p) for j, p in enumerate(paths)}

        chunks = [items[i : i + 15] for i in range(0, len(items), 15)]
        await asyncio.gather(*(run(c) for c in chunks))
        return out


def _gql_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace('"', '\\"')
