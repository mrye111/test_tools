import { describe, it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import { acquireExecutionLock, assertNoExistingK6 } from './execution-lock.js';

describe('cross-process execution lock', () => {
  it('detects a surviving executable process without terminating it', async () => {
    await expect(assertNoExistingK6(process.execPath)).rejects.toThrow('进程仍在运行');
  });
  it('rejects a second owner and is released after an owner crashes', async () => {
    const port = 39929;
    const child = spawn(process.execPath, ['-e', `require('net').createServer().listen(${port},'127.0.0.1',()=>process.stdout.write('ready'))`], { stdio: ['ignore','pipe','pipe'] });
    try {
      await new Promise<void>((resolve, reject) => { child.stdout.once('data', () => resolve()); child.once('error', reject); child.once('exit', code => reject(new Error(`child exited ${code}`))); });
      await expect(acquireExecutionLock(port)).rejects.toThrow();
      const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
      child.kill();
      await exited;
      const release = await acquireExecutionLock(port);
      await release();
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); }
  });
});
