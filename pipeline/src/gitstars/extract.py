"""Pure extraction: markdown cleaning, manifest parsing, tree rendering, candidate pool, and budget assembly."""

from __future__ import annotations

import html
import json
import posixpath
import re
import tomllib
from collections.abc import Callable
from dataclasses import dataclass

import pathspec

from gitstars.domain import Candidate, CandidateId, Card, GateVerdict, HomepageDoc, Manifest, ReadmeQuality, Repo, TreeEntry

TokenCounter = Callable[[str], int]

IGNORE_PATTERNS = [
    "node_modules/",
    "__pycache__/",
    "*.pyc",
    "*.pyo",
    "*.so",
    "*.dll",
    "*.dylib",
    "*.exe",
    "*.o",
    "*.a",
    "dist/",
    "build/",
    "*.egg-info/",
    "venv/",
    "env/",
    ".git/",
    ".tox/",
    ".pytest_cache/",
    ".mypy_cache/",
    "*.log",
    ".DS_Store",
    "Thumbs.db",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "bun.lockb",
    "bun.lock",
    "Cargo.lock",
    "poetry.lock",
    "uv.lock",
    "Gemfile.lock",
    "composer.lock",
    "go.sum",
    "Pipfile.lock",
    "flake.lock",
    "*.lock",
    "target/",
    ".next/",
    "out/",
    "coverage/",
    "vendor/",
    ".idea/",
    ".vscode/",
    "*.min.js",
    "*.min.css",
    "*.map",
    "*.png",
    "*.jpg",
    "*.jpeg",
    "*.gif",
    "*.svg",
    "*.ico",
    "*.webp",
    "*.bmp",
    "*.avif",
    "*.mp4",
    "*.mov",
    "*.webm",
    "*.mp3",
    "*.wav",
    "*.ogg",
    "*.woff",
    "*.woff2",
    "*.ttf",
    "*.otf",
    "*.eot",
    "*.pdf",
    "*.zip",
    "*.tar",
    "*.gz",
    "*.tgz",
    "*.7z",
    "*.jar",
]
_IGNORE = pathspec.PathSpec.from_lines("gitignore", IGNORE_PATTERNS)

DROP_SECTIONS = re.compile(
    r"^(licen[cs]es?|licensing|contributing|contributions?|contributors?|sponsors?|sponsorship|backers?"
    r"|star[ -]?history|stargazers?|table of contents|contents|toc)\b",
    re.I,
)

TREE_DIR_LIMIT = 15
CODE_FENCE_LINES = 3


def ignored(path: str, is_dir: bool) -> bool:
    parts = path.split("/")
    if any(p.startswith(".") for p in parts):
        return True
    return _IGNORE.match_file(path + "/" if is_dir else path)


_HTML_COMMENT = re.compile(r"<!--.*?-->", re.S)
_LINKED_IMAGE = re.compile(r"\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)")
_IMAGE = re.compile(r"!\[[^\]]*\]\([^)]*\)|!\[[^\]]*\]\[[^\]]*\]")
_LINK = re.compile(r"\[([^\]]*)\]\((?:[^()]|\([^)]*\))*\)")
_REF_LINK = re.compile(r"\[([^\]]+)\]\[[^\]]*\]")
_REF_DEF = re.compile(r"^\s*\[[^\]]+\]:\s*\S+.*$", re.M)
_AUTOLINK = re.compile(r"<https?://[^>]+>")
_IMG_TAG = re.compile(r"<img\b[^>]*>", re.I)
_TAG = re.compile(r"</?[a-zA-Z][^>]*>")
_HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
_SETEXT = re.compile(r"^(=+|-+)\s*$")
_FENCE = re.compile(r"^\s*(```|~~~)")


def _heading_title(raw: str) -> str:
    return re.sub(r"^[^\w]+", "", raw).strip()


def _collapse_fences(lines: list[str]) -> list[str]:
    out: list[str] = []
    in_fence = False
    body: list[str] = []
    for line in lines:
        if _FENCE.match(line):
            if not in_fence:
                in_fence = True
                body = []
                out.append(line.rstrip())
            else:
                in_fence = False
                out.extend(body[:CODE_FENCE_LINES])
                if len(body) > CODE_FENCE_LINES:
                    out.append("…")
                out.append(line.rstrip())
            continue
        (body if in_fence else out).append(line)
    if in_fence:
        out.extend(body[:CODE_FENCE_LINES])
    return out


