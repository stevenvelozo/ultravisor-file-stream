/**
 * ultravisor-file-stream
 *
 * Canonical file-streaming primitives shared between the ultravisor hub
 * and any beacon client that needs to ship multi-GB files across the
 * mesh. Zero runtime dependencies — just Node's built-in `fs`, `path`,
 * and `crypto`.
 *
 * Exports:
 *   - writeChunk(settings)          chunk-at-offset write with optional
 *                                    sha256 verify + atomic rename
 *   - readChunk(settings)           read one chunk from a file at offset
 *   - sha256OfFile(path)            full-file sha256 hex
 *   - hashDirectoryTree(dir, ignore) deterministic dir-contents hash +
 *                                    per-file manifest, used for
 *                                    runtime-drift detection
 *   - buildChunksForFile(path, ...) convenience: read file + synthesize
 *                                    ready-to-send chunk payloads for a
 *                                    transport
 *   - DEFAULT_CHUNK_BYTES           4 MB
 *
 * Usage from ultravisor hub (task type):
 *     const libStream = require('ultravisor-file-stream');
 *     let result = libStream.writeChunk({ TargetPath: ..., Content: ..., ... });
 *
 * Usage from a beacon worker (LWM handler):
 *     const libStream = require('ultravisor-file-stream');
 *     let result = libStream.writeChunk(...);  // same API
 *
 * Consolidating here means the hub task type + the worker handler can
 * never diverge on chunk semantics. When we bump the wire format, one
 * edit in one package covers everyone.
 *
 * @author Steven Velozo <steven@velozo.com>
 */

const libFs = require('fs');
const libPath = require('path');
const libCrypto = require('crypto');

const DEFAULT_CHUNK_BYTES = 4 * 1024 * 1024;  // 4 MB

// ── writeChunk ─────────────────────────────────────────────────────

/**
 * Write one chunk of a large file at a given byte offset. On the final
 * chunk (IsFinal=true) the function fsyncs, optionally sha256-verifies
 * the completed file, then atomically renames <TargetPath>.part →
 * <TargetPath>.
 *
 * Idempotent on retry: the same {TargetPath, Offset, Content, ChunkIndex}
 * is safe to re-issue. Out-of-order delivery is supported (chunks may
 * arrive in any order — the .part file is seeked to Offset for each
 * write).
 *
 * @param {object} pSettings
 *   @property {string}  TargetPath       absolute or relative final path
 *   @property {string}  Content          chunk bytes (usually base64)
 *   @property {string}  [ContentEncoding='base64']  'base64' | 'utf8' |
 *                                        any Node-recognized encoding.
 *                                        Or pass a Buffer as Content to
 *                                        bypass decoding.
 *   @property {number}  Offset           byte offset in the final file
 *   @property {number}  [ChunkIndex=0]   informational
 *   @property {number}  [TotalChunks=0]  informational
 *   @property {boolean} [IsFinal=false]  finalize on this chunk
 *   @property {string}  [Sha256]         hex sha256 of the full file to
 *                                        verify on final chunk
 *   @property {boolean} [CreateDirectory=true]
 *
 * @returns {object}
 *   { Status: 'Success' | 'Sha256Mismatch' | 'Error',
 *     Error?: string,
 *     Result?: { TargetPath, PartialFilePath, BytesWritten,
 *                TotalBytesOnDisk, IsComplete, Sha256Verified,
 *                ChunkIndex, TotalChunks? } }
 */
