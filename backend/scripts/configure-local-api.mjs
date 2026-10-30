import { randomBytes } from 'node:crypto';
import { readFile, appendFile } from 'node:fs/promises';
const backend = new URL('../.env', import.meta.url);
const frontend = new URL('../../frontend/.env.local', import.meta.url);
async function read(path) { try { return await readFile(path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return ''; throw e; } }
const back = await read(backend); const front = await read(frontend);
const value = (text, key) => text.match(new RegExp(`^${key}=["']?([^"'\\r\\n]+)["']?\\s*$`, 'm'))?.[1];
const backToken = value(back, 'BACKEND_API_TOKEN'); const frontToken = value(front, 'BACKEND_API_TOKEN');
if (backToken && frontToken && backToken !== frontToken) throw new Error('Backend and frontend API tokens differ. Resolve them locally before continuing.');
const token = backToken || frontToken || randomBytes(32).toString('hex');
if (token.length < 32) throw new Error('Existing API token must be at least 32 characters.');
if (!backToken) await appendFile(backend, `\nBACKEND_API_TOKEN="${token}"\n`);
if (!frontToken) await appendFile(frontend, `\nBACKEND_API_TOKEN="${token}"\n`);
if (!value(back, 'DEVICE_KEY')) await appendFile(backend, '\nDEVICE_KEY="local-pc"\n');
if (!value(front, 'BACKEND_API_URL')) await appendFile(frontend, '\nBACKEND_API_URL="http://127.0.0.1:4010"\n');
console.log('Local API configuration saved. Credentials were not printed. Restart the backend and frontend to load it.');
