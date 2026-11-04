# Learn-X Reading Data Contract

## Batch input

`store-reading.mjs` accepts one JSON object:

```json
{
  "batchId": "stable-batch-id",
  "collectedAt": "2026-11-03T08:30:00+08:00",
  "source": "weread",
  "book": {
    "title": "书名",
    "author": "作者",
    "bookId": "weread-book-id",
    "edition": "版本或 ISBN（可空）"
  },
  "entries": [
    {
      "sourceId": "weread-bookmark:book-id:bookmark-id",
      "sourceEvidence": { "text": "采集器返回的对应标记文本", "range": "定位范围", "chapterUid": "chapter-id", "createTime": 1793672100 },
      "location": "第三章 / 小节标题",
      "date": "2026-11-03",
      "kind": "划线",
      "authorContent": "基于来源的简洁转述；纯用户想法记录可省略",
      "foundations": ["支撑该命题的思想基石"],
      "questions": ["确有价值的问题或反例"],
      "aiInference": "AI 推断，不代表用户认可",
      "userThought": "仅填写用户明确表达的内容",
      "status": "ready",
      "visibility": "public",
      "confidence": 0.92
    }
  ]
}
```

The store currently accepts only `source: "weread"`. Physical-book photos, OCR and mark identification are deferred by the user; do not pass physical material to this contract or imply it is supported. Images and image paths are never stored here.

## Identity and retry rules

- The source record key is `source + SHA-256(identity)`. WeRead requires the collector-provided source ID; do not synthesize one from visible content.
- A ready entry must contain source-grounded author content, an explicitly attributed user thought, or both. Do not invent author content for a thought-only WeRead review.
- Every entry must pass the collector's private `sourceEvidence`; the store hashes a stable key-sorted representation into `sourceFingerprint` and discards the raw evidence from persisted record state. The inbox and latest collector snapshot remain private under `.runtime/reading/`.
- Repeated source IDs within one batch are folded only when their normalized content agrees; conflicting content for one source identity fails the batch instead of choosing arbitrarily. On a later batch, an existing record is a duplicate when its raw-source fingerprint matches, so prior user edits are preserved; a changed fingerprint fails closed.
- Book grouping uses normalized title, author, WeRead book ID and edition. Resolve same-title editions before writing if metadata is ambiguous.
- A pending retry must match the preserved source identities, normalized content and companion pack, using the same `batchId`.
- `.runtime/reading/state.json`, pending batches and receipts are private (directory 0700, files 0600). The public Markdown contains only entries marked public and ready.
- Runtime and public output paths must remain beneath the Learn-X root; reject symlinks in their path components before reading or writing.
- Store uses one private state lock, a durable pending intent, atomic file replacement, hashes for managed-file conflict detection and immediate readback. A pending batch is retained on failure; retry it before starting another write.
- `05_library/reading/_index.md` is rebuilt from the private state’s public book list. It is a book locator, not a separate knowledge database.

## Public Markdown

Each public entry contains a stable record ID, reliable location and source date, plus source-grounded author-content paraphrase and/or explicitly attributed user thought. Include relevant foundations, optional questions and clearly labeled AI inference when supported. Do not publish image bytes, source image paths, secrets, private entries or long copyrighted excerpts.