def _setext_to_atx(lines: list[str]) -> list[str]:
    out: list[str] = []
    for line in lines:
        if out and _SETEXT.match(line) and out[-1].strip() and not _HEADING.match(out[-1]) and len(line.strip()) >= 3:
            out[-1] = ("# " if line.strip()[0] == "=" else "## ") + out[-1].strip()
            continue
        out.append(line)
    return out


def _drop_sections(lines: list[str]) -> list[str]:
    out: list[str] = []
    drop_level: int | None = None
    in_fence = False
    for line in lines:
        if _FENCE.match(line):
            in_fence = not in_fence
        m = None if in_fence else _HEADING.match(line)
        if m:
            level = len(m.group(1))
            if drop_level is not None and level <= drop_level:
                drop_level = None
            if drop_level is None and DROP_SECTIONS.match(_heading_title(m.group(2))):
                drop_level = level
        if drop_level is None:
            out.append(line)
    return out


def clean_markdown(md: str) -> str:
    text = md.replace("\r\n", "\n")
    text = _HTML_COMMENT.sub("", text)
    text = _LINKED_IMAGE.sub("", text)
    text = _IMAGE.sub("", text)
    text = _IMG_TAG.sub("", text)
    text = _LINK.sub(r"\1", text)
    text = _REF_LINK.sub(r"\1", text)
    text = _REF_DEF.sub("", text)
    text = _AUTOLINK.sub("", text)
    text = _TAG.sub("", text)
    text = html.unescape(text)
    lines = _setext_to_atx(text.split("\n"))
    lines = _collapse_fences(lines)
    lines = _drop_sections(lines)
    out: list[str] = []
    for line in lines:
        line = re.sub(r"[ \t]+", " ", line.rstrip())
        if re.fullmatch(r"\s*[-*_|:\s]*", line) and not re.fullmatch(r"\s*(---+|\*\*\*+)\s*", line):
            line = ""
        if line == "" and (not out or out[-1] == ""):
            continue
        out.append(line)
    return "\n".join(out).strip()


_REQ_NAME = re.compile(r"^\s*([A-Za-z0-9][A-Za-z0-9._-]*)")


def _req_name(spec: str) -> str | None:
    m = _REQ_NAME.match(spec)
    return m.group(1) if m else None


def _top(names: list[str], n: int = 25) -> list[str]:
    seen: dict[str, None] = {}
    for x in names:
        if x and x not in seen:
            seen[x] = None
    return list(seen)[:n]


def _str_list(v: object) -> list[str]:
    return [str(x) for x in v] if isinstance(v, list) else []


def parse_package_json(text: str) -> Manifest:
    d = json.loads(text)
    deps = [*d.get("dependencies", {}), *d.get("peerDependencies", {}), *d.get("devDependencies", {})]
    return Manifest(
        kind="package.json",
        name=d.get("name"),
        description=d.get("description"),
        keywords=_str_list(d.get("keywords")),
        scripts=list(d.get("scripts", {}) or {}),
        dependencies=_top(deps),
    )


def parse_pyproject(text: str) -> Manifest:
    d = tomllib.loads(text)
    project = d.get("project", {})
    poetry = d.get("tool", {}).get("poetry", {})
    deps = [_req_name(s) for s in project.get("dependencies", [])]
    for group in (project.get("optional-dependencies") or {}).values():
        deps += [_req_name(s) for s in group]
    deps += [k for k in (poetry.get("dependencies") or {}) if k.lower() != "python"]
    return Manifest(
        kind="pyproject.toml",
        name=project.get("name") or poetry.get("name"),
        description=project.get("description") or poetry.get("description"),
        keywords=_str_list(project.get("keywords") or poetry.get("keywords")),
        scripts=list(project.get("scripts", {}) or poetry.get("scripts", {}) or {}),
        dependencies=_top([x for x in deps if x]),
    )


def parse_cargo(text: str) -> Manifest:
    d = tomllib.loads(text)
    pkg = d.get("package", {})
    ws = d.get("workspace", {})
    deps = [*d.get("dependencies", {}), *ws.get("dependencies", {}), *d.get("dev-dependencies", {})]
    bins = [b.get("name") for b in d.get("bin", []) if isinstance(b, dict) and b.get("name")]
    return Manifest(
        kind="Cargo.toml",
        name=pkg.get("name"),
        description=pkg.get("description") if isinstance(pkg.get("description"), str) else None,
        keywords=_str_list(pkg.get("keywords")),
        scripts=bins + [f"workspace:{m}" for m in _str_list(ws.get("members"))][:10],
        dependencies=_top(deps),
    )


