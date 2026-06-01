# sha256OfFile

```js
let tmpHex = libStream.sha256OfFile(pPath);
```

Stream a whole file through sha256 and return the lowercase hex digest. The file is read in 1 MB blocks, so memory stays flat regardless of file size, which makes it safe for the multi-GB files this package exists to move.

## Parameters

| Parameter | Type | Description |
|---|---|---|
| `pPath` | string | Path to the file to hash. |

## Returns

`string` - the lowercase hex sha256 digest of the file's bytes.

Throws if the file cannot be opened or read (this helper returns its value directly rather than a status envelope).

## Example

```js
const libStream = require('ultravisor-file-stream');

let tmpHex = libStream.sha256OfFile('/inbox/report.bin');
// -> 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
```

This is the same digest [`writeChunk`](write-chunk.md) computes when it verifies a finalized file, and the value [`buildChunksForFile`](build-chunks-for-file.md) stamps onto the final chunk. Computing it independently lets a caller confirm a received file matches the sender's `Sha256` out of band.

## See also

- [`hashDirectoryTree`](hash-directory-tree.md) - the directory-level equivalent.
