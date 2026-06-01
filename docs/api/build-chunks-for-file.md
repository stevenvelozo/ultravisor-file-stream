# buildChunksForFile

```js
let tmpChunks = libStream.buildChunksForFile(pPath, pOptions);
```

Read a whole file and synthesize the complete list of chunk payloads, ready to hand straight to [`writeChunk`](write-chunk.md) on the receiving side. The final chunk gets its `Sha256` set automatically, so a receiver verifies the assembled file without re-hashing the source.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `pPath` | string | (required) | Path to the file to chunk. |
| `pOptions.ChunkBytes` | number | `DEFAULT_CHUNK_BYTES` (4 MB) | Size of each chunk. |
| `pOptions.RelativePath` | string | (none) | Optional label carried on every chunk, for transports that want a destination-relative path. Write tasks do not require it. |

## Returns

`Array` of chunk objects, each shaped for `writeChunk`:

```js
{
	Content,                   // base64-encoded chunk bytes
	ContentEncoding: 'base64',
	Offset,                    // byte offset of this chunk
	ChunkIndex,                // 0-based index
	TotalChunks,               // total chunk count
	IsFinal,                   // true on the last chunk
	Sha256,                    // whole-file digest on the final chunk; '' otherwise
	RelativePath?              // present only when the option was supplied
}
```

An empty file still yields one chunk (an empty final chunk), so receivers always get a finalize signal.

## Memory note

`buildChunksForFile` reads the entire file into memory once. That is appropriate for files up to roughly 1 GB. For larger files, drive the transfer with [`readChunk`](read-chunk.md) in a loop instead, which never holds more than one chunk at a time.

## Example

```js
const libStream = require('ultravisor-file-stream');

let tmpChunks = libStream.buildChunksForFile('/data/backup.tar', {
	ChunkBytes: 8 * 1024 * 1024,
	RelativePath: 'backups/backup.tar'
});

// Hand each chunk to the receiver; the last one finalizes + verifies.
for (let tmpChunk of tmpChunks)
{
	let tmpResult = libStream.writeChunk({ TargetPath: '/restore/backup.tar', ...tmpChunk });
	if (tmpResult.Status !== 'Success') { throw new Error(tmpResult.Error); }
}
```

## See also

- [`writeChunk`](write-chunk.md) - consumes these chunks.
- [`readChunk`](read-chunk.md) - the streaming alternative for very large files.
