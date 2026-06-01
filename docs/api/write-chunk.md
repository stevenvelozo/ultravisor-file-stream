# writeChunk

```js
let tmpResult = libStream.writeChunk(pSettings);
```

Write one chunk of a large file at a given byte offset. Writes land in `<TargetPath>.part`. On the final chunk (`IsFinal: true`) the function fsyncs the partial file, optionally sha256-verifies it, then atomically renames `<TargetPath>.part` into `<TargetPath>`.

Idempotent and order-independent: the same `{ TargetPath, Offset, Content }` is safe to re-issue, and chunks may arrive in any order (the `.part` file is seeked to `Offset` for each write). See [How It Works](../architecture.md).

## Settings

| Property | Type | Default | Description |
|---|---|---|---|
| `TargetPath` | string | (required) | Absolute or relative final path. Returns an `Error` status if omitted. |
| `Content` | string \| Buffer | `''` | The chunk bytes. A `Buffer` is written as-is; a string is decoded with `ContentEncoding`. |
| `ContentEncoding` | string | `'base64'` | Encoding used to decode a string `Content` (`'base64'`, `'utf8'`, or any Node encoding). Ignored when `Content` is a Buffer. |
| `Offset` | number | `0` | Byte offset of this chunk within the final file. |
| `ChunkIndex` | number | `0` | Informational; echoed back in the result. |
| `TotalChunks` | number | `0` | Informational; echoed back in the result. |
| `IsFinal` | boolean | `false` | When true, finalize on this chunk (fsync, optional verify, atomic rename). |
| `Sha256` | string | (none) | Hex sha256 of the complete file. When present on the final chunk, the assembled file is verified before the rename. |
| `CreateDirectory` | boolean | `true` | Create the target directory tree if it does not exist. |

## Returns

```js
{
	Status: 'Success' | 'Sha256Mismatch' | 'Error',
	Error?: string,
	Result?: {
		TargetPath,         // resolved absolute path
		PartialFilePath,    // the .part path (equals TargetPath once complete)
		BytesWritten,       // bytes written by this call
		TotalBytesOnDisk,   // size of the file on disk after this call
		IsComplete,         // true only after a successful finalize
		Sha256Verified,     // true when a Sha256 was supplied and matched
		ChunkIndex,
		TotalChunks
	}
}
```

- **`Status: 'Success'`** - the chunk was written. On a non-final chunk, `IsComplete` is `false`. On the final chunk, `IsComplete` is `true` and `PartialFilePath` equals `TargetPath`.
- **`Status: 'Sha256Mismatch'`** - the final-chunk verify failed. The `.part` file has been deleted so the sender can restart cleanly; `Error` reports the expected and computed digests.
- **`Status: 'Error'`** - `TargetPath` was missing or an I/O error occurred; see `Error`.

## Examples

Stream a buffer in two chunks, finalizing with verification:

```js
const libStream = require('ultravisor-file-stream');

libStream.writeChunk({
	TargetPath: '/inbox/data.bin',
	Content: tmpFirstHalf,           // base64 string
	Offset: 0,
	IsFinal: false
});

let tmpResult = libStream.writeChunk({
	TargetPath: '/inbox/data.bin',
	Content: tmpSecondHalf,
	Offset: tmpFirstHalfByteLength,
	IsFinal: true,
	Sha256: tmpWholeFileSha256
});

if (tmpResult.Status === 'Success' && tmpResult.Result.Sha256Verified)
{
	// /inbox/data.bin now exists, complete and verified.
}
```

Write a raw Buffer (no decoding):

```js
libStream.writeChunk({
	TargetPath: '/inbox/data.bin',
	Content: Buffer.from([ 0x00, 0x01, 0x02 ]),
	Offset: 0,
	IsFinal: true
});
```

## See also

- [`buildChunksForFile`](build-chunks-for-file.md) - produce the chunk sequence this function consumes.
- [`readChunk`](read-chunk.md) - the inverse operation.
