# Ultravisor File Stream

`ultravisor-file-stream` is the canonical set of file-streaming primitives shared between the Ultravisor hub and any beacon that needs to ship multi-GB files across the mesh. Consolidating chunk semantics in one package means the hub task type and the worker handler can never drift apart: when the wire format changes, one edit covers every caller.

Zero runtime dependencies. It uses only Node's built-in `fs`, `path`, and `crypto`.

## Install

```bash
npm install ultravisor-file-stream
```

## The primitives

| Function | Purpose |
|---|---|
| [`writeChunk`](api/write-chunk.md) | Write one chunk at a byte offset; the final chunk fsyncs, sha256-verifies, and atomically renames into place |
| [`readChunk`](api/read-chunk.md) | Read one chunk from a file at an offset, returning the bytes in any encoding |
| [`sha256OfFile`](api/sha256-of-file.md) | Stream a whole file through sha256 and return the lowercase hex digest |
| [`hashDirectoryTree`](api/hash-directory-tree.md) | Deterministic hash of a directory tree plus a per-file manifest, for runtime-drift detection |
| [`buildChunksForFile`](api/build-chunks-for-file.md) | Read a file and synthesize the complete, ready-to-send chunk sequence |

`DEFAULT_CHUNK_BYTES` (4 MB) is also exported as the default chunk size.

## A first taste

```js
const libStream = require('ultravisor-file-stream');

// Sender: turn a file into transport-ready chunks.
let tmpChunks = libStream.buildChunksForFile('/data/backup.tar', { ChunkBytes: 4 * 1024 * 1024 });

// Receiver: apply each chunk. The final one verifies + finalizes.
for (let tmpChunk of tmpChunks)
{
	let tmpResult = libStream.writeChunk({ TargetPath: '/restore/backup.tar', ...tmpChunk });
	if (tmpResult.Status !== 'Success') { throw new Error(tmpResult.Error); }
}
```

## Where it fits

The Ultravisor hub exposes file-transfer task types, and beacon workers run the matching handlers. Both `require('ultravisor-file-stream')` and call the same `writeChunk` / `readChunk`, so a chunk written by the hub and a chunk produced by a worker obey identical rules. See [How It Works](architecture.md) for the finalize, idempotency, and verification semantics, or jump straight to the [Quick Start](quickstart.md).

## License

MIT - Steven Velozo