def parse_go_mod(text: str) -> Manifest:
    module = re.search(r"^module\s+(\S+)", text, re.M)
    reqs = re.findall(r"^\s*(?:require\s+)?([a-zA-Z0-9.-]+\.[a-z]{2,}/\S+)\s+v\S+", text, re.M)
    return Manifest(kind="go.mod", name=module.group(1) if module else None, dependencies=_top(reqs))


def parse_composer(text: str) -> Manifest:
    d = json.loads(text)
    deps = [k for k in [*d.get("require", {}), *d.get("require-dev", {})] if k != "php" and not k.startswith("ext-")]
    return Manifest(
        kind="composer.json",
        name=d.get("name"),
        description=d.get("description"),
        keywords=_str_list(d.get("keywords")),
        scripts=list(d.get("scripts", {}) or {}),
        dependencies=_top(deps),
    )


def parse_deno(text: str) -> Manifest:
    text = re.sub(r"^\s*//.*$", "", text, flags=re.M)
    d = json.loads(text)
    return Manifest(
        kind="deno.json",
        name=d.get("name"),
        scripts=list(d.get("tasks", {}) or {}),
        dependencies=_top(list(d.get("imports", {}) or {})),
    )


def parse_csproj(text: str) -> Manifest:
    refs = re.findall(r'<PackageReference\s+Include="([^"]+)"', text)
    desc = re.search(r"<Description>(.*?)</Description>", text, re.S)
    name = re.search(r"<(?:PackageId|AssemblyName)>(.*?)</", text)
    return Manifest(
        kind="csproj",
        name=name.group(1) if name else None,
        description=desc.group(1).strip() if desc else None,
        dependencies=_top(refs),
    )


MANIFEST_PARSERS: dict[str, Callable[[str], Manifest]] = {
    "package.json": parse_package_json,
    "pyproject.toml": parse_pyproject,
    "Cargo.toml": parse_cargo,
    "go.mod": parse_go_mod,
    "composer.json": parse_composer,
    "deno.json": parse_deno,
    "deno.jsonc": parse_deno,
}


def parse_manifest(path: str, text: str) -> Manifest | None:
    parser = parse_csproj if path.endswith(".csproj") else MANIFEST_PARSERS.get(path)
    if parser is None:
        return None
    try:
        return parser(text)
    except (ValueError, tomllib.TOMLDecodeError, AttributeError, TypeError):
        return None


def render_manifest(m: Manifest) -> str:
    rows = [f"[{m.kind}]"]
    if m.name:
        rows.append(f"name: {m.name}")
    if m.description:
        rows.append(f"description: {m.description}")
    if m.keywords:
        rows.append("keywords: " + ", ".join(m.keywords[:15]))
    if m.scripts:
        rows.append("scripts: " + ", ".join(m.scripts[:15]))
    if m.dependencies:
        rows.append("dependencies: " + ", ".join(m.dependencies))
    return "\n".join(rows)


def render_tree(entries: list[TreeEntry], per_dir: int = TREE_DIR_LIMIT) -> str:
    """Depth-2 tree, directories first, at most `per_dir` entries per directory, then `… +N more`."""
    kept = [e for e in entries if e.path.count("/") <= 1 and not ignored(e.path, e.type == "tree")]
    children: dict[str, list[TreeEntry]] = {}
    for e in kept:
        parent = e.path.rsplit("/", 1)[0] if "/" in e.path else ""
        children.setdefault(parent, []).append(e)

    def ordered(items: list[TreeEntry]) -> list[TreeEntry]:
        return sorted(items, key=lambda e: (e.type != "tree", e.path.lower()))

    lines: list[str] = []

    def emit(items: list[TreeEntry], indent: str) -> None:
        items = ordered(items)
        for e in items[:per_dir]:
            name = e.path.rsplit("/", 1)[-1]
            lines.append(f"{indent}{name}/" if e.type == "tree" else f"{indent}{name}")
            if e.type == "tree" and indent == "":
                emit(children.get(e.path, []), "  ")
        if len(items) > per_dir:
            lines.append(f"{indent}… +{len(items) - per_dir} more")

    emit(children.get("", []), "")
    return "\n".join(lines)


