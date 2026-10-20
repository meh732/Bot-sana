const fs = require('fs');
let content = fs.readFileSync('server/panel4.ts', 'utf8');

const targetStr = `    let cleanEmail = String(rawEmail || '')
      .trim()
      .replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 1728))
      .replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 1632))
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');

    if (cleanEmail.length < 3) {
      const suffix = Math.floor(100 + Math.random() * 899);
      cleanEmail = cleanEmail ? \`\${cleanEmail}_\${suffix}\` : \`u_\${Date.now().toString().slice(-6)}\`;
    }
    if (cleanEmail.length > 30) {
      cleanEmail = cleanEmail.slice(0, 30).replace(/_+$/g, '');
    }`;

const replacementStr = `    let cleanEmail = String(rawEmail || '')
      .trim()
      .replace(/[۰-۹]/g, d => String.fromCharCode(d.charCodeAt(0) - 1728))
      .replace(/[٠-٩]/g, d => String.fromCharCode(d.charCodeAt(0) - 1632))
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_+|_+$/g, '');

    if (cleanEmail.length > 0 && !/[0-9]/.test(cleanEmail)) {
      cleanEmail = \`\${cleanEmail}_\${Math.floor(10 + Math.random() * 89)}\`;
    }
    if (cleanEmail.length < 3) {
      const suffix = Math.floor(100 + Math.random() * 899);
      cleanEmail = cleanEmail ? \`\${cleanEmail}_\${suffix}\` : \`u_\${Date.now().toString().slice(-6)}\`;
    }
    if (cleanEmail.length > 30) {
      cleanEmail = cleanEmail.slice(0, 30).replace(/_+$/g, '');
    }`;

if (!content.includes(targetStr)) {
  console.error("Target string not found in server/panel4.ts");
  process.exit(1);
}

content = content.replace(targetStr, replacementStr);
fs.writeFileSync('server/panel4.ts', content, 'utf8');
console.log("Updated server/panel4.ts successfully!");
