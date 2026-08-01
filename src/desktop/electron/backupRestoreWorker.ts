import { parentPort, workerData } from "node:worker_threads";
import { validateBackup } from "./domain/backupValidation";

interface WorkerInput {
  fileContent: string;
  schemaVersion: number;
  schemaFingerprint: string;
}

const { fileContent, schemaVersion, schemaFingerprint } =
  workerData as WorkerInput;

try {
  const payload = JSON.parse(fileContent) as unknown;
  const validated = validateBackup(
    payload,
    schemaVersion,
    schemaFingerprint,
  );
  parentPort?.postMessage({ success: true, data: validated });
} catch (error) {
  parentPort?.postMessage({
    success: false,
    error: error instanceof Error ? error.message : String(error),
  });
}
