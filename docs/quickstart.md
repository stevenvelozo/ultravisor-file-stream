# Quick Start

This walkthrough ships a file end to end: synthesize chunks from a source, apply them to a destination with a verified finalize, then read a file back chunk by chunk. Everything runs on Node's built-ins, so there is nothing to configure.

```bash
npm install ultravisor-file-stream
```

## 1. Send a file as chunks

`buildChunksForFile` reads a file once and returns the full list of chunk payloads. Each entry is shaped exactly the way `writeChunk` expects, and the final chunk carries the whole-file `Sha256` so the receiver can verify without re-hashing the source.

```js
const libStream = require('ultravisor-file-stream');

let tmpChunks = libStream.buildChunksForFile('/data/report.bin', {
	ChunkBytes: 4 * 1024 * 1024,
	RelativePath: 'reports/report.bin'
});
// tmpChunks -> [ { Content, ContentEncoding: 'base64', Offset, ChunkIndex,
//                  TotalChunks, IsFinal, Sha256? , RelativePath? }, ... ]
```

## 2. Apply the chunks at the destination

Feed each chunk to `writeChunk` with the destination `TargetPath`. Writes land in `<TargetPath>.part`; the final chunk (`IsFinal: true`) fsyncs, sha256-verifies, and atomically renames the `.part` file into place.

```js
for (let tmpChunk of tmpChunks)
{
	let tmpResult = libStream.writeChunk({ TargetPath: '/inbox/report.bin', ...tmpChunk });

	if (tmpResult.Status === 'Sha256Mismatch')
	{
		// The .part file was deleted; restart the whole transfer.
		throw new Error('Transfer corrupted: ' + tmpResult.Error);
	}
	if (tmpResult.Status !== 'Success')
	{
		throw new Error(tmpResult.Error);
	}
}
// The final result has Result.IsComplete === true and Result.Sha256Verified === true.
```

Chunks are idempotent and order-independent: re-issuing the same `{ TargetPath, Offset, Content }` is safe, and chunks may arrive in any order. See [How It Works](architecture.md).

## 3. Read a file back, chunk by chunk

`readChunk` is the inverse. Start at `Offset: 0`, then pass the returned `NextOffset` on each subsequent call until `IsComplete` is true.

```js
let tmpOffset = 0;
while (true)
{
	let tmpRead = libStream.readChunk({
		SourcePath: '/inbox/report.bin',
		Offset: tmpOffset,
		MaxBytes: 4 * 1024 * 1024,
		Encoding: 'base64'
	});
	if (tmpRead.Status !== 'Success') { throw new Error(tmpRead.Error); }

	send(tmpRead.Result.Content);          // your transport
	if (tmpRead.Result.IsComplete) { break; }
	tmpOffset = tmpRead.Result.NextOffset;
}
```

## 4. Verify and detect drift

Hash a single file, or hash an entire directory tree to compare runtimes across machines.

```js
// Whole-file digest.
let tmpHash = libStream.sha256OfFile('/inbox/report.bin');

// Deterministic tree hash + per-file manifest, ignoring node_modules.
let tmpScan = libStream.hashDirectoryTree('/srv/app', new Set([ 'node_modules' ]));
// tmpScan -> { Hash, FileCount, TotalBytes, Files: [ { RelativePath, Size, Sha256 } ] }
```

Two runtimes with the same `Hash` hold byte-identical, identically-named files. This is how the hub and a worker confirm they are running the same code before a job. Next: the full [API Reference](api/README.md).
