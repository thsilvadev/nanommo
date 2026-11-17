/** Creates only disposable schema on the dedicated local postgres/redis instances. */
const assert=require('node:assert/strict'),path=require('node:path');
if(process.env.PARTY_TEST_DATABASE!=='nanommo_party_boot')throw Error('Refusing non-disposable database');
Object.assign(process.env,{DB_HOST:'127.0.0.1',DB_PORT:'55439',DB_USER:'party_test',DB_PASSWORD:'',DB_NAME:'nanommo_party_boot',REDIS_URL:'redis://127.0.0.1:56380',CHARACTER_3D_CUTOVER_COMPLETE:'true',BATTLE_TICK_DURATION_MS:'500',NODE_ENV:'test'});
const {DataSource}=require('typeorm'),entities=require('../dist/apps/api/src/database/entities');
const db=new DataSource({type:'postgres',host:process.env.DB_HOST,port:55439,username:'party_test',database:process.env.DB_NAME,entities:Object.values(entities).filter(x=>typeof x==='function'),migrations:[path.resolve(__dirname,'../dist/apps/api/src/database/migrations/*.js')]});
(async()=>{
 await db.initialize();await db.synchronize(true);
 await db.query('DROP FUNCTION IF EXISTS check_party_deadline_at_commit()');
 await db.query('DROP FUNCTION IF EXISTS record_character_map_arrival()');
 await db.query('ALTER TABLE characters DROP COLUMN "mapEnteredAt"');
 const {CharacterMapArrival1800700000000}=require('../dist/apps/api/src/database/migrations/1800700000000-CharacterMapArrival');
 const {PartyDeadlineGuard1800600000000}=require('../dist/apps/api/src/database/migrations/1800600000000-PartyDeadlineGuard');
 const runner=db.createQueryRunner();
 try { await new PartyDeadlineGuard1800600000000().up(runner); await new CharacterMapArrival1800700000000().up(runner); }
 finally { await runner.release(); }
 await db.query('CREATE TABLE migrations(id serial PRIMARY KEY, timestamp bigint NOT NULL, name varchar NOT NULL)');
 for(const m of db.migrations){const match=m.name.match(/(\d{13})$/);if(match)await db.query('INSERT INTO migrations(timestamp,name) VALUES($1,$2)',[Number(match[1]),m.name]);}
 await db.destroy();
 const {NestFactory}=require('@nestjs/core'),{AppModule}=require('../dist/apps/api/src/app.module');
 const {PartyService}=require('../dist/apps/api/src/modules/party/party.service');
 const cwd=process.cwd();process.chdir(path.resolve(__dirname,'..'));
 const app=await NestFactory.createApplicationContext(AppModule,{logger:false,abortOnError:false});
 assert.ok(app.get(PartyService),'Nest resolves PartyService and its dependencies');
 await app.close();process.chdir(cwd);
 console.log('party-bootstrap.integration: real Nest dependency graph and startup recovery passed');
 process.exit(0); // Nest's existing Redis provider leaves client handles open after app.close().
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>db.isInitialized&&db.destroy());
