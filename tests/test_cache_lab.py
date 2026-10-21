from chatbot import cache_lab
import json


def test_modes_use_distinct_cache_rules_and_stable_prefix_breakpoint():
    inp = cache_lab.build_input("cache_growing", 1, 1)
    requests = {mode: cache_lab.assemble_request(mode, inp, 250, "test-key") for mode in cache_lab.MODES}
    assert requests["no_cache_full"]["prompt_cache_options"] == {"mode": "explicit"}
    assert not any("prompt_cache_breakpoint" in b for m in requests["no_cache_full"]["input"] for b in m.get("content", []))
    assert len([1 for m in requests["cache_full"]["input"] for b in m.get("content", []) if "prompt_cache_breakpoint" in b]) == 1
    assert requests["cache_full"]["prompt_cache_options"] == {"mode": "explicit"}
    assert requests["cache_growing"]["prompt_cache_options"] == {"mode": "implicit"}
    assert requests["cache_compact"]["prompt_cache_options"] == {"mode": "implicit"}
    assert requests["cache_growing"]["reasoning"] == requests["cache_compact"]["reasoning"] == {"effort": "low"}
    assert requests["cache_growing"]["max_output_tokens"] == requests["cache_compact"]["max_output_tokens"] == 250


def test_append_only_history_preserves_old_messages_and_compaction_replaces_only_tool_exchange():
    first = cache_lab.build_input("cache_growing", 1, 1)
    second = cache_lab.build_input("cache_growing", 2, 2)
    assert second[:len(first)-1] == first[:-1]
    assert second[1]["content"] == first[1]["content"]
    full = cache_lab.build_input("cache_growing", 1, 1)
    compact = cache_lab.build_input("cache_compact", 1, 1)
    full_dump, compact_dump = json.dumps(full), json.dumps(compact)
    assert "POLICY LOOKUP TOOL RESULT" in full_dump
    assert "POLICY LOOKUP TOOL RESULT" not in compact_dump
    assert "COMPACTED COMPLETED TOOL EXCHANGE" in compact_dump
    assert cache_lab.QUESTIONS[0] in compact_dump
    assert "day 21" in compact_dump


def test_later_exact_detail_refetch_is_active_and_fixture_is_ten_turns():
    assert len(cache_lab.QUESTIONS) == 10
    active = cache_lab.build_input("cache_compact", 8, 8)
    assert "RETURNS-v3-P1" in json.dumps(active)
    assert cache_lab.TURN_REFETCHES[10] == ["SHIPPING-v2-P5", "RETURNS-v3-P4"]
    assert "The delivery date is day one" in json.dumps(cache_lab.TURN_EVIDENCE[0])


def test_usage_cost_counts_reads_writes_and_missing_fields_as_unknown():
    missing = cache_lab.usage_accounting({"usage": {"input_tokens": 12}})
    assert missing["derived_cost_usd"] is None
    measured = cache_lab.usage_accounting({"usage": {"input_tokens": 100, "output_tokens": 20, "input_tokens_details": {"cached_tokens": 30, "cache_write_tokens": 10}}})
    assert measured["ordinary_input_tokens"] == 60
    assert measured["derived_cost_usd"] == (60*.1+30*.01+10*.125+20*.5)/1_000_000


def test_preflight_is_bounded_and_has_no_retry_reserve():
    gate = cache_lab.preflight("cache_compact", 250)
    assert gate["planned_calls"] == 10
    assert gate["retry_reserve"] == "none; no automatic retries"
    assert gate["estimated_maximum_usd"] < .25


def test_fixture_message_hashes_detect_earlier_message_change():
    a = cache_lab.build_input("cache_growing", 2, 2)
    b = json.loads(json.dumps(a))
    b[1]["content"][0]["text"] += " changed"
    ha = [cache_lab.sha(json.dumps(x, sort_keys=True, ensure_ascii=False)) for x in a]
    hb = [cache_lab.sha(json.dumps(x, sort_keys=True, ensure_ascii=False)) for x in b]
    matching = 0
    while matching < min(len(ha), len(hb)) and ha[matching] == hb[matching]: matching += 1
    assert matching == 1

