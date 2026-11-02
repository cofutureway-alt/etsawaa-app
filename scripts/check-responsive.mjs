import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const b=await puppeteer.launch({headless:'new',executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
const widths=[320,390,768,1024,1280,1440];
const pages=[['home','/ar'],['home-en','/en'],['login','/ar/auth/login'],['register','/ar/auth/register']];
const rows=[];
for(const [name,path] of pages){for(const w of widths){
  const p=await b.newPage(); await p.setViewport({width:w,height:900});
  await p.goto('http://localhost:3000'+path,{waitUntil:'networkidle2'});
  await new Promise(r=>setTimeout(r,350));
  const r=await p.evaluate(()=>({over:document.documentElement.scrollWidth-window.innerWidth,
    scrollW:document.documentElement.scrollWidth,innerW:window.innerWidth,
    dir:document.documentElement.dir}));
  rows.push({page:name,width:w,...r,pass:r.over<=0});
  await p.close();
}}
fs.writeFileSync('evidence/phase-01/responsive-checks.json',JSON.stringify({generatedAt:new Date().toISOString(),total:rows.length,failed:rows.filter(r=>!r.pass).length,rows},null,1));
console.log('combos',rows.length,'failed',rows.filter(r=>!r.pass).length);
await b.close();
