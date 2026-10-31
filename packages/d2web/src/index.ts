export { createClient, SupersededError, TimeoutError, VersionError } from './client.ts';
export { spawnWorker } from './client.ts';
export type { SpawnWorkerOptions, ClientOptions, CompileInput, WorkerLike } from './client.ts';
export { mount, MountError } from './mount.ts';
export type { Box, D2Event, D2EventType, Mount, MountOptions, UpdateReport } from './mount.ts';
export { getObject, objectsAt } from './association.ts';
export { normalizeCompileRequest, ProtocolError } from './request.ts';
export * from './protocol.ts';