DOC_CANDIDATES: dict[str, CandidateId] = {
    "claude.md": CandidateId.claude_md,
    "agents.md": CandidateId.agents_md,
    "docs/readme.md": CandidateId.docs_index,
    "docs/index.md": CandidateId.docs_index,
    "docs/index.mdx": CandidateId.docs_index,
    "architecture.md": CandidateId.architecture,
    "docs/architecture.md": CandidateId.architecture,
    "changelog.md": CandidateId.changelog_head,
}
ROOT_MANIFESTS = {"package.json", "pyproject.toml", "Cargo.toml", "go.mod", "composer.json", "deno.json", "deno.jsonc"}
README_NAMES = re.compile(r"^readme(\.(md|mdx|markdown|rst|txt|org|adoc|asciidoc))?$", re.I)
README_DIRS = ("", ".github", "docs")


def readme_fallback(entries: list[TreeEntry]) -> str | None:
    """The README GitHub would show: the root first, then `.github/`, then `docs/`; Markdown preferred."""
    for d in README_DIRS:
        names = [
            e.path
            for e in entries
            if e.type == "blob" and posixpath.dirname(e.path) == d and README_NAMES.match(posixpath.basename(e.path))
        ]
        if names:
            return min(names, key=lambda p: (not p.lower().endswith((".md", ".mdx", ".markdown")), len(p)))
    return None


_DOC_EXT = (".md", ".mdx", ".markdown", ".rst", ".txt", ".org", ".adoc")


def symlink_target(path: str, text: str | None) -> str | None:
    """The repo path a symlinked doc points at, when `text` is a link target rather than content."""
    t = (text or "").strip()
    if not t or len(t) > 255 or any(c.isspace() for c in t) or not t.lower().endswith(_DOC_EXT):
        return None
    base = posixpath.dirname(path)
    target = posixpath.normpath(posixpath.join(base, t))
    return None if target.startswith("..") or target == path else target


def choose_blob_paths(entries: list[TreeEntry]) -> list[str]:
    """Blobs worth reading, picked from the tree: the README (any name), root manifests, and docs candidates."""
    taken: set[CandidateId] = set()
    readme = readme_fallback(entries)
    paths: list[str] = [readme] if readme else []
    for e in sorted(entries, key=lambda e: (e.path.count("/"), e.path)):
        if e.type != "blob":
            continue
        low = e.path.lower()
        cid = DOC_CANDIDATES.get(low)
        if cid and cid not in taken:
            taken.add(cid)
            paths.append(e.path)
        elif "/" not in e.path and (e.path in ROOT_MANIFESTS or low.endswith(".csproj")):
            paths.append(e.path)
    return paths


CHANGELOG_HEAD_CHARS = 1500
DOC_CHARS = 4000


def build_card(repo: Repo, tree: list[TreeEntry], blobs: dict[str, str | None], homepage: HomepageDoc | None) -> Card:
    candidates: dict[CandidateId, Candidate] = {}

    readme_path = readme_fallback(tree)
    if readme_path and blobs.get(readme_path):
        text = clean_markdown(blobs[readme_path] or "")
        if text:
            candidates[CandidateId.readme] = Candidate(id=CandidateId.readme, source=readme_path, text=text)

    manifests = [m for p, t in blobs.items() if t and (m := parse_manifest(p, t))]
    if manifests:
        candidates[CandidateId.manifest] = Candidate(
            id=CandidateId.manifest, source=",".join(m.kind for m in manifests), text="\n\n".join(map(render_manifest, manifests))
        )

    for path, text in blobs.items():
        cid = DOC_CANDIDATES.get(path.lower())
        if not cid or not text or cid in candidates or path == readme_path:
            continue
        cleaned = clean_markdown(text)
        cap = CHANGELOG_HEAD_CHARS if cid is CandidateId.changelog_head else DOC_CHARS
        if cleaned:
            candidates[cid] = Candidate(id=cid, source=path, text=cleaned[:cap])

    if homepage and (homepage.text or homepage.description):
        parts = [p for p in (homepage.title, homepage.description, homepage.text) if p]
        candidates[CandidateId.homepage] = Candidate(id=CandidateId.homepage, source=homepage.url, text="\n".join(parts))

    return Card(
        full_name=repo.full_name,
        description=repo.description,
        topics=repo.topics,
        languages=repo.languages or ([repo.language] if repo.language else []),
        tree=render_tree(tree),
        manifests=manifests,
        candidates=candidates,
    )


