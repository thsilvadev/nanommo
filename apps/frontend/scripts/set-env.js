const fs = require('fs');
const path = require('path');

const apiUrl = process.env.API_URL || 'https://api.botpit.online';

const content = `export const environment = {
  production: true,
  apiBaseUrl: '${apiUrl}',
};
`;

const envPath = path.join(__dirname, '..', 'src', 'environments', 'environment.prod.ts');

fs.writeFileSync(envPath, content);
console.log(`Environment file generated at ${envPath} with API_URL=${apiUrl}`);