from pathlib import Path
import unittest

from rag.documents import (
    DocumentValidationError,
    load_policy,
    split_passages,
    split_passages_detailed,
)


class PolicyDocumentTests(unittest.TestCase):
    def test_fixture_versions_have_stable_identity_and_distinct_hashes(self) -> None:
        v1 = load_policy("data/policies/RETURNS-v1.md")
        v2 = load_policy("data/policies/RETURNS-v2.md")

        self.assertEqual((v1.document_id, v1.version), ("RETURNS", 1))
        self.assertEqual((v2.document_id, v2.version), ("RETURNS", 2))
        self.assertNotEqual(v1.source_sha256, v2.source_sha256)
        self.assertIn("30 days", v1.body)
        self.assertIn("14 days", v2.body)

    def test_source_outside_policy_directory_is_rejected(self) -> None:
        with self.assertRaises(DocumentValidationError):
            load_policy(Path("README.md"))

    def test_chunking_is_deterministic_and_respects_maximum_size(self) -> None:
        body = "\n\n".join(["policy paragraph " + ("x " * 430), "second paragraph"])
        first = split_passages(body, max_chars=400)
        second = split_passages(body, max_chars=400)

        self.assertEqual(first, second)
        self.assertGreater(len(first), 1)
        self.assertTrue(all(0 < len(passage) <= 400 for passage in first))

    def test_detailed_split_preserves_text_and_reports_real_overlap(self) -> None:
        body = "paragraph " + ("word " * 260)
        detailed = split_passages_detailed(body, max_chars=400)

        self.assertEqual([part.text for part in detailed], split_passages(body, max_chars=400))
        self.assertEqual(detailed[0].overlap_with_previous, 0)
        self.assertGreater(detailed[1].overlap_with_previous, 0)
        self.assertEqual(detailed[0].paragraph_indexes, (0,))


if __name__ == "__main__":
    unittest.main()
