from gitstars.domain import Candidate, CandidateId, Card, GateVerdict, ReadmeQuality, Repo, TreeEntry
from gitstars.extract import (
    assemble,
    build_card,
    choose_blob_paths,
    clean_markdown,
    parse_manifest,
    render_tree,
)

README = """<p align="center"><img src="logo.png" width="200"></p>

# fd [![CI](https://github.com/x/fd/badge.svg)](https://github.com/x/fd/actions) ![shield](https://img.shields.io/x.svg)

<!-- hidden note -->
**fd** is a [fast](https://example.com/bench) alternative to `find`. See [docs][docs] and <https://fd.dev>.

[docs]: https://fd.dev/docs

## Features
- Intuitive syntax &amp; smart case

```bash
fd PATTERN
fd -e md
fd -H
fd --exec echo
fd -x rm
```

## Contributing
Please open a PR.

### Dev setup
cargo build

## Usage
Run it.

## License
MIT
"""


def test_clean_markdown_strips_noise_and_keeps_meaning():
    out = clean_markdown(README)
    assert "img" not in out and "shields.io" not in out and "badge.svg" not in out
    assert "hidden note" not in out
    assert "**fd** is a fast alternative to `find`. See docs and ." in out
    assert "fd.dev/docs" not in out
    assert "Intuitive syntax & smart case" in out
    assert "fd PATTERN\nfd -e md\nfd -H\n…\n```" in out
    assert "fd --exec echo" not in out
    assert "Please open a PR" not in out and "cargo build" not in out, "Contributing and its subsections are dropped"
    assert "## Usage\nRun it." in out, "a same-level heading ends the dropped section"
    assert "MIT" not in out
    assert "\n\n\n" not in out


def test_clean_markdown_setext_headings_and_emoji_titles():
    out = clean_markdown("Title\n=====\n\nIntro\n\n📜 License\n-------\nGPL\n\n## ✨ Features\nfast")
    assert out.startswith("# Title")
    assert "GPL" not in out
    assert "## ✨ Features\nfast" in out


def _tree():
    entries = [TreeEntry(path="src", type="tree"), TreeEntry(path="node_modules", type="tree"), TreeEntry(path=".github", type="tree")]
    entries += [TreeEntry(path=f"src/f{i:02d}.rs", type="blob") for i in range(20)]
    entries += [TreeEntry(path="src/core", type="tree"), TreeEntry(path="src/core/deep.rs", type="blob")]
    entries += [TreeEntry(path=n, type="blob") for n in ("README.md", "Cargo.toml", "Cargo.lock", "logo.png", "docs/index.md")]
    entries += [TreeEntry(path="docs", type="tree"), TreeEntry(path="CLAUDE.md", type="blob"), TreeEntry(path="go.mod", type="blob")]
    return entries


def test_render_tree_depth2_dirs_first_capped():
    out = render_tree(_tree()).split("\n")
    assert out[0] == "docs/" and out[1] == "  index.md" and out[2] == "src/"
    assert out[3] == "  core/", "directories first inside a directory too"
    assert "  … +6 more" in out, "21 children, 15 shown"
    assert not any("deep.rs" in line for line in out), "depth 3 is cut"
    assert not any(x in "\n".join(out) for x in ("node_modules", ".github", "Cargo.lock", "logo.png"))
    assert out[-4:] == ["Cargo.toml", "CLAUDE.md", "go.mod", "README.md"]


def test_choose_blob_paths_readme_manifests_docs():
    entries = _tree() + [TreeEntry(path="readme.rst", type="blob")]
    assert choose_blob_paths(entries) == ["README.md", "CLAUDE.md", "Cargo.toml", "go.mod", "docs/index.md"]
    no_md = [e for e in entries if e.path != "README.md"]
    assert choose_blob_paths(no_md)[0] == "readme.rst"
    assert choose_blob_paths([]) == []


def test_manifest_parsing_names_without_versions():
    pkg = parse_manifest(
        "package.json",
        '{"name":"vite","description":"Next gen tooling","keywords":["bundler"],"scripts":{"dev":"x","build":"y"},'
        '"dependencies":{"esbuild":"^0.21","rollup":"^4"},"devDependencies":{"vitest":"1"}}',
    )
    assert pkg.name == "vite" and pkg.scripts == ["dev", "build"] and pkg.dependencies == ["esbuild", "rollup", "vitest"]
    py = parse_manifest(
        "pyproject.toml",
        '[project]\nname="uvx"\ndescription="d"\ndependencies=["httpx[http2]>=0.27", "pydantic ~= 2.0"]\n'
        '[project.scripts]\nuvx="uvx:main"\n[project.optional-dependencies]\ndev=["pytest>=8"]\n',
    )
    assert py.dependencies == ["httpx", "pydantic", "pytest"] and py.scripts == ["uvx"]
    cargo = parse_manifest("Cargo.toml", '[package]\nname="fd-find"\nkeywords=["find"]\n[dependencies]\nregex="1"\nclap={version="4"}\n')
    assert cargo.name == "fd-find" and cargo.dependencies == ["regex", "clap"]
    gomod = parse_manifest("go.mod", "module github.com/a/b\n\nrequire (\n\tgithub.com/spf13/cobra v1.8.0\n\tgolang.org/x/sys v0.1.0 // indirect\n)\n")
    assert gomod.name == "github.com/a/b" and gomod.dependencies == ["github.com/spf13/cobra", "golang.org/x/sys"]
    assert parse_manifest("package.json", "{not json") is None
    assert len(parse_manifest("package.json", '{"dependencies":{' + ",".join(f'"d{i}":"1"' for i in range(40)) + "}}").dependencies) == 25


