const { chromium } = require('playwright');
const assert = require('node:assert/strict');

(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  let gold=100, quantity=2;
  const jwtPayload=Buffer.from(JSON.stringify({userId:'smoke-user',username:'Smoke',sessionId:'smoke-session',type:'access'})).toString('base64url');
  await page.addInitScript(({token})=>{localStorage.setItem('accessToken',token);localStorage.setItem('refreshToken','smoke-refresh');},{token:'e30.'+jwtPayload+'.x'});

  await page.route('http://localhost:3000/**',async route=>{
    const req=route.request(), url=req.url(), method=req.method();
    if(url.endsWith('/characters')) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({id:'c1',userId:'smoke-user',name:'Smoke',level:1,xp:0,xpToNext:100,unspentAttributePoints:0,str:5,agi:5,dex:5,vit:5,int:5,sor:5,gold,hpCurrent:100,spCurrent:50,maxHp:100,maxSp:50,attack:8,defense:0,attackSpeed:10,castSpeed:10,evasion:0,accuracy:0,hpRegenPerTenTicks:1,spRegenPerTenTicks:1,criticalChance:0,hungry:true,status:'town',lastSeenAt:new Date().toISOString(),createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()})});
    if(url.endsWith('/inventory')) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:'i1',characterId:'c1',location:'inventory',slotIndex:0,itemId:'pot_hp_small',quantity}])});
    if(url.endsWith('/equipment')) return route.fulfill({status:200,contentType:'application/json',body:'[]'});
    if(url.endsWith('/battles/queue')) return route.fulfill({status:200,contentType:'application/json',body:'[]'});
    if(url.endsWith('/gambits')) return route.fulfill({status:200,contentType:'application/json',body:'[]'});
    if(url.endsWith('/town/npcs')) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{id:'william',name:'William',type:'vendor',location:'town'}])});
    if(url.endsWith('/town/vendor/william/stock')) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify([{slotIndex:0,itemId:'pot_hp_small',quantity:null,infiniteStock:true,buyPrice:15,item:{id:'pot_hp_small',name:'Small HP Potion',type:'consumable',stackable:true,maxStack:20}}])});
    if(url.includes('/town/vendor/william/quote/pot_hp_small')) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({vendorId:'william',itemId:'pot_hp_small',buyPrice:15,sellPrice:2,stackable:true,maxStack:20})});
    if(method==='POST' && url.endsWith('/town/vendor/william/sell')){ quantity-=1; gold+=2; return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({goldReceived:2})}); }
    if(method==='POST' && url.endsWith('/town/vendor/william/buy')){ quantity+=1; gold-=15; return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({goldSpent:15})}); }
    if(url.includes('/maps')) return route.fulfill({status:200,contentType:'application/json',body:'[]'});
    return route.fulfill({status:404,contentType:'application/json',body:JSON.stringify({message:'mock route missing'})});
  });

  await page.goto('http://127.0.0.1:4400/play/grind');
  await page.locator('app-town-center').waitFor();
  assert.equal(await page.locator('app-town-center').count(),1);
  assert.equal(await page.locator('.panel-title').filter({hasText:'GRIND / BATTLE'}).count(),0);
  assert.equal(await page.locator('.npc-select label').innerText(),'Choose NPC');
  assert.equal(await page.locator('.vendor-slot').count(),10);

  async function drag(src,dst){const a=await src.boundingBox(),b=await dst.boundingBox();if(!a||!b)throw new Error('drag bounds missing');await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(a.x+a.width/2+20,a.y+a.height/2+10,{steps:5});await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:12});await page.waitForTimeout(150);await page.mouse.up();}
  await drag(page.locator('.item').first(),page.locator('#vendor-drop-list'));
  await page.locator('.trade-modal-backdrop').waitFor();
  assert.equal(await page.locator('.trade-modal-title span').innerText(),'SELL');
  assert.equal(await page.locator('.trade-summary b').nth(2).innerText(),'2 G');
  await page.getByRole('button',{name:'All'}).click();
  await page.getByRole('button',{name:'Confirm'}).click();
  await page.waitForTimeout(100);
  assert.equal(gold,102);
  assert.equal(quantity,1);

  await drag(page.locator('.vendor-item').first(),page.locator('#inventory-drop-list'));
  await page.locator('.trade-modal-backdrop').waitFor();
  assert.equal(await page.locator('.trade-modal-title span').innerText(),'BUY');
  assert.equal(await page.locator('.trade-summary b').nth(2).innerText(),'15 G');
  await page.getByRole('button',{name:'Confirm'}).click();
  await page.waitForTimeout(100);
  assert.equal(gold,87);
  assert.equal(quantity,2);

  await page.setViewportSize({width:390,height:844});
  await page.reload();
  await page.locator('app-town-center').waitFor();
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
  assert.equal(overflow,false,'390px viewport must not overflow horizontally');

  await browser.close();
  console.log('smoke-vendor-ui.js: Town → William → SELL → BUY → 390px responsive passed');
})().catch(err=>{console.error(err);process.exit(1);});
