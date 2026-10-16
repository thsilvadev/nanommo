import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'../../..');
const css=fs.readFileSync(path.join(root,'apps/frontend/src/app/features/play/map-board.css'),'utf8');
const maps=JSON.parse(fs.readFileSync(path.join(root,'maps.json'),'utf8')).maps;
assert.equal(maps.length,7,'layout smoke expects one Town plus six Grind maps');
const tileHtml=maps.slice(1).map((map,index)=>`<button class="map-tile" style="grid-column:${index+2};grid-row:1"><b>${map.name}</b><small>Lv ${map.unlockLevel}</small></button>`).join('');
const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>html,body{margin:0;padding:0;font-family:Arial}*,*::before,*::after{box-sizing:border-box}.panel{width:100%;min-height:100vh;background:#17100c;padding:8px}.map-art{width:100%;margin-top:8px}.town-center{grid-column:1;grid-row:1}</style><style>${css}</style></head><body><section class="panel"><div class="map-art"><div class="grid-overlay"></div><div class="town-center" style="grid-column:1;grid-row:1"><b>Town</b></div>${tileHtml}</div></section></body></html>`;
const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage({viewport:{width:1440,height:900},deviceScaleFactor:1});
 await page.setContent(html,{waitUntil:'load'});
 const desktop=await page.locator('.town-center,.map-tile').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {name:node.textContent.trim().replace(/\\s+/g,' '),x:r.x,y:r.y,width:r.width,height:r.height};}));
 assert.equal(desktop.length,7);
 for(const [index,tile] of desktop.entries()){
   assert.ok(Math.abs(tile.width-tile.height)<=1,`desktop tile ${index} is not square: ${JSON.stringify(tile)}`);
   assert.ok(Math.abs(tile.width-desktop[0].width)<=1,`desktop tile ${index} differs in width from Town`);
   assert.ok(Math.abs(tile.height-desktop[0].height)<=1,`desktop tile ${index} differs in height from Town`);
   assert.ok(Math.abs(tile.y-desktop[0].y)<=1,`desktop tile ${index} wraps to another row`);
   if(index>0)assert.ok(tile.x>desktop[index-1].x,`desktop order is not left-to-right at index ${index}`);
 }
 await page.screenshot({path:'/tmp/nanommo-map-board-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 await page.waitForTimeout(50);
 const mobile=await page.locator('.town-center,.map-tile').evaluateAll(nodes=>nodes.map(node=>{const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
 assert.equal(mobile.length,7);
 for(const [index,tile] of mobile.entries()){
   assert.ok(Math.abs(tile.width-tile.height)<=1,`mobile tile ${index} is not square: ${JSON.stringify(tile)}`);
   assert.ok(Math.abs(tile.width-mobile[0].width)<=1,`mobile tile ${index} differs in width from Town`);
   assert.ok(Math.abs(tile.y-mobile[0].y)<=1,`mobile tile ${index} wrapped to another row`);
   if(index>0)assert.ok(tile.x>mobile[index-1].x,`mobile order is not left-to-right at index ${index}`);
 }
 const overflow=await page.locator('.map-art').evaluate(node=>({scrollWidth:node.scrollWidth,clientWidth:node.clientWidth,overflowX:getComputedStyle(node).overflowX}));
 assert.ok(overflow.scrollWidth>overflow.clientWidth,'narrow viewport must scroll the row rather than shrink/wrap the map tiles');
 assert.equal(overflow.overflowX,'auto');
 await page.screenshot({path:'/tmp/nanommo-map-board-mobile.png',fullPage:true});
 console.log('map-board-layout: passed desktop/mobile tile sizes and order');
 console.log(`desktop=${JSON.stringify(desktop)}`);
 console.log(`mobile=${JSON.stringify(mobile)} overflow=${JSON.stringify(overflow)}`);
 console.log('screenshots: /tmp/nanommo-map-board-desktop.png /tmp/nanommo-map-board-mobile.png');
}finally{await browser.close();}