BUDGET_TOKENS = 1800
RICH_README_CHARS = 6000
HEAD_README_CHARS = 2000
HOMEPAGE_CHARS = 2000
RICH_FALLBACK_CHARS = 1500


@dataclass
class Section:
    title: str
    text: str
    floor: int

    def render(self) -> str:
        return f"## {self.title}\n{self.text}"


def _cut(text: str, n: int) -> str:
    if len(text) <= n:
        return text
    cut = text[:n]
    space = cut.rfind(" ", int(n * 0.8))
    return (cut[:space] if space > 0 else cut).rstrip() + " …"


def assumed_quality(card: Card) -> ReadmeQuality:
    """Heuristic stand-in for the gate's readme_quality when no verdict exists (v0 and ungated runs)."""
    readme = card.candidate_text(CandidateId.readme)
    if not readme:
        return ReadmeQuality.missing
    return ReadmeQuality.rich if len(readme) >= RICH_FALLBACK_CHARS else ReadmeQuality.partial


def assemble(card: Card, gate: GateVerdict | None, count: TokenCounter, budget: int = BUDGET_TOKENS) -> str:
    """The text a summarizer sees. Always description, topics, languages and tree; the rest follows the gate."""
    quality = gate.readme_quality if gate else assumed_quality(card)

    def kept(cid: CandidateId) -> bool:
        return cid in card.candidates and (gate is None or gate.kept(cid) or cid is CandidateId.manifest)

    header = [f"# {card.full_name}"]
    if card.description:
        header.append(f"Description: {card.description}")
    if card.topics:
        header.append("Topics: " + ", ".join(card.topics))
    if card.languages:
        header.append("Languages: " + ", ".join(card.languages))

    sections: list[Section] = []
    readme = card.candidate_text(CandidateId.readme)
    if quality is ReadmeQuality.rich:
        if readme:
            sections.append(Section("README", _cut(readme, RICH_README_CHARS), 1200))
    else:
        if readme and (gate is None or gate.kept(CandidateId.readme) or quality is not ReadmeQuality.template):
            # Up to the rich cap, but trimmed first down to its 2k head, so leftover budget goes to the README
            # instead of going unused when there are no docs (awesome lists, thin repos).
            sections.append(Section("README (head)", _cut(readme, RICH_README_CHARS), HEAD_README_CHARS))
        for cid in (
            CandidateId.agents_md,
            CandidateId.claude_md,
            CandidateId.docs_index,
            CandidateId.architecture,
            CandidateId.changelog_head,
        ):
            if kept(cid):
                sections.append(Section(f"{cid.value} ({card.candidates[cid].source})", _cut(card.candidate_text(cid), DOC_CHARS), 300))
    if kept(CandidateId.homepage):
        sections.append(Section("Homepage", _cut(card.candidate_text(CandidateId.homepage), HOMEPAGE_CHARS), 300))
    if CandidateId.manifest in card.candidates:
        sections.append(Section("Manifest", card.candidate_text(CandidateId.manifest), 200))
    if card.tree:
        sections.append(Section("Tree (depth 2)", card.tree, 200))

    def render() -> str:
        return "\n".join(header) + "".join("\n\n" + s.render() for s in sections)

    for _ in range(40):
        text = render()
        if count(text) <= budget:
            return text
        trimmable = [s for s in sections if len(s.text) > s.floor]
        if not trimmable:
            return text
        widest = max(trimmable, key=lambda s: len(s.text) - s.floor)
        widest.text = _cut(widest.text, max(widest.floor, int(len(widest.text) * 0.8)))
    return render()


def v0_text(card: Card, repo: Repo) -> str:
    """Embedding text for repos with no summary: the raw card's high-signal head."""
    parts = [repo.full_name]
    if repo.description:
        parts.append(repo.description)
    if repo.topics:
        parts.append("Topics: " + ", ".join(repo.topics))
    if card.languages:
        parts.append("Languages: " + ", ".join(card.languages))
    readme = card.candidate_text(CandidateId.readme)
    if readme:
        parts.append(_cut(readme, 1500))
    elif CandidateId.homepage in card.candidates:
        parts.append(_cut(card.candidate_text(CandidateId.homepage), 800))
    return "\n".join(parts)
