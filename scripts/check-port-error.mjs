import net from 'node:net';
import { spawn } from 'node:child_process';
const port = 3998;
const blocker = net.createServer();
await new Promise((resolve, reject) => blocker.listen(port, '127.0.0.1', resolve).on('error', reject));
const child = spawn(process.execPath, ['server.js'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port) }, stdio: ['ignore','pipe','pipe'] });
let out = '';
child.stdout.on('data', d => out += d);
child.stderr.on('data', d => out += d);
const code = await new Promise(resolve => child.on('exit', resolve));
blocker.close();
if (code === 0 || !out.includes('端口 3998 已被占用')) {
  console.error(out);
  throw new Error('Friendly EADDRINUSE message check failed');
}
console.log('PORT_ERROR_CHECK_PASS');
