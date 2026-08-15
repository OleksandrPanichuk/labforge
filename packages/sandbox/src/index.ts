// Phase 1: dockerode wrapper behind the `run_in_sandbox` custom tool.
// Hard limits are CLAUDE.md invariant 6: --network none, 1g mem, 1 cpu, pids 256,
// 120s timeout, non-root, read-only job mount + writable artifacts/.
export {};
