# RAG document update: use cases

## The setting

Northstar Devices has an internal assistant for staff policy questions. These are fictional documents and users. The assistant must answer from the current document version, cite its source, and use only passages the signed-in user can currently read.

This file defines the small test workload. It is a target for the build, not a record of passing tests.

## Starting fixtures

| ID | Document | Starting content | Readers |
| --- | --- | --- | --- |
| `RETURNS` v1 | Returns policy | Standard returns are accepted within **30 days** of delivery. | Support, Finance |
| `WARRANTY` v1 | Warranty policy | Devices have a **12-month** warranty. | Support, Finance |
| `REBATES` v1 | Partner rebates | Partner Alpha receives a **7%** rebate. | Finance only |

Users: `sam` has the Support role; `fin` has the Finance role. The application supplies their verified identity and current roles to retrieval. A role or document ID written in a question does not grant access.

## Use cases to run in order

| # | Action and question | Expected result |
| --- | --- | --- |
| 1 | As `sam`, ask: “How long do customers have to return a device?” | Answer **30 days**; cite `RETURNS` v1. |
| 2 | As `sam`, ask: “What rebate does Partner Alpha receive?” | Do not reveal the rate or pass `REBATES` to the model; say no accessible source supports an answer. |
| 3 | As `fin`, ask the same rebate question. | Answer **7%**; cite `REBATES` v1. |
| 4 | Submit `RETURNS` v2 with a **14-day** window. Ask the returns question while v2 indexing is incomplete, then after it becomes active. | During the gap, do not answer from v1; say the current policy cannot be confirmed. After activation, answer **14 days** and cite v2. |
| 5 | Deliver the `RETURNS` v2 ingestion event twice. Ask the returns question again. | One active v2; the answer and citation stay the same. No duplicate active chunks. |
| 6 | Revoke `fin`’s Finance role, then ask the rebate question as `fin`. | No rebate passage reaches the model, even if its vector remains indexed. No rate appears in the answer or citation. |
| 7 | Delete `WARRANTY`, then ask as `sam`: “How long is the warranty?” | Do not use the deleted passage; say no current accessible source supports an answer. |
| 8 | Submit `RETURNS` v3 with a **21-day** window and make embedding fail once. Ask during the failure, retry ingestion, then ask again. | During failure, do not serve v2 as current. After retry and activation, answer **21 days**, cite v3, and keep one active version. |

## Evidence to capture

- For each question: user, active source version, retrieved passage IDs, answer, citations, and whether the expected result passed.
- For each ingestion: document ID, version, processing state, retry count, and time from submission to activation.
- Summary: stale-answer count, restricted-passage exposure count, citation correctness, and response latency for this fixed workload.

The permission check must happen before passages reach generation. Deletion and revocation must affect retrieval immediately in these tests, even if old vectors remain stored for cleanup. This workload does not establish general security or production performance.
