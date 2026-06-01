# Ultravisor File Stream

> Chunked, sha256-verified file-streaming primitives for shipping multi-GB files across the Ultravisor mesh

- Chunk-at-offset writes with an atomic, sha256-verified finalize
- Idempotent and order-independent - retry or reorder chunks safely
- Directory-tree hashing for runtime-drift detection
- Zero runtime dependencies - just Node's `fs`, `path`, and `crypto`

[Get Started](quickstart.md)
[API Reference](api/README.md)
[GitHub](https://github.com/stevenvelozo/ultravisor-file-stream)