function writeChunk(pSettings)
{
	let tmpTargetLocation = pSettings.TargetPath || '';
	let tmpContent = pSettings.Content;
	let tmpContentEncoding = pSettings.ContentEncoding || 'base64';
	let tmpOffset = parseInt(pSettings.Offset, 10) || 0;
	let tmpChunkIndex = parseInt(pSettings.ChunkIndex, 10) || 0;
	let tmpTotalChunks = parseInt(pSettings.TotalChunks, 10) || 0;
	let tmpIsFinal = !!pSettings.IsFinal;
	let tmpSha256 = (pSettings.Sha256 || '').toLowerCase();
	let tmpCreateDir = (pSettings.CreateDirectory !== false);

	if (!tmpTargetLocation)
	{
		return { Status: 'Error', Error: 'ultravisor-file-stream.writeChunk: TargetPath required.' };
	}

	if (tmpContent === undefined || tmpContent === null)
	{
		tmpContent = '';
	}

	let tmpTargetPath = libPath.resolve(tmpTargetLocation);
	let tmpPartPath = tmpTargetPath + '.part';

	try
	{
		let tmpBuffer;
		if (Buffer.isBuffer(tmpContent))
		{
			tmpBuffer = tmpContent;
		}
		else
		{
			tmpBuffer = Buffer.from(tmpContent, tmpContentEncoding);
		}

		let tmpBytesWritten = tmpBuffer.length;

		if (tmpCreateDir)
		{
			let tmpDir = libPath.dirname(tmpPartPath);
			if (!libFs.existsSync(tmpDir))
			{
				libFs.mkdirSync(tmpDir, { recursive: true });
			}
		}

		let tmpFlag = libFs.existsSync(tmpPartPath) ? 'r+' : 'w+';
		let tmpFd = libFs.openSync(tmpPartPath, tmpFlag);
		try
		{
			if (tmpBytesWritten > 0)
			{
				libFs.writeSync(tmpFd, tmpBuffer, 0, tmpBytesWritten, tmpOffset);
			}
		}
		finally
		{
			libFs.closeSync(tmpFd);
		}

		let tmpTotalOnDisk = libFs.statSync(tmpPartPath).size;

		if (!tmpIsFinal)
		{
			return {
				Status: 'Success',
				Result:
				{
					TargetPath: tmpTargetPath,
					PartialFilePath: tmpPartPath,
					BytesWritten: tmpBytesWritten,
					TotalBytesOnDisk: tmpTotalOnDisk,
					IsComplete: false,
					Sha256Verified: false,
					ChunkIndex: tmpChunkIndex,
					TotalChunks: tmpTotalChunks
				}
			};
		}

		// Final chunk: fsync, optional verify, atomic rename.
		let tmpFsyncFd = libFs.openSync(tmpPartPath, 'r+');
		try { libFs.fsyncSync(tmpFsyncFd); }
		finally { libFs.closeSync(tmpFsyncFd); }

		let tmpSha256Verified = false;
		if (tmpSha256)
		{
			let tmpComputed = sha256OfFile(tmpPartPath);
			if (tmpComputed !== tmpSha256)
			{
				try { libFs.unlinkSync(tmpPartPath); } catch (pIgnore) {}
				return {
					Status: 'Sha256Mismatch',
					Error: `Sha256 mismatch: expected=${tmpSha256} got=${tmpComputed}. .part deleted; retry the full transfer.`,
					Result:
					{
						TargetPath: tmpTargetPath,
						PartialFilePath: tmpPartPath,
						BytesWritten: tmpBytesWritten,
						TotalBytesOnDisk: tmpTotalOnDisk,
						IsComplete: false,
						Sha256Verified: false,
						ChunkIndex: tmpChunkIndex
					}
				};
			}
			tmpSha256Verified = true;
		}

		// Atomic rename — Windows cannot rename onto existing target.
		try
		{
			libFs.renameSync(tmpPartPath, tmpTargetPath);
		}
		catch (pRenameErr)
		{
			if (libFs.existsSync(tmpTargetPath))
			{
				try { libFs.unlinkSync(tmpTargetPath); }
				catch (pUnlinkErr)
				{
					return {
						Status: 'Error',
						Error: `Rename failed (${pRenameErr.message}) and target exists but could not be removed (${pUnlinkErr.message}).`
					};
				}
				libFs.renameSync(tmpPartPath, tmpTargetPath);
			}
			else
			{
				throw pRenameErr;
			}
		}

		let tmpFinalSize = libFs.statSync(tmpTargetPath).size;

		return {
			Status: 'Success',
			Result:
			{
				TargetPath: tmpTargetPath,
				PartialFilePath: tmpTargetPath,
				BytesWritten: tmpBytesWritten,
				TotalBytesOnDisk: tmpFinalSize,
				IsComplete: true,
				Sha256Verified: tmpSha256Verified,
				ChunkIndex: tmpChunkIndex,
				TotalChunks: tmpTotalChunks
			}
		};
	}
	catch (pError)
	{
		return {
			Status: 'Error',
			Error: `ultravisor-file-stream.writeChunk chunk ${tmpChunkIndex} @ offset ${tmpOffset}: ${pError.message}`
		};
	}
}

// ── readChunk ──────────────────────────────────────────────────────

