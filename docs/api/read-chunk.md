# readChunk

```js
let tmpResult = libStream.readChunk(pSettings);
```

Read one chunk from a file at a given byte offset, returning the bytes in the requested encoding. This is the complement of [`writeChunk`](write-chunk.md): the hub or a beacon uses it to produce chunk payloads for a transport. Walk a whole file by starting at `Offset: 0` and passing the returned `NextOffset` on each subsequent call until `IsComplete` is true.

## Settings

| Property | Type | Default | Description |
|---|---|---|---|
| `SourcePath` | string | (required) | Absolute or relative path to read. Returns an `Error` status if omitted. |
| `Offset` | number | `0` | Byte offset to start reading from. |
| `MaxBytes` | number | `DEFAULT_CHUNK_BYTES` (4 MB) | Maximum bytes to read in this call. The actual read is `min(MaxBytes, bytesRemaining)`. |
| `Encoding` | string | `'base64'` | Output encoding for `Content` (`'base64'`, `'utf8'`, or any Node encoding). |

## Returns

```js
{
	Status: 'Success' | 'Error',
	Error?: string,
	Result?: {
		SourcePath,        // resolved absolute path
		Content,           // the chunk bytes in the requested encoding
		ContentEncoding,   // echoes the Encoding used
		Offset,            // the offset this chunk started at
		BytesRead,         // bytes actually read this call
		NextOffset,        // Offset + BytesRead; pass this on the next call
		IsComplete,        // true when NextOffset >= TotalFileSize
		TotalFileSize      // total size of the source file in bytes
	}
}
```

When the requested `Offset` is at or past the end of the file, the call succeeds with `BytesRead: 0`, `Content: ''`, and `IsComplete: true`.

## Example

Read a file to completion, one 1 MB chunk at a time:

```js
const libStream = require('ultravisor-file-stream');

let tmpOffset = 0;
while (true)
{
	let tmpRead = libStream.readChunk({
		SourcePath: '/outbox/archive.tar',
		Offset: tmpOffset,
		MaxBytes: 1024 * 1024,
		Encoding: 'base64'
	});
	if (tmpRead.Status !== 'Success') { throw new Error(tmpRead.Error); }

	transmit(tmpRead.Result.Content);   // your transport

	if (tmpRead.Result.IsComplete) { break; }
	tmpOffset = tmpRead.Result.NextOffset;
}
```

## See also

- [`writeChunk`](write-chunk.md) - apply a chunk on the receiving side.
- [`buildChunksForFile`](build-chunks-for-file.md) - read the whole file at once into a ready-to-send chunk list.
