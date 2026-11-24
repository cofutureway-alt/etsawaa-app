import React from "react";
import {createRoot} from "react-dom/client";
import {createBrowserRouter,RouterProvider,useLoaderData} from "react-router";
import {EmailStudio} from "~/features/email/EmailStudio";
import {EMAIL_CATALOG} from "~/lib/email/catalog";
import "~/styles/globals.css";
const lang=new URL(location.href).searchParams.get("lang")==="en"?"en":"ar";
document.documentElement.lang=lang;document.documentElement.dir=lang==="ar"?"rtl":"ltr";
const rows=EMAIL_CATALOG.map(t=>({...t,content_ar:t.content.ar,content_en:t.content.en,revision:2,version:2,is_active:true,draft_content:null,history:[{version:2,published_at:new Date().toISOString()}]}));
const versions=new Map(rows.map(r=>[r.key,new Map([[2,structuredClone({ar:r.content_ar,en:r.content_en})]])]));
window.__emailTests={lastTest:null};
const router=createBrowserRouter([{path:"*",loader:()=>({lang,templates:structuredClone(rows),providerConfigured:true}),action:async({request})=>{const f=await request.formData(),r=rows.find(t=>t.key===f.get("key")),intent=f.get("intent"),c=JSON.parse(f.get("content")||"null");
if(intent==="test"){window.__emailTests.lastTest=c;return{ok:true,message:"sent"};}
if(intent==="active"){r.is_active=f.get("active")==="1";r.revision++;return{ok:true,key:r.key,message:"activeSaved"};}
if(+f.get("revision")!==r.revision)return{ok:false,reason:"conflict"};
if(intent==="draft")r.draft_content=c;else{const next=intent==="restore"?versions.get(r.key).get(+f.get("restore_version")):c;r.content_ar=next.ar;r.content_en=next.en;r.draft_content=null;r.version++;versions.get(r.key).set(r.version,structuredClone(next));r.history.unshift({version:r.version,published_at:new Date().toISOString()});}r.revision++;return{ok:true,key:r.key,revision:r.revision,message:intent==="draft"?"saved":intent==="restore"?"restored":"published"};},Component:()=>{const d=useLoaderData();return <main style={{maxWidth:1540,margin:"0 auto",padding:24}}><EmailStudio {...d}/></main>;}}]);
createRoot(document.getElementById("root")).render(<RouterProvider router={router}/>);