/**
 * Read one chunk from a file at a given byte offset, returning the
 * bytes in the requested encoding. Complements writeChunk — the hub
 * or a beacon can use this to produce chunk payloads for transport.
 *
 * @param {object} pSettings
 *   @property {string} SourcePath         absolute or relative path
 *   @property {number} Offset             byte offset to start reading
 *   @property {number} [MaxBytes=DEFAULT_CHUNK_BYTES]  max to read this call
 *   @property {string} [Encoding='base64']  output encoding
 *
 * @returns {object}
 *   { Status: 'Success' | 'Error',
 *     Error?: string,
 *     Result?: { SourcePath, Content, ContentEncoding, Offset,
 *                BytesRead, NextOffset, IsComplete, TotalFileSize,
 *                Sha256? } }
 *
 * IsComplete=true when NextOffset >= TotalFileSize. When the caller
 * passes SourcePath + Offset=0 on the first call and NextOffset on
 * subsequent calls, they walk the full file.
 */
function readChunk(pSettings)
{
	let tmpSourcePath = pSettings.SourcePath || '';
	let tmpOffset = parseInt(pSettings.Offset, 10) || 0;
	let tmpMaxBytes = parseInt(pSettings.MaxBytes, 10) || DEFAULT_CHUNK_BYTES;
	let tmpEncoding = pSettings.Encoding || 'base64';

	if (!tmpSourcePath)
	{
		return { Status: 'Error', Error: 'ultravisor-file-stream.readChunk: SourcePath required.' };
	}

	let tmpResolved = libPath.resolve(tmpSourcePath);

	try
	{
		let tmpStat = libFs.statSync(tmpResolved);
		let tmpRemaining = tmpStat.size - tmpOffset;

		if (tmpRemaining <= 0)
		{
			return {
				Status: 'Success',
				Result:
				{
					SourcePath: tmpResolved,
					Content: '',
					ContentEncoding: tmpEncoding,
					Offset: tmpOffset,
					BytesRead: 0,
					NextOffset: tmpOffset,
					IsComplete: true,
					TotalFileSize: tmpStat.size
				}
			};
		}

		let tmpReadSize = Math.min(tmpMaxBytes, tmpRemaining);
		let tmpBuffer = Buffer.alloc(tmpReadSize);
		let tmpFd = libFs.openSync(tmpResolved, 'r');
		let tmpActual;
		try
		{
			tmpActual = libFs.readSync(tmpFd, tmpBuffer, 0, tmpReadSize, tmpOffset);
		}
		finally
		{
			libFs.closeSync(tmpFd);
		}

		let tmpContent = tmpBuffer.slice(0, tmpActual).toString(tmpEncoding);
		let tmpNextOffset = tmpOffset + tmpActual;
		let tmpIsComplete = tmpNextOffset >= tmpStat.size;

		return {
			Status: 'Success',
			Result:
			{
				SourcePath: tmpResolved,
				Content: tmpContent,
				ContentEncoding: tmpEncoding,
				Offset: tmpOffset,
				BytesRead: tmpActual,
				NextOffset: tmpNextOffset,
				IsComplete: tmpIsComplete,
				TotalFileSize: tmpStat.size
			}
		};
	}
	catch (pError)
	{
		return {
			Status: 'Error',
			Error: `ultravisor-file-stream.readChunk ${tmpResolved} @ ${tmpOffset}: ${pError.message}`
		};
	}
}

// ── sha256OfFile ───────────────────────────────────────────────────

function sha256OfFile(pPath)
{
	let tmpHash = libCrypto.createHash('sha256');
	let tmpFd = libFs.openSync(pPath, 'r');
	try
	{
		let tmpBuf = Buffer.alloc(1024 * 1024);
		let tmpPos = 0;
		while (true)
		{
			let tmpRead = libFs.readSync(tmpFd, tmpBuf, 0, tmpBuf.length, tmpPos);
			if (tmpRead <= 0) break;
			tmpHash.update(tmpBuf.slice(0, tmpRead));
			tmpPos += tmpRead;
		}
	}
	finally
	{
		libFs.closeSync(tmpFd);
	}
	return tmpHash.digest('hex').toLowerCase();
}

// ── hashDirectoryTree ──────────────────────────────────────────────

/**
 * Deterministic hash of a directory tree — sha256 over the sorted
 * (relative-path, per-file-sha256) pairs. Used to detect runtime drift
 * between hub and worker.
 *
 * Skips hidden files (prefix '.') and anything whose basename is in
 * pIgnoreBasenames (a Set).
 *
 * Returns:
 *   { Hash: string,          // lowercase hex sha256 of the tree
 *     FileCount: number,
 *     TotalBytes: number,
 *     Files: [ { RelativePath, Size, Sha256 } ] }
 */
