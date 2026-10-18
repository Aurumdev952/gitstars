from gitstars.llm import local
from gitstars.llm.openrouter import ChatTransport
from gitstars.llm.pool import ModelSlot
from gitstars.llm.schema import SUMMARY_SCHEMA, OutputSchema
from gitstars.naming import NAME_SCHEMA

MSGS = [{"role": "user", "content": "hi"}]


def test_structured_slot_gets_the_callers_schema():
    t = ChatTransport("https://x/api/v1", {})
    slot = ModelSlot("m:free", structured=True, reasoning={"enabled": False})
    body = t.body(slot, MSGS, NAME_SCHEMA)
    assert body["response_format"]["json_schema"]["name"] == "cluster_name"
    assert body["response_format"]["json_schema"]["schema"]["required"] == ["name", "blurb"]
    assert body["reasoning"] == {"enabled": False}
    assert t.body(slot, MSGS, SUMMARY_SCHEMA)["response_format"]["json_schema"]["name"] == "repo_summary"
    plain = t.body(ModelSlot("p:free"), MSGS, OutputSchema("x", {}))
    assert "response_format" not in plain and "reasoning" not in plain


def test_local_provider_shape():
    pool, transport = local.build_pool()
    (slot,) = pool.slots
    assert slot.id == "gemma-4-26b" and slot.rpm is None and slot.max_in_flight == 64
    body = transport.body(slot, MSGS, SUMMARY_SCHEMA)
    assert transport.base_url == "http://127.0.0.1:8000/v1"
    assert body["temperature"] == 0.3 and body["chat_template_kwargs"] == {"enable_thinking": False}
    assert body["response_format"]["type"] == "json_schema"


async def test_403_disables_the_model_unless_it_is_a_moderation_flag():
    import httpx
    import pytest

    from gitstars.llm.openrouter import TransportError

    bodies = iter(
        [
            '{"error":{"code":403,"message":"This model is only available on agentic harnesses"}}',
            '{"error":{"code":403,"message":"Input was flagged by moderation"}}',
        ]
    )
    t = ChatTransport("https://x/api/v1", {})
    t.client = httpx.AsyncClient(transport=httpx.MockTransport(lambda req: httpx.Response(403, text=next(bodies))))
    slot = ModelSlot("m:free")
    with pytest.raises(TransportError) as harness:
        await t.complete(slot, MSGS, SUMMARY_SCHEMA)
    with pytest.raises(TransportError) as moderated:
        await t.complete(slot, MSGS, SUMMARY_SCHEMA)
    assert harness.value.permanent and not moderated.value.permanent
    await t.aclose()
