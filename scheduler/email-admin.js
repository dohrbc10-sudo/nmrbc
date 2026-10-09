import { createClient } from './vendor/supabase.js';
import { mailBody } from './email-template.js';
const $=id=>document.getElementById(id), config=window.SCHEDULER_CONFIG||{};
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let client,snapshot,epoch=0,busy=false;
function message(v){$('message').textContent=v;}
function clearPrivate(){epoch++;snapshot=null;$('privatePanel').hidden=true;$('contacts').replaceChildren();$('log').replaceChildren();$('preview').replaceChildren();$('previewDialog').close();}
async function rpc(name,args={}){const {data,error}=await client.rpc(name,args);if(error) throw Error(error.message);return data;}
function renderContacts(){
 const filter=$('search').value.toLowerCase();
 $('contacts').innerHTML=snapshot.contacts.filter(c=>c.name.toLowerCase().includes(filter)).map(c=>`<article class="contact"><div><h3>${h(c.name)}</h3><p class="muted">${c.active?'Active':'Archived · reminders paused'}</p></div><form data-person="${h(c.personnel_id)}"><label>Email address for ${h(c.name)}<input type="email" name="email" maxlength="254" autocomplete="off" value="${h(c.email)}"></label><label class="check"><input name="enabled" type="checkbox" ${c.enabled?'checked':''} ${!c.active?'disabled':''}>Reminders enabled</label><div class="actions"><button>Save contact</button><button class="outline" type="button" data-preview="${h(c.personnel_id)}">Preview tomorrow</button></div></form></article>`).join('') || '<p>No staff match your search.</p>';
}
function render(){
 const cfg=snapshot.settings,f=$('settingsForm');f.elements.enabled.checked=cfg.enabled;f.elements.time.value=cfg.reminder_time.slice(0,5);f.elements.changes.checked=cfg.change_notices;f.elements.off.checked=cfg.include_off_leave;
 $('workerStatus').textContent=cfg.last_run_at?`Last background check: ${new Intl.DateTimeFormat('en-PH',{timeZone:'Asia/Manila',dateStyle:'medium',timeStyle:'short'}).format(new Date(cfg.last_run_at))} PHT`:'No background check recorded yet.';
 renderContacts();
 $('log').innerHTML=snapshot.log.map(j=>`<tr><td>${h(j.name||'Admin test')}</td><td>${h(j.work_date)}</td><td>${h(j.kind)}</td><td><span class="badge">${h(j.status)}</span></td><td>${h(j.attempts)}</td><td>${h(j.error||j.provider_id||'Waiting for background job')}</td></tr>`).join('') || '<tr><td colspan="6">No messages queued yet.</td></tr>';
 $('privatePanel').hidden=false;$('loginPanel').hidden=true;
}
async function load(){
 const token=++epoch;
 try {
  const {data:{session}}=await client.auth.getSession();
  if(token!==epoch)return;
  if(!session){clearPrivate();$('loginPanel').hidden=false;message('Sign in with an approved scheduler administrator account.');return;}
  const data=await rpc('scheduler_email_admin_snapshot'); if(token!==epoch)return;
  snapshot=data;render();
 }catch(e){if(token!==epoch)return;clearPrivate();$('loginPanel').hidden=false;message(/does not exist|schema cache/i.test(e.message)?'Email reminders are not installed in this Supabase project yet. Follow the installation guide.':e.message);}
}
async function action(button,fn,success){
 if(busy)return;busy=true;button.disabled=true;
 const token=epoch;
 try{await fn();if(token!==epoch)return;await load();if(snapshot)message(success);}catch(e){if(token===epoch)message(e.message);}finally{busy=false;button.disabled=false;}
}
$('loginForm').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;await action(f.querySelector('button'),async()=>{const {error}=await client.auth.signInWithPassword({email:f.elements.email.value.trim(),password:f.elements.password.value});f.elements.password.value='';if(error)throw Error(error.message);},'Signed in.');};
$('settingsForm').onsubmit=e=>{e.preventDefault();if(!snapshot)return;const f=e.currentTarget;action(f.querySelector('button'),()=>rpc('scheduler_email_save_settings',{p_enabled:f.elements.enabled.checked,p_time:f.elements.time.value,p_changes:f.elements.changes.checked,p_off:f.elements.off.checked,p_expected:snapshot.settings.version}),'Preferences saved.');};
$('contacts').onsubmit=e=>{e.preventDefault();if(!snapshot)return;const f=e.target,c=snapshot.contacts.find(c=>c.personnel_id===f.dataset.person);action(f.querySelector('button'),()=>rpc('scheduler_email_save_contact',{p_person:c.personnel_id,p_email:f.elements.email.value.trim(),p_enabled:f.elements.enabled.checked,p_expected:c.version}),'Contact saved.');};
$('contacts').onclick=async e=>{const b=e.target.closest('[data-preview]');if(!b||!snapshot)return;const token=epoch;b.disabled=true;try{const payload=await rpc('scheduler_email_preview',{p_person:b.dataset.preview});if(token!==epoch)return;if(!payload)throw Error('Personnel record not found.');const body=mailBody({kind:'daily',payload,recipient:'preview@example.test'},{from:'preview',url:location.protocol==='https:'?new URL('./index.html',location.href).href:''});$('preview').innerHTML=body.html;$('previewDialog').showModal();}catch(e){if(token===epoch)message(e.message);}finally{b.disabled=false;}};
$('closePreview').onclick=()=>$('previewDialog').close();$('search').oninput=()=>{if(snapshot)renderContacts();};
$('refresh').onclick=()=>{if(busy)return;message('Refreshing…');load().then(()=>{if(snapshot)message('Updated.');});};
$('testButton').onclick=()=>action($('testButton'),()=>rpc('scheduler_email_test'),'Test queued for your admin email. The next background check will send it.');
$('logout').onclick=async()=>{clearPrivate();const {error}=await client.auth.signOut();if(error)message(error.message);else{$('loginPanel').hidden=false;message('Signed out.');}};
async function init(){
 if(!config.supabaseUrl||!config.supabasePublishableKey){message('Configure the scheduler’s Supabase connection before using email reminders.');return;}
 if(isSecret(config.supabasePublishableKey)){message('Use only the scheduler publishable key in config.js.');return;}
 client=createClient(config.supabaseUrl,config.supabasePublishableKey);
 client.auth.onAuthStateChange(event=>{if(event==='TOKEN_REFRESHED')return;clearPrivate();setTimeout(()=>load(),0);});
 await load();
}init();

function isSecret(key){if(key.startsWith('sb_secret_'))return true;try{return key.split('.').length===3 && JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).role==='service_role';}catch{return false;}}
