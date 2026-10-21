from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

import numpy as np

from rag.search import retrieve_detailed, search_documents


class ReverseReranker:
    def rerank(self, query, passages):
        reversed_passages = list(reversed(passages))
        return [dict(item, rerank_score=0.8 + (len(passages) - index) / 10)
                for index, item in enumerate(reversed_passages)]


class FailingReranker:
    def rerank(self, query, passages):
        raise RuntimeError("internal details must not escape")


def database(rows):
    conn = MagicMock()
    conn.execute.side_effect = [MagicMock(fetchall=MagicMock(return_value=[("RETURNS", 1)])),
                                MagicMock(fetchall=MagicMock(return_value=rows))]
    manager = MagicMock()
    manager.__enter__.return_value = conn
    return manager, conn


class SearchTests(unittest.TestCase):
    def setUp(self):
        self.rows = [
            ("RETURNS-v1-p2", "RETURNS", 1, "Second passage", [0.8, 0.6]),
            ("RETURNS-v1-p1", "RETURNS", 1, "First passage", [0.8, 0.6]),
        ]

    def invoke(self, rows=None, reranker=None, **kwargs):
        manager, conn = database(self.rows if rows is None else rows)
        with patch("rag.search.connect_project_database", return_value=manager), \
             patch("rag.search.embed_texts", return_value=[[1.0, 0.0]]):
            result = retrieve_detailed("question", reranker=reranker or ReverseReranker(), **kwargs)
        return result, conn

    def test_reranker_can_reverse_cosine_candidates_and_preserves_both_ranks(self):
        result, conn = self.invoke()
        self.assertEqual([x["passage_id"] for x in result["cosine_candidates"]],
                         ["RETURNS-v1-p1", "RETURNS-v1-p2"])
        self.assertEqual([x["passage_id"] for x in result["selected"]],
                         ["RETURNS-v1-p2", "RETURNS-v1-p1"])
        self.assertEqual(result["selected"][0]["cosine_rank"], 2)
        self.assertEqual(result["selected"][0]["rerank_rank"], 1)
        self.assertIn("v.status = 'READY'", conn.execute.call_args_list[1].args[0])

    def test_equal_rerank_scores_have_deterministic_passage_order(self):
        class Equal:
            def rerank(self, query, passages):
                return [dict(item, rerank_score=0.5) for item in reversed(passages)]
        result, _ = self.invoke(reranker=Equal())
        self.assertEqual([x["passage_id"] for x in result["selected"]],
                         ["RETURNS-v1-p1", "RETURNS-v1-p2"])

    def test_empty_corpus_does_not_invoke_reranker(self):
        class Exploding:
            def rerank(self, query, passages):
                raise AssertionError("must not load model")
        result, _ = self.invoke(rows=[], reranker=Exploding())
        self.assertEqual(result["selected"], [])

    def test_invalid_query_and_top_k_are_rejected(self):
        for query in ("", "x" * 1001, None):
            with self.subTest(query=str(query)[:5]), self.assertRaises(ValueError):
                retrieve_detailed(query)
        with self.assertRaises(ValueError):
            retrieve_detailed("question", top_k=6)

    def test_tool_contract_hides_candidate_scores_and_returns_selected_text(self):
        with patch("rag.search.retrieve_detailed", return_value={
            "results": [{"passage_id": "p1", "document_id": "D", "version": 1,
                         "text": "only selected text"}], "message": "ok"
        }) as detail:
            result = search_documents("question")
        self.assertEqual(result["results"][0]["text"], "only selected text")
        self.assertNotIn("cosine_candidates", result)
        detail.assert_called_once_with("question", 5)

    def test_reranker_failure_is_reported_without_cosine_fallback(self):
        with patch("rag.search.retrieve_detailed", side_effect=RuntimeError("safe rerank message")):
            result = search_documents("question")
        self.assertEqual(result["results"], [])
        self.assertEqual(result["message"], "safe rerank message")


if __name__ == "__main__":
    unittest.main()
