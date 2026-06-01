# hashDirectoryTree

```js
let tmpScan = libStream.hashDirectoryTree(pDir, pIgnoreBasenames);
```

Compute a deterministic hash of a directory tree, along with a per-file manifest. The package walks the tree, hashes every file, sorts the results by relative path, and folds the sorted `(relative-path, sha256)` pairs into one sha256. Because the output is stable across machines and re-scans, two runtimes that produce the same `Hash` are holding byte-identical, identically-named files - which is how the Ultravisor hub and a worker detect runtime drift before a job.

## Parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `pDir` | string | (required) | Root directory to walk. If it does not exist, the result is an empty tree (`Hash: ''`, `FileCount: 0`). |
| `pIgnoreBasenames` | Set | empty Set | Basenames to skip anywhere in the tree (for example `new Set([ 'node_modules', '.git' ])`). |

Files whose name begins with `.` are always skipped, in addition to anything in the ignore set.

## Returns

```js
{
	Hash,        // lowercase hex sha256 of the whole tree
	FileCount,   // number of files included
	TotalBytes,  // sum of included file sizes
	Files: [     // sorted by RelativePath
		{ RelativePath, Size, Sha256 }
	]
}
```

`RelativePath` always uses forward slashes, so a manifest produced on Windows compares cleanly against one produced on Linux.

## Example

```js
const libStream = require('ultravisor-file-stream');

let tmpScan = libStream.hashDirectoryTree('/srv/worker-app', new Set([ 'node_modules', '.git' ]));

console.log(tmpScan.Hash);       // '9f2c...'
console.log(tmpScan.FileCount);  // 142
console.log(tmpScan.Files[0]);   // { RelativePath: 'package.json', Size: 812, Sha256: '...' }

// Compare against the hub's expected hash before running a job.
if (tmpScan.Hash !== tmpExpectedRuntimeHash)
{
	throw new Error('Runtime drift detected - worker code does not match the hub.');
}
```

## See also

- [`sha256OfFile`](sha256-of-file.md) - the single-file digest used per entry.
