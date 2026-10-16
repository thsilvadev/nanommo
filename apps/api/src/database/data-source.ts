import * as path from 'path';
import { DataSource } from 'typeorm';

// Resolve TypeORM's declared transitive peer from its own package context; this
// workspace does not expose reflect-metadata as a direct @nanommo/api dependency.
require(require.resolve('reflect-metadata', { paths: [path.dirname(require.resolve('typeorm'))] }));

// Both ts-node CLI and compiled maintenance commands load the same repo-root .env.
const fs = require('fs');
const dotenv = require(require.resolve('dotenv', { paths: [path.dirname(require.resolve('@nestjs/config'))] }));
const envCandidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../../.env'),
  path.resolve(__dirname, '../../../../.env'),
  path.resolve(__dirname, '../../../../../../..', '.env'),
];
const envPath = envCandidates.find(candidate => fs.existsSync(candidate));
if (envPath) dotenv.config({ path: envPath });

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  username: process.env.DB_USER || 'nanommo',
  password: process.env.DB_PASSWORD || 'nanommo_dev_password',
  database: process.env.DB_NAME || 'nanommo',
  synchronize: false,
  migrationsRun: false,
  logging: process.env.DB_LOGGING === 'true',
  entities: [path.join(__dirname, 'entities/*{.ts,.js}')],
  migrations: [path.join(__dirname, 'migrations/*{.ts,.js}')],
});

export default AppDataSource;
