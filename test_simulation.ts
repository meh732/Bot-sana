import { db } from './server/db.js';
import { isUserAdmin } from './server/bot.js';

console.log('Testing db and admin status:');
const state = db.getState();
console.log('Admin IDs:', state.adminIds);
const testChatId = 92218108;
console.log('Is 92218108 admin?', isUserAdmin(testChatId, state));
