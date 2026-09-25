// Manual smoke test for the SQLite store — exercises strikes, blocks, and
// the audit log against a throwaway on-disk database, no WhatsApp
// connection needed.
//
//   npm run store:test

import { rmSync } from 'node:fs';
import { getStrikeCount, recordStrike, decayStrike } from './strikes.js';
import { createBlock, getActiveBlock, getExpiredBlocks, markUnblocked } from './blocks.js';
import { logMessage, getAuditLog } from './audit-log.js';

process.env.DB_PATH = 'data/test-store.sqlite';
const CONTACT = 'test-contact@s.whatsapp.net';

console.log('strikes:', getStrikeCount(CONTACT));
recordStrike(CONTACT);
recordStrike(CONTACT);
console.log('after 2 strikes:', getStrikeCount(CONTACT));
decayStrike(CONTACT);
console.log('after 1 decay:', getStrikeCount(CONTACT));

createBlock(CONTACT, Date.now() - 1000);
const active = getActiveBlock(CONTACT);
console.log('active block:', active);
console.log('expired blocks:', getExpiredBlocks());
markUnblocked(active.id);
console.log('active block after unblock:', getActiveBlock(CONTACT));

logMessage({
  contactId: CONTACT,
  direction: 'them',
  message: 'hey',
  classification: { ok: true, flagged: false, category: 'none', reason: 'friendly greeting' },
  action: 'none',
});
console.log('audit log:', getAuditLog(CONTACT));

for (const ext of ['', '-wal', '-shm']) rmSync(`${process.env.DB_PATH}${ext}`, { force: true });