function hashDirectoryTree(pDir, pIgnoreBasenames)
{
	let tmpIgnore = pIgnoreBasenames || new Set();
	if (!libFs.existsSync(pDir))
	{
		return { Hash: '', FileCount: 0, TotalBytes: 0, Files: [] };
	}

	function _walk(pCurrent, pOut)
	{
		let tmpEntries = libFs.readdirSync(pCurrent);
		for (let tmpEntry of tmpEntries)
		{
			if (tmpEntry.startsWith('.') || tmpIgnore.has(tmpEntry)) continue;
			let tmpFull = libPath.join(pCurrent, tmpEntry);
			let tmpStat = libFs.statSync(tmpFull);
			if (tmpStat.isDirectory())
			{
				_walk(tmpFull, pOut);
			}
			else if (tmpStat.isFile())
			{
				let tmpRel = libPath.relative(pDir, tmpFull);
				pOut.push({
					RelativePath: tmpRel.split(libPath.sep).join('/'),
					Size: tmpStat.size,
					Sha256: sha256OfFile(tmpFull)
				});
			}
		}
	}

	let tmpFiles = [];
	_walk(pDir, tmpFiles);
	tmpFiles.sort((a, b) => a.RelativePath.localeCompare(b.RelativePath));

	let tmpHash = libCrypto.createHash('sha256');
	let tmpTotal = 0;
	for (let tmpF of tmpFiles)
	{
		tmpHash.update(tmpF.RelativePath);
		tmpHash.update('\0');
		tmpHash.update(tmpF.Sha256);
		tmpHash.update('\n');
		tmpTotal += tmpF.Size;
	}
	return {
		Hash: tmpHash.digest('hex').toLowerCase(),
		FileCount: tmpFiles.length,
		TotalBytes: tmpTotal,
		Files: tmpFiles
	};
}

// ── buildChunksForFile ─────────────────────────────────────────────

/**
 * Convenience: read a whole file and synthesize the full list of
 * chunk payloads ready for transport. Each entry is a shape callers
 * can feed directly to writeChunk() on the receiving side.
 *
 * The final chunk gets Sha256 set automatically so receivers can
 * verify without re-hashing the source.
 *
 * Memory: reads the whole file into memory once. Appropriate for
 * files up to ~1 GB. For larger, use readChunk() in a loop instead.
 *
 * @param {string} pPath
 * @param {object} [pOptions]
 *   @property {number} [ChunkBytes=DEFAULT_CHUNK_BYTES]
 *   @property {string} [RelativePath]  label carried on each chunk (if
 *                                       the transport wants it; write
 *                                       tasks don't require it)
 * @returns {Array<{RelativePath?, Content, ContentEncoding: 'base64',
 *                  Offset, ChunkIndex, TotalChunks, IsFinal, Sha256?}>}
 */
function buildChunksForFile(pPath, pOptions)
{
	let tmpOptions = pOptions || {};
	let tmpChunkBytes = tmpOptions.ChunkBytes || DEFAULT_CHUNK_BYTES;
	let tmpRelativePath = tmpOptions.RelativePath || '';

	let tmpBytes = libFs.readFileSync(pPath);
	let tmpSha = sha256OfFile(pPath);
	let tmpChunkCount = Math.max(1, Math.ceil(tmpBytes.length / tmpChunkBytes));
	let tmpChunks = [];
	for (let i = 0; i < tmpChunkCount; i++)
	{
		let tmpOffset = i * tmpChunkBytes;
		let tmpEnd = Math.min(tmpOffset + tmpChunkBytes, tmpBytes.length);
		let tmpSlice = tmpBytes.slice(tmpOffset, tmpEnd);
		let tmpIsFinal = (i === tmpChunkCount - 1);
		let tmpChunk = {
			Content: tmpSlice.toString('base64'),
			ContentEncoding: 'base64',
			Offset: tmpOffset,
			ChunkIndex: i,
			TotalChunks: tmpChunkCount,
			IsFinal: tmpIsFinal,
			Sha256: tmpIsFinal ? tmpSha : ''
		};
		if (tmpRelativePath)
		{
			tmpChunk.RelativePath = tmpRelativePath;
		}
		tmpChunks.push(tmpChunk);
	}
	return tmpChunks;
}

module.exports =
{
	writeChunk: writeChunk,
	readChunk: readChunk,
	sha256OfFile: sha256OfFile,
	hashDirectoryTree: hashDirectoryTree,
	buildChunksForFile: buildChunksForFile,
	DEFAULT_CHUNK_BYTES: DEFAULT_CHUNK_BYTES
};
