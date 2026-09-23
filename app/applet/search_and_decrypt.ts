import fs from 'fs';
import path from 'path';
import { decryptData } from './server/crypto';

// Broadly search for transcript.jsonl starting from root /
function findFile(dir: string, fileName: string): string | null {
  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const fullPath = path.join(dir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          // Skip standard heavy system dirs
          if (file === 'node_modules' || file === 'proc' || file === 'sys' || file === 'dev' || file === 'var' || file === 'etc') {
            continue;
          }
          const found = findFile(fullPath, fileName);
          if (found) return found;
        } else if (file === fileName) {
          return fullPath;
        }
      } catch (e) {}
    }
  } catch (e) {}
  return null;
}

const transcriptPath = findFile('/', 'transcript.jsonl') || findFile('/app', 'transcript.jsonl');
console.log("Found transcriptPath:", transcriptPath);

if (transcriptPath) {
  try {
    const content = fs.readFileSync(transcriptPath, 'utf8');
    
    // Let's find any secure backup JSON payloads
    // Matching JSON that looks like: {"type":"sanaei_bot_secured_backup"...}
    // We can search for '"type":"sanaei_bot_secured_backup"'
    const regex = /\{[^{}]*"type"\s*:\s*"sanaei_bot_secured_backup"[^{}]*"encryptedData"\s*:\s*"[a-f0-9]+"[^{}]*\}/g;
    
    // Since regex can be strict with newlines or escaping in JSON logs, let's also find manually by searching for the marker
    let index = 0;
    const backupJsonStrings: string[] = [];
    while (true) {
      const pos = content.indexOf('"type":"sanaei_bot_secured_backup"', index);
      if (pos === -1) break;
      
      // Find the surrounding { and }
      let start = pos;
      while (start > 0 && content[start] !== '{') {
        start--;
      }
      let end = pos;
      let openBraces = 0;
      while (end < content.length) {
        if (content[end] === '{') openBraces++;
        if (content[end] === '}') {
          openBraces--;
          if (openBraces === 0 || end > pos + 100) { // basic heuristic
            break;
          }
        }
        end++;
      }
      
      try {
        const potentialJson = content.substring(start, end + 1);
        // Let's try to parse it as JSON or clean it if it contains backslashes/escaped chars
        const cleaned = potentialJson.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
        // Let's find if we can parse it
        const parsed = JSON.parse(cleaned);
        if (parsed.type === 'sanaei_bot_secured_backup' && parsed.encryptedData) {
          backupJsonStrings.push(cleaned);
        }
      } catch (e) {
        // Let's also try parsing with standard JSON parse of the exact block
        try {
          // If it's inside a JSON log line, we can parse the log line first
          // Find the beginning of the log line
          let lineStart = start;
          while (lineStart > 0 && content[lineStart] !== '\n') {
            lineStart--;
          }
          let lineEnd = end;
          while (lineEnd < content.length && content[lineEnd] !== '\n') {
            lineEnd++;
          }
          const line = content.substring(lineStart, lineEnd).trim();
          const logObj = JSON.parse(line);
          // Recursively find sanaei_bot_secured_backup in logObj
          const traverse = (obj: any) => {
            if (obj && typeof obj === 'object') {
              if (obj.type === 'sanaei_bot_secured_backup' && obj.encryptedData) {
                backupJsonStrings.push(JSON.stringify(obj));
                return;
              }
              for (const k of Object.keys(obj)) {
                traverse(obj[k]);
              }
            }
          };
          traverse(logObj);
        } catch (err2) {}
      }
      
      index = pos + 1;
    }
    
    console.log(`Found ${backupJsonStrings.length} potential backup strings!`);
    
    let decrypted = null;
    const passwords = ['2554', '۲۵۵۴'];
    
    for (const backupStr of backupJsonStrings.reverse()) {
      for (const pw of passwords) {
        try {
          const result = decryptData(backupStr, pw);
          if (result) {
            decrypted = result;
            console.log(`Successfully decrypted backup with password "${pw}"!`);
            break;
          }
        } catch (err) {}
      }
      if (decrypted) break;
    }
    
    if (decrypted) {
      fs.writeFileSync('/app/applet/db.json', decrypted);
      console.log("Decrypted database has been saved to /app/applet/db.json!");
      const parsed = JSON.parse(decrypted);
      console.log("Database Stats:");
      console.log("- Users count:", parsed.users?.length);
      console.log("- Products count:", parsed.products?.length);
      console.log("- Admin IDs:", parsed.adminIds);
      console.log("- Panel type:", parsed.panel?.type);
    } else {
      console.log("Could not decrypt any of the backups found.");
    }
  } catch (err: any) {
    console.error("Error reading log:", err.message);
  }
} else {
  console.log("transcript.jsonl not found anywhere!");
}
