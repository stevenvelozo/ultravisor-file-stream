# ultravisor-file-stream

> **[Read the ultravisor-file-stream Documentation](https://stevenvelozo.github.io/ultravisor-file-stream/)**

File-streaming primitives shared between the ultravisor hub and any
beacon that needs to ship multi-GB files across the mesh. Zero runtime
deps - just Node's built-in `fs`, `path`, and `crypto`.

## Install

```bash
npm install ultravisor-file-stream
```

## Use

```js
const libStream = require('ultravisor-file-stream');

// Write one chunk at an offset; IsFinal=true triggers sha256 verify + atomic rename.
let result = libStream.writeChunk({
	TargetPath: '/path/to/out.bin',
	Content: base64Encoded,
	ContentEncoding: 'base64',
	Offset: 0,
	IsFinal: true,
	Sha256: 'abc123...'
});

// Read one chunk from a file; returns base64 by default.
let chunk = libStream.readChunk({
	SourcePath: '/path/to/in.bin',
	Offset: 0,
	MaxBytes: 4 * 1024 * 1024
});

// Full-file sha256.
let hash = libStream.sha256OfFile('/path/to/in.bin');

// Deterministic hash of a directory tree - used for runtime-drift detection.
let scan = libStream.hashDirectoryTree('/some/dir', new Set(['node_modules']));
//   -> { Hash, FileCount, TotalBytes, Files: [{RelativePath, Size, Sha256}] }

// Convenience: synthesize the full chunk sequence for a file, ready to send.
let chunks = libStream.buildChunksForFile('/some/big/file.bin', {
	ChunkBytes: 4 * 1024 * 1024,
	RelativePath: 'relative/path/in/protocol.bin'
});
```

## Semantics

- **writeChunk** writes to `<TargetPath>.part`; the final chunk (`IsFinal=true`)
  fsyncs, optionally sha256-verifies, and atomically renames `.part` ->
  `TargetPath`. Idempotent and order-independent - the same
  `{TargetPath, Offset, Content}` is safe to re-issue, and chunks may
  arrive in any order.
- **Sha256 mismatch** deletes the `.part` file (forcing the sender to
  restart cleanly) and returns `Status: 'Sha256Mismatch'`.
- **Windows** rename-onto-existing-target is handled via unlink-then-rename.
- **hashDirectoryTree** skips dotfiles and any basename in the ignore
  set; output is stable across re-scans so the hash can be compared
  across machines.

## License

MIT - Steven Velozo
