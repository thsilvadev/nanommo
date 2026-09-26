const fs = require('fs');
const path = require('path');

// 1. Try root .env file (dev / local)
const envPath = path.resolve(__dirname, '..', '.env');
let apiUrl = '';

if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, 'utf8');
  const match = envContent.match(/^API_URL=(.*)$/m);
  if (match) apiUrl = match[1].trim();
}

// 2. Fall back to Vercel / CI env var
if (!apiUrl) {
  apiUrl = process.env.API_URL || '';
}

// 3. Final fallback
if (!apiUrl) {
  apiUrl = 'https://api.botpit.online';
}

const content = `export const environment = {
  production: true,
  apiBaseUrl: '${apiUrl}',
};
`;

fs.writeFileSync(
  path.resolve(__dirname, '..', 'apps/frontend/src/environments/environment.prod.ts'),
  content
);
console.log('✅ environment.prod.ts generated');
console.log('   API_URL:', apiUrl);