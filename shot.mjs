import puppeteer from "puppeteer-core";
const BASE="http://localhost:4110";
const url=process.env.SUPABASE_URL, anon=process.env.SUPABASE_ANON_KEY, svc=process.env.SUPABASE_SERVICE_ROLE_KEY;
const ref=process.env.SUPABASE_PROJECT_REF, token=process.env.SUPABASE_ACCESS_TOKEN;
const sqlRaw=async q=>(await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`,{method:"POST",headers:{Authorization:`Bearer ${token}`,"Content-Type":"application/json"},body:JSON.stringify({query:q})})).text();
const email=`shot_${Date.now()}@example.com`, pass="Probe!2345Aa";
const u=await (await fetch(`${url}/auth/v1/admin/users`,{method:"POST",headers:{apikey:svc,Authorization:`Bearer ${svc}`,"Content-Type":"application/json"},body:JSON.stringify({email,password:pass,email_confirm:true})})).json();
await new Promise(r=>setTimeout(r,900)); await sqlRaw(`update public.profiles set role='admin' where id='${u.id}'`);
const browser=await puppeteer.launch({executablePath:"C:/Program Files/Google/Chrome/Application/chrome.exe",headless:"new",args:["--no-sandbox"]});
const page=await browser.newPage();
await page.goto(`${BASE}/ar/auth/login`,{waitUntil:"networkidle2"});
await page.type('input[name="identifier"]', email); await page.type('input[name="password"]', pass);
await Promise.all([page.waitForNavigation({waitUntil:"networkidle2",timeout:30000}).catch(()=>{}), page.click('button[type="submit"]')]);
for (const [w,h,tag] of [[1280,900,"desk"],[390,844,"mob"]]) {
  await page.setViewport({width:w,height:h,deviceScaleFactor:1});
  for (const p of ["/ar/admin/coupons","/ar/admin/levels","/ar/admin/catalog/attributes","/ar/admin/zones"]) {
    await page.goto(BASE+p,{waitUntil:"networkidle2"});
    await new Promise(r=>setTimeout(r,700));
    const name = p.replace(/\//g,"_").slice(1);
    await page.screenshot({path:`H:/z etsawaa/_publish/.shots/${tag}-${name}.png`});
  }
}
await fetch(`${url}/auth/v1/admin/users/${u.id}`,{method:"DELETE",headers:{apikey:svc,Authorization:`Bearer ${svc}`}});
await browser.close();
console.log("done");
