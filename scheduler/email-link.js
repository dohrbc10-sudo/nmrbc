// Optional additive integration: load this after the existing config.js.
import { createClient } from './vendor/supabase.js';
const cfg=window.SCHEDULER_CONFIG||{};
if(cfg.supabaseUrl && cfg.supabasePublishableKey && !isSecret(cfg.supabasePublishableKey)) {
 const client=createClient(cfg.supabaseUrl,cfg.supabasePublishableKey);
 const link=document.createElement('a');link.href='./email-admin.html';link.textContent='Email reminders';link.className='button outline';link.hidden=true;
 (document.getElementById('addPersonnelButton')?.parentElement || document.querySelector('header')).append(link);
 let epoch=0;
 async function update(){const n=++epoch;link.hidden=true;const {data,error}=await client.rpc('scheduler_is_admin');if(n===epoch)link.hidden=!!error||data!==true;}
 client.auth.onAuthStateChange(()=>{epoch++;link.hidden=true;setTimeout(update,0);});update();
}

function isSecret(key){if(key.startsWith('sb_secret_'))return true;try{return key.split('.').length===3 && JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='service_role';}catch{return false;}}
