# How It Works

The whole package exists to make one operation safe and repeatable: moving a large file across an unreliable link, in pieces, with a guarantee that the destination is either the complete, correct file or nothing at all.

## The transfer lifecycle

A transfer is a sequence of `writeChunk` calls against a single `TargetPath`.

1. Every chunk is written into a sidecar file, `<TargetPath>.part`, seeked to the chunk's `Offset`. The partial file grows as chunks land.
2. The final chunk is flagged `IsFinal: true`. On that call the package fsyncs the `.part` file to disk, optionally verifies its sha256, and then atomically renames `.part` into the real `TargetPath`.

Until the final rename, the destination path does not exist. A reader never sees a half-written file: it sees nothing, then the whole thing.

```
chunk 0  ->  out.bin.part   [.....          ]
chunk 1  ->  out.bin.part   [..........     ]
chunk 2  ->  out.bin.part   [...............]   IsFinal: fsync + verify + rename
                 |
                 v
              out.bin       (appears atomically, complete + verified)
```

## Idempotent and order-independent

Because each write seeks to an explicit `Offset`, chunks carry their own position. That has two consequences worth relying on:

- **Re-issuing a chunk is safe.** The same `{ TargetPath, Offset, Content }` written twice produces the same bytes at the same place. A transport that retries on timeout cannot corrupt the file.
- **Order does not matter.** Chunk 5 may arrive before chunk 2. Each lands at its offset; the file is correct once every byte range has been written and the final chunk finalizes.

This is what lets a transport be simple: at-least-once delivery in any order is enough.

## Verification and failure

When the final chunk carries a `Sha256` (the hex digest of the complete file), the finalize step re-hashes the assembled `.part` file and compares.

- **Match** - the file is fsynced, renamed, and the result reports `Sha256Verified: true`.
- **Mismatch** - the `.part` file is deleted and the call returns `Status: 'Sha256Mismatch'`. Deleting the partial forces the sender to restart cleanly rather than leaving corrupt bytes that a later retry might mistake for valid.

`buildChunksForFile` sets the final chunk's `Sha256` automatically, so a receiver verifies for free.

## Cross-platform finalize

The atomic rename is `fs.renameSync`. On POSIX this replaces an existing target in one step. Windows refuses to rename onto an existing file, so the package detects that case, unlinks the existing target, and renames again. Callers do not need to special-case the platform.

## Directory-tree hashing

`hashDirectoryTree` answers a different question: are two runtimes holding the same files? It walks a directory, hashes every file, sorts the results by relative path, and folds the `(relative-path, sha256)` pairs into a single tree hash. The output is stable across machines and across re-scans, so the hub and a worker can compare one short hash to confirm they are running byte-identical code before a job starts. Hidden files (those beginning with `.`) and any basename in the ignore set are skipped.

## Why it lives in one package

The Ultravisor hub defines file-transfer task types; beacon workers run the matching handlers. If chunk semantics lived in two places they would eventually disagree on an edge case, and a transfer that worked hub-to-worker would fail worker-to-hub. Keeping `writeChunk`, `readChunk`, and the hashing helpers in a single zero-dependency module means there is exactly one definition of correct, and a wire-format change is a single edit that every caller inherits.

Continue to the [API Reference](api/README.md).
