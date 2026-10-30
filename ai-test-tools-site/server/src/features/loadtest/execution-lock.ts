import { createServer, type Server } from 'node:net';
import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';

// A bound local socket is released by the OS even if a manager process crashes.
const LOCK_PORT = 39841;
const exec = promisify(execFile);

export async function acquireExecutionLock(port = LOCK_PORT): Promise<() => Promise<void>> {
  const server = createServer(socket => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => { server.removeListener('error', reject); resolve(); });
  });
  server.unref();
  return () => new Promise<void>((resolve, reject) => (server as Server).close(error => error ? reject(error) : resolve()));
}

/** Refuse to start if a previous manager crashed leaving k6 alive. Never terminate processes. */
export async function assertNoExistingK6(binary: string): Promise<void> {
  let name = basename(binary).toLowerCase();
  if (process.platform === 'win32' && !name.endsWith('.exe')) name += '.exe';
  try {
    if (process.platform === 'win32') {
      const { stdout } = await exec('tasklist.exe', ['/FI', `IMAGENAME eq ${name}`, '/FO', 'CSV', '/NH'], { timeout: 5000, windowsHide: true });
      if (stdout.split(/\r?\n/).some(line => line.toLowerCase().startsWith(`"${name}",`))) throw new Error('k6 进程仍在运行，请等待其结束后重试');
    } else {
      const { stdout } = await exec('ps', ['-A', '-o', 'comm='], { timeout: 5000 });
      if (stdout.split(/\r?\n/).some(line => basename(line.trim()).toLowerCase() === name)) throw new Error('k6 进程仍在运行，请等待其结束后重试');
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('k6 进程仍在运行')) throw error;
    throw new Error('无法确认 k6 进程状态，已拒绝启动', { cause: error });
  }
}
