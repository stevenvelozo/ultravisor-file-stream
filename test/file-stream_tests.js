/**
 * ultravisor-file-stream — mocha tests for the five public primitives.
 *
 * Covers: writeChunk happy path, writeChunk out-of-order delivery,
 * writeChunk sha mismatch handling, readChunk base64 round-trip,
 * sha256OfFile, hashDirectoryTree determinism, buildChunksForFile.
 */

const libAssert = require('assert');
const libFs = require('fs');
const libPath = require('path');
const libCrypto = require('crypto');
const libOs = require('os');

const libStream = require('../source/Ultravisor-FileStream.cjs');

function _mktmp(pPrefix)
{
	return libFs.mkdtempSync(libPath.join(libOs.tmpdir(), pPrefix));
}

suite('ultravisor-file-stream', () =>
{
	let tmpDir;
	setup(() => { tmpDir = _mktmp('ufs-'); });
	teardown(() => { libFs.rmSync(tmpDir, { recursive: true, force: true }); });

	test('writeChunk — single-chunk happy path with sha verify', () =>
	{
		let tmpPath = libPath.join(tmpDir, 'out.bin');
		let tmpData = Buffer.from('hello world');
		let tmpSha = libCrypto.createHash('sha256').update(tmpData).digest('hex');
		let tmpResult = libStream.writeChunk({
			TargetPath: tmpPath,
			Content: tmpData.toString('base64'),
			Offset: 0, IsFinal: true, Sha256: tmpSha
		});
		libAssert.strictEqual(tmpResult.Status, 'Success');
		libAssert.strictEqual(tmpResult.Result.IsComplete, true);
		libAssert.strictEqual(tmpResult.Result.Sha256Verified, true);
		libAssert.ok(libFs.existsSync(tmpPath));
		libAssert.ok(!libFs.existsSync(tmpPath + '.part'));
		libAssert.deepStrictEqual(libFs.readFileSync(tmpPath), tmpData);
	});

	test('writeChunk — multi-chunk with out-of-order delivery', () =>
	{
		let tmpPath = libPath.join(tmpDir, 'out.bin');
		let tmpData = Buffer.alloc(4 * 1024);
		for (let i = 0; i < tmpData.length; i++) tmpData[i] = i & 0xff;
		let tmpSha = libCrypto.createHash('sha256').update(tmpData).digest('hex');

		// 4 chunks of 1 KB — delivered as 0, 2, 1, 3 (final)
		const CS = 1024;
		let tmpOrder = [0, 2, 1, 3];
		for (let tmpIdx of tmpOrder)
		{
			let tmpChunkData = tmpData.slice(tmpIdx * CS, (tmpIdx + 1) * CS);
			let tmpIsFinal = (tmpIdx === 3);
			let tmpResult = libStream.writeChunk({
				TargetPath: tmpPath,
				Content: tmpChunkData.toString('base64'),
				Offset: tmpIdx * CS,
				ChunkIndex: tmpIdx, TotalChunks: 4,
				IsFinal: tmpIsFinal,
				Sha256: tmpIsFinal ? tmpSha : ''
			});
			libAssert.strictEqual(tmpResult.Status, 'Success', `chunk ${tmpIdx}`);
		}
		libAssert.deepStrictEqual(libFs.readFileSync(tmpPath), tmpData);
	});

	test('writeChunk — sha mismatch deletes .part, target untouched', () =>
	{
		let tmpPath = libPath.join(tmpDir, 'bad.bin');
		let tmpResult = libStream.writeChunk({
			TargetPath: tmpPath,
			Content: Buffer.from('abc').toString('base64'),
			Offset: 0, IsFinal: true,
			Sha256: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef'
		});
		libAssert.strictEqual(tmpResult.Status, 'Sha256Mismatch');
		libAssert.strictEqual(libFs.existsSync(tmpPath), false);
		libAssert.strictEqual(libFs.existsSync(tmpPath + '.part'), false);
	});

	test('readChunk — round-trip matches source via base64', () =>
	{
		let tmpPath = libPath.join(tmpDir, 'src.bin');
		let tmpSrc = libCrypto.randomBytes(3 * 1024);  // 3 KB
		libFs.writeFileSync(tmpPath, tmpSrc);

		let tmpOffset = 0;
		let tmpParts = [];
		while (true)
		{
			let tmpR = libStream.readChunk({
				SourcePath: tmpPath, Offset: tmpOffset, MaxBytes: 1024
			});
			libAssert.strictEqual(tmpR.Status, 'Success');
			if (tmpR.Result.BytesRead === 0) break;
			tmpParts.push(Buffer.from(tmpR.Result.Content, 'base64'));
			tmpOffset = tmpR.Result.NextOffset;
			if (tmpR.Result.IsComplete) break;
		}
		libAssert.deepStrictEqual(Buffer.concat(tmpParts), tmpSrc);
	});

	test('sha256OfFile — matches Node crypto', () =>
	{
		let tmpPath = libPath.join(tmpDir, 'x.bin');
		let tmpBytes = libCrypto.randomBytes(10 * 1024);
		libFs.writeFileSync(tmpPath, tmpBytes);
		let tmpExpected = libCrypto.createHash('sha256').update(tmpBytes).digest('hex');
		libAssert.strictEqual(libStream.sha256OfFile(tmpPath), tmpExpected);
	});

	test('hashDirectoryTree — deterministic across reorder; detects drift', () =>
	{
		// Build a tree with 3 files; compute hash.
		libFs.writeFileSync(libPath.join(tmpDir, 'a.txt'), 'alpha');
		libFs.writeFileSync(libPath.join(tmpDir, 'b.txt'), 'beta');
		libFs.mkdirSync(libPath.join(tmpDir, 'sub'));
		libFs.writeFileSync(libPath.join(tmpDir, 'sub', 'c.txt'), 'gamma');

		let tmpH1 = libStream.hashDirectoryTree(tmpDir);
		libAssert.strictEqual(tmpH1.FileCount, 3);
		libAssert.ok(tmpH1.Hash);

		// Same content recomputed — must match.
		let tmpH2 = libStream.hashDirectoryTree(tmpDir);
		libAssert.strictEqual(tmpH1.Hash, tmpH2.Hash);

		// Change one byte — hash must change.
		libFs.writeFileSync(libPath.join(tmpDir, 'a.txt'), 'ALPHA');
		let tmpH3 = libStream.hashDirectoryTree(tmpDir);
		libAssert.notStrictEqual(tmpH1.Hash, tmpH3.Hash);

		// Ignore list: add a file that should be skipped.
		libFs.writeFileSync(libPath.join(tmpDir, '.DS_Store'), 'junk');
		let tmpH4 = libStream.hashDirectoryTree(tmpDir, new Set(['.DS_Store']));
		// Hidden files (.-prefix) auto-ignored too, so adding .DS_Store
		// to the ignore set is belt-and-suspenders.
		libAssert.strictEqual(tmpH4.Hash, tmpH3.Hash);
	});

	test('buildChunksForFile — round-trip via writeChunk sequence', () =>
	{
		let tmpSrcPath = libPath.join(tmpDir, 'src.bin');
		let tmpDstPath = libPath.join(tmpDir, 'dst.bin');
		let tmpBytes = libCrypto.randomBytes(5 * 1024);  // 5 KB
		libFs.writeFileSync(tmpSrcPath, tmpBytes);

		let tmpChunks = libStream.buildChunksForFile(tmpSrcPath, { ChunkBytes: 1024 });
		libAssert.strictEqual(tmpChunks.length, 5);
		libAssert.strictEqual(tmpChunks[4].IsFinal, true);
		libAssert.ok(tmpChunks[4].Sha256);

		for (let tmpChunk of tmpChunks)
		{
			let tmpR = libStream.writeChunk(Object.assign({ TargetPath: tmpDstPath }, tmpChunk));
			libAssert.strictEqual(tmpR.Status, 'Success');
		}
		libAssert.deepStrictEqual(libFs.readFileSync(tmpDstPath), tmpBytes);
	});
});
