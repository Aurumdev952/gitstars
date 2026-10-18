from gitstars.github import MAX_BLOB_BYTES, blob_text, depth2, parse_star_edge

EDGE = {
    "starredAt": "2026-10-17T19:32:26Z",
    "node": {
        "nameWithOwner": "sharkdp/fd",
        "url": "https://github.com/sharkdp/fd",
        "owner": {"login": "sharkdp"},
        "description": "",
        "homepageUrl": "",
        "repositoryTopics": {"nodes": [{"topic": {"name": "cli"}}, {"topic": {"name": "rust"}}]},
        "primaryLanguage": {"name": "Rust"},
        "languages": {"nodes": [{"name": "Rust"}, {"name": "Shell"}]},
        "stargazerCount": 35000,
        "pushedAt": "2026-10-01T00:00:00Z",
        "createdAt": "2017-05-01T00:00:00Z",
        "isArchived": False,
        "isFork": False,
        "licenseInfo": None,
        "defaultBranchRef": None,
    },
}


def test_parse_star_edge_normalizes_empty_fields():
    r = parse_star_edge(EDGE)
    assert r.full_name == "sharkdp/fd" and r.name == "fd" and r.owner == "sharkdp"
    assert r.description is None and r.homepage is None and r.license is None
    assert r.head_oid == "", "empty repo has no default branch"
    assert r.topics == ["cli", "rust"] and r.languages == ["Rust", "Shell"] and r.stars == 35000


def test_blob_text_size_rules():
    big = {"text": "x" * (MAX_BLOB_BYTES + 10), "byteSize": MAX_BLOB_BYTES + 10, "isBinary": False}
    assert blob_text(big, "CHANGELOG.md") is None
    assert len(blob_text(big, "README.md")) == MAX_BLOB_BYTES, "README keeps its head"
    assert blob_text({"text": None, "byteSize": 5, "isBinary": True}, "logo.png") is None
    assert blob_text(None, "README.md") is None


def test_depth2_filters_deeper_paths():
    entries = [{"path": "a", "type": "tree"}, {"path": "a/b", "type": "tree"}, {"path": "a/b/c.rs", "type": "blob", "size": 3}]
    assert [e.path for e in depth2(entries)] == ["a", "a/b"]
