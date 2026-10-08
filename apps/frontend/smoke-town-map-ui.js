const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  const requests=[];
  await page.on('request',req=>requests.push({method:req.method(),url:req.url()}));
  const jwtPayload=Buffer.from(JSON.stringify({userId:'smoke-user',username:'Smoke',sessionId:'smoke-session',type:'access'})).toString('base64url');
  await page.addInitScript(({token})=>{localStorage.setItem('accessToken',token);localStorage.setItem('refreshToken','smoke-refresh');},{token:'e30.'+jwtPayload+'.x'});

  await page.route('http://localhost:3000/**',async route=>{
    const req=route.request(),url=req.url();
    if(url.endsWith('/characters')) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:'c1',userId:'smoke-user',name:'Smoke',level:1,xp:0,xpToNext:100,unspentAttributePoints:0,str:5,agi:5,dex:5,vit:5,int:5,sor:5,gold:100,hpCurrent:100,spCurrent:50,maxHp:100,maxSp:50,attack:8,defense:0,attackSpeed:10,castSpeed:10,evasion:0,accuracy:0,hpRegenPerTenTicks:1,spRegenPerTenTicks:1,criticalChance:0,hungry:true,status:'town',currentMapId:'map_town',pendingMapTransition:null,lastSeenAt:new Date().toISOString(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()})});
    if(url.endsWith('/inventory')) return route.fulfill({status:200,contentType:'application/json',body:'[]'});
    if(url.endsWith('/equipment')) return route.fulfill({status:200,contentType:'application/json',body:'[]'});
    if(url.endsWith('/battles/queue')) return route.fulfill({status:200,contentType:'application/json',body:'[]'});
    if(url.endsWith('/gambits')) return route.fulfill({status:200,contentType:'application/json',body:'[]'});
    if(url.endsWith('/town/npcs')) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:'william',name:'William',types:['vendor'],location:'town',greeting:'Hello'}])});
    if(url.includes('/town/vendor/william/stock')) return route.fulfill({status:200,contentType:'application/json',body:'[]'});
    if(url.endsWith('/maps')) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:'map_town',name:'Town',unlockLevel:1,isTown:true},{id:'map_green_grounds',name:'Green Grounds',unlockLevel:1,isTown:false},{id:'map_fake_town',name:'Town',unlockLevel:1,isTown:true}])});
    return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({message:'mock route missing'})});
  });

  await page.goto('http://127.0.0.1:4400/play/grind');
  await page.locator('.map-panel').waitFor();
  assert.equal(await page.locator('app-town-center').count(),0);
  assert.equal(await page.locator('.town-center').count(),1);
  assert.equal(await page.locator('.map-tile').count(),1);
  assert.equal(await page.locator('.map-tile b').innerText(),'GREEN GROUNDS');
  assert.equal(await page.locator('.town-center b').innerText(),'TOWN');

  const before=await page.locator('.map-panel').count();
  await page.locator('.town-center').click();
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.map-panel').count(),before);
  assert.equal(requests.some(r=>r.url.endsWith('/maps/leave')&&r.method==='POST'),false);
  assert.equal(requests.some(r=>r.url.includes('/maps/map_town/enter')&&r.method==='POST'),false);

  console.log('smoke-town-map-ui.js: exactly one Town node, Town excluded from grind tiles, already-in-Town click is a no-op');
  await browser.close();
})().catch(err=>{console.error(err);process.exit(1);});
