import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const b=await puppeteer.launch({headless:'new',executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--no-sandbox']});
const out={generatedAt:new Date().toISOString(),panels:{}};
// create throwaway admin + vendor via admin API, sign in through the real form, measure, delete
const { createClient }=await import('@supabase/supabase-js');
const svc=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const stamp=Date.now();
const mk=async(email,role)=>{
  const {data,error}=await svc.auth.admin.createUser({email,password:'Panel#12345',email_confirm:true,user_metadata:{full_name:email.split('@')[0],phone_e164:'+201'+(role==='admin'?'1':'2')+String(stamp).slice(-8)}});
  if(error) throw new Error(error.message);
  if(role!=='customer') await svc.from('profiles').update({role}).eq('id',data.user.id);
  return data.user.id;
};
const ids=[];
for(const [name,role,path] of [['admin','admin','/ar/admin'],['vendor','vendor','/ar/vendor']]){
  const email=`panel-${name}-${stamp}@etsawaa-e2e.com`;
  ids.push(await mk(email,role));
  const res={email,widths:{}};
  for(const w of [320,390,768,1024,1440]){
    const p=await b.newPage(); await p.setViewport({width:w,height:900});
    await p.goto('http://localhost:3000/ar/auth/login',{waitUntil:'networkidle2'});
    await p.type('input[name=identifier]',email); await p.type('input[name=password]','Panel#12345');
    await p.click('button[type=submit]'); await new Promise(r=>setTimeout(r,3000));
    await p.goto('http://localhost:3000'+path,{waitUntil:'networkidle2'});
    await new Promise(r=>setTimeout(r,500));
    res.widths[w]=await p.evaluate(()=>{
      const a=document.querySelector('aside'); const img=a?.querySelector('img');
      const m=document.querySelector('main');
      return {overflow:document.documentElement.scrollWidth-window.innerWidth,
        asideW:a?Math.round(a.getBoundingClientRect().width):0,
        logo:img?`${Math.round(img.getBoundingClientRect().width)}x${Math.round(img.getBoundingClientRect().height)}`:null,
        gapRightOfAside:a&&m?Math.round(Math.abs(m.getBoundingClientRect().right-(window.innerWidth-a.getBoundingClientRect().width))):null,
        hamburger:!!document.querySelector('header button[aria-haspopup=dialog]'),
        navLinks:a?a.querySelectorAll('a').length:0};
    });
    if(w===390) await p.screenshot({path:`evidence/phase-01/screens/sidebar-${name}-390.png`});
    if(w===1440) await p.screenshot({path:`evidence/phase-01/screens/sidebar-${name}-1440.png`});
    await p.close();
  }
  out.panels[name]=res;
}
// mobile drawer check
const p=await b.newPage(); await p.setViewport({width:390,height:844});
await p.goto('http://localhost:3000/ar/auth/login',{waitUntil:'networkidle2'});
await p.type('input[name=identifier]',out.panels.admin.email); await p.type('input[name=password]','Panel#12345');
await p.click('button[type=submit]'); await new Promise(r=>setTimeout(r,3000));
await p.goto('http://localhost:3000/ar/admin',{waitUntil:'networkidle2'}); await new Promise(r=>setTimeout(r,500));
await p.click('header button[aria-haspopup=dialog]'); await new Promise(r=>setTimeout(r,700));
out.drawer=await p.evaluate(()=>{const d=document.querySelector('[aria-modal=true]');
  const head=d?.firstElementChild; const logo=head?.querySelector('img');
  return {open:!!d,width:d?Math.round(d.getBoundingClientRect().width):0,links:d?d.querySelectorAll('a').length:0,
    headerLogo:logo?`${Math.round(logo.getBoundingClientRect().width)}x${Math.round(logo.getBoundingClientRect().height)}`:null,
    headerBg:head?getComputedStyle(head).backgroundColor:null,
    headerH:head?Math.round(head.getBoundingClientRect().height):0};});
await p.screenshot({path:'evidence/phase-01/screens/sidebar-admin-drawer-390.png'});
await p.close();
for(const id of ids) await svc.auth.admin.deleteUser(id);
const {data:users}=await svc.auth.admin.listUsers(); out.usersRemaining=users.users.length;
fs.writeFileSync('evidence/phase-01/sidebar-checks.json',JSON.stringify(out,null,1));
console.log(JSON.stringify(out,null,1));
await b.close();
