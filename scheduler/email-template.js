const escape = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const duties = {'AM/T':'AM Testing','AM/C':'AM Component processing','AM/L':'AM Labelling','AM/D':'AM Distribution','PM/T':'PM Testing','PM/C':'PM Component processing',AM:'AM duty',PM:'PM duty',MBD:'Mobile blood donation',OFF:'Day off',LEAVE:'Leave',OFFICE:'Office duty',TRAINING:'Training',CANCELLED:'Cancelled event — Needs reassignment'};
export function mailBody(job, config) {
 const p=job.payload, e=p.event;
 const date=new Intl.DateTimeFormat('en-PH',{timeZone:'UTC',dateStyle:'full'}).format(new Date(p.date+'T00:00:00Z'));
 const subject=`NMRBC — ${job.kind==='test'?'Test reminder':job.kind==='change'?'Schedule updated':'Your schedule'} — ${p.date}`;
 const lines=[`Hello ${p.name},`,`${job.kind==='test'?'TEST EMAIL — ':''}Your schedule for ${date}:`,
 `Assignment: ${duties[p.code] || p.code || 'Unassigned — please contact the schedule administrator.'}`];
 if(p.description) lines.push(`Details: ${p.description}`);
 if(e) {
  lines.push(`Event: ${e.title}`,`Venue: ${e.location}`,`Call time: ${String(e.call_time).slice(0,5)} Philippine time`);
  if(e.end_time) lines.push(`End time: ${String(e.end_time).slice(0,5)} Philippine time`);
  lines.push(`Event status: ${e.status}`);
  if(e.transport) lines.push(`Transport: ${e.transport}`);
  if(e.notes) lines.push(`Notes: ${e.notes}`);
 }
 lines.push('Schedules may change. Check the scheduler for the latest assignment.');
 let link='';
 if(config.url) {const u=new URL(config.url); if(u.protocol!=='https:') throw Error('Scheduler URL must use HTTPS'); link=u.href; lines.push(`View scheduler: ${link}`);}
 lines.push('To stop these reminders or correct your email, contact your schedule administrator.');
 return {from:config.from,to:[job.recipient],subject,text:lines.join('\n\n'),
 html:`<div style="font:16px/1.6 Arial,sans-serif;max-width:620px;margin:auto;color:#203139"><h2 style="color:#a12535">NMRBC Schedule${job.kind==='test'?' — Test':''}</h2>${lines.filter(l=>!l.startsWith('View scheduler:')).map(l=>`<p>${escape(l).replace(/\n/g,'<br>')}</p>`).join('')}${link?`<p><a href="${escape(link)}">View latest schedule</a></p>`:''}</div>`};
}