def _repo(**kw):
    base = dict(full_name="o/r", owner="o", head_oid="abc", url="https://github.com/o/r", starred_at="2024-01-01T00:00:00Z")
    return Repo(**{**base, **kw})


def chars4(text: str) -> int:
    return len(text) // 4


def test_assemble_respects_budget_and_gate():
    long_readme = "word " * 4000
    card = Card(
        full_name="o/r",
        description="desc",
        topics=["cli"],
        languages=["Rust"],
        tree="src/\n  main.rs",
        candidates={
            CandidateId.readme: Candidate(id=CandidateId.readme, source="README.md", text=long_readme),
            CandidateId.changelog_head: Candidate(id=CandidateId.changelog_head, source="CHANGELOG.md", text="v1 added things"),
            CandidateId.homepage: Candidate(id=CandidateId.homepage, source="https://x", text="Homepage text"),
        },
    )
    rich = GateVerdict(keep={CandidateId.readme: 0.9, CandidateId.changelog_head: 0.9, CandidateId.homepage: 0.2}, readme_quality=ReadmeQuality.rich, model="m")
    text = assemble(card, rich, chars4, budget=1800)
    assert chars4(text) <= 1800
    assert text.startswith("# o/r\nDescription: desc\nTopics: cli\nLanguages: Rust")
    assert "## Tree (depth 2)\nsrc/\n  main.rs" in text
    assert "changelog_head" not in text, "rich README path skips docs candidates"
    assert "Homepage text" not in text, "homepage dropped by the gate"

    partial = rich.model_copy(update={"readme_quality": ReadmeQuality.partial, "keep": {**rich.keep, CandidateId.homepage: 0.8}})
    text = assemble(card, partial, chars4, budget=1800)
    assert "## README (head)" in text and "v1 added things" in text and "Homepage text" in text
    readme_part = lambda t: t.split("## README (head)\n")[1].split("\n\n")[0]  # noqa: E731
    assert len(readme_part(text)) > 2000, "unused budget goes to the README"
    tight = assemble(card, partial, chars4, budget=600)
    assert chars4(tight) <= 600
    assert 2000 <= len(readme_part(tight)) <= 2300, "README shrinks toward its 2k head while docs stay whole"
    assert "v1 added things" in tight and "Homepage text" in tight


def test_build_card_uses_readme_fallback_and_homepage():
    repo = _repo(description="d", topics=["x"], language="Go")
    tree = [TreeEntry(path="README.rst", type="blob"), TreeEntry(path="main.go", type="blob")]
    card = build_card(repo, tree, {"README.md": None, "README.rst": "Hello *world*", "package.json": None}, None)
    assert card.candidates[CandidateId.readme].source == "README.rst"
    assert card.languages == ["Go"]
    assert CandidateId.homepage not in card.candidates


def test_symlink_target_detects_monorepo_readme_links():
    from gitstars.extract import symlink_target

    assert symlink_target("README.md", "packages/next/README.md") == "packages/next/README.md"
    assert symlink_target("README.md", "./cli/README.md\n") == "cli/README.md"
    assert symlink_target("docs/README.md", "../packages/core/README.md") == "packages/core/README.md"
    assert symlink_target("README.md", "# Title\nreal content.md") is None
    assert symlink_target("README.md", "../../outside.md") is None
    assert symlink_target("README.md", "Moved to Codeberg") is None


def test_readme_fallback_follows_github_lookup_order():
    from gitstars.extract import readme_fallback

    docs_only = [TreeEntry(path="docs", type="tree"), TreeEntry(path="docs/README.md", type="blob")]
    assert readme_fallback(docs_only) == "docs/README.md"
    both = docs_only + [TreeEntry(path=".github/README.md", type="blob"), TreeEntry(path="README.asciidoc", type="blob")]
    assert readme_fallback(both) == "README.asciidoc", "root wins, whatever the extension"
    card = build_card(_repo(), docs_only, {"docs/README.md": "# pipx\nInstall apps in isolated envs."}, None)
    assert card.candidates[CandidateId.readme].source == "docs/README.md"
    assert CandidateId.docs_index not in card.candidates, "the same file is not offered twice"
