# API Reference

`ultravisor-file-stream` exports five functions and one constant. Every function is synchronous and returns plain objects, so callers can use them from a task type, a worker handler, or a script without any setup.

```js
const libStream = require('ultravisor-file-stream');
```

## Functions

| Function | Summary |
|---|---|
| [`writeChunk(pSettings)`](write-chunk.md) | Write one chunk at a byte offset; finalize (fsync + sha256 verify + atomic rename) on the last chunk. |
| [`readChunk(pSettings)`](read-chunk.md) | Read one chunk from a file at an offset, returning the bytes in the requested encoding. |
| [`sha256OfFile(pPath)`](sha256-of-file.md) | Stream a file through sha256 and return the lowercase hex digest. |
| [`hashDirectoryTree(pDir, pIgnoreBasenames)`](hash-directory-tree.md) | Deterministic hash of a directory tree plus a per-file manifest. |
| [`buildChunksForFile(pPath, pOptions)`](build-chunks-for-file.md) | Read a file and synthesize the full chunk sequence, ready for `writeChunk`. |

## Constant

| Name | Value | Meaning |
|---|---|---|
| `DEFAULT_CHUNK_BYTES` | `4 * 1024 * 1024` (4 MB) | Default chunk size used by `readChunk` and `buildChunksForFile` when no size is given. |

## Result convention

The two transfer functions, `writeChunk` and `readChunk`, return a status envelope:

```js
{
	Status: 'Success' | 'Sha256Mismatch' | 'Error',
	Error?: string,    // present when Status is not 'Success'
	Result?: object    // the payload, present on success (and on Sha256Mismatch)
}
```

Always branch on `Status` before reading `Result`. The helpers `sha256OfFile`, `hashDirectoryTree`, and `buildChunksForFile` return their values directly (a string, an object, and an array respectively) and throw on unexpected I/O errors.
