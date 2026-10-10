import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

const __dirname=path.dirname(fileURLToPath(import.meta.url));
// Load the project-root .env explicitly; Node does not load it automatically for this script.
dotenv.config({ path: path.resolve(__dirname, '../.env') });
const DATA=path.join(__dirname,'data.json');
const SECRET=process.env.JWT_SECRET||'queueless-hackathon-demo-secret-change-me';
const app=express(); app.use(cors()); app.use(express.json());
const initial={users:[{id:'u1',name:'Raj Soni',email:'citizen@demo.com',role:'citizen',passwordHash:bcrypt.hashSync('123456',10)},{id:'a1',name:'Officer Mehta',email:'admin@demo.com',role:'admin',passwordHash:bcrypt.hashSync('admin123',10)}],tokens:[{id:'tok1',token:'A-041',name:'Priya P.',service:'Aadhaar Update',status:'serving',eta:0,createdAt:Date.now()-3600000,officeId:'rajkot-central'},{id:'tok2',token:'A-042',name:'Rahul S.',service:'PAN Services',status:'waiting',eta:7,createdAt:Date.now()-1800000,officeId:'rajkot-central'},{id:'tok3',token:'A-043',name:'Neha R.',service:'Birth Certificate',status:'waiting',eta:14,createdAt:Date.now()-1500000,officeId:'rajkot-central'},{id:'tok4',token:'A-044',name:'Amit K.',service:'Property / Tax',status:'waiting',eta:21,createdAt:Date.now()-900000,officeId:'rajkot-central'},{id:'tok5',token:'A-045',name:'Missing citizen',service:'PAN Services',status:'missing',eta:28,createdAt:Date.now()-600000,officeId:'rajkot-central'}],workers:[{id:'w1',name:'Mehul Shah',role:'Counter 1',on:true},{id:'w2',name:'Riya Patel',role:'Counter 2',on:true},{id:'w3',name:'Dev Joshi',role:'Counter 3',on:true}],notifications:[]};
function db(){if(!fs.existsSync(DATA))fs.writeFileSync(DATA,JSON.stringify(initial,null,2));return JSON.parse(fs.readFileSync(DATA,'utf8'))} function save(x){fs.writeFileSync(DATA,JSON.stringify(x,null,2))}
function auth(req,res,next){try{const h=req.headers.authorization||'';if(!h.startsWith('Bearer '))throw 0;req.user=jwt.verify(h.slice(7),SECRET);next()}catch{res.status(401).json({error:'Authentication required'})}}
function publicUser(u){return{id:u.id,name:u.name,email:u.email,role:u.role}}
function officeClock(){const d=new Date();return d.getHours()*60+d.getMinutes()}
function isRecess(){const m=officeClock();return m>=750&&m<810}
function recessMinutesRemaining(){const m=officeClock();return m>=750&&m<810?810-m:0}
function baseQueueWait(waiting,workers){return Math.max(5,Math.ceil(waiting/Math.max(1,workers)*7))}
function estimatedQueueWait(waiting,workers){return baseQueueWait(waiting,workers)+recessMinutesRemaining()}
function recessError(res){return res.status(409).json({error:'Office recess is from 12:30 PM to 1:30 PM. Token calling resumes at 1:30 PM.',recess:true})}
app.get('/api/health',(req,res)=>res.json({ok:true,service:'QueueLess API',time:new Date().toISOString()}));
app.get('/api/office-status',(req,res)=>{const m=officeClock(),recess=m>=750&&m<810,bookingWindow=m>=600&&m<=1020;res.json({recess,bookingWindow,localTime:new Date().toLocaleTimeString(),recessStart:'12:30 PM',recessEnd:'1:30 PM',bookingStart:'10:00 AM',bookingEnd:'5:00 PM',message:recess?'Office recess is in progress. Tokens can still be booked; waiting estimates include the remaining break. Service resumes at 1:30 PM.':bookingWindow?'Office booking window is open.':'Token booking is available only from 10:00 AM to 5:00 PM.'})});
app.post('/api/auth/register',async(req,res)=>{const {name,email,password,role='citizen'}=req.body||{};if(!name||!email||!password)return res.status(400).json({error:'Name, email and password are required'});const d=db();if(d.users.some(u=>u.email.toLowerCase()===email.toLowerCase()))return res.status(409).json({error:'Account already exists'});const u={id:crypto.randomUUID(),name,email,role:role==='admin'?'citizen':role,passwordHash:await bcrypt.hash(password,10)};d.users.push(u);save(d);const token=jwt.sign({id:u.id,role:u.role,name:u.name},SECRET,{expiresIn:'8h'});res.json({token,user:publicUser(u)})});
app.post('/api/auth/login',async(req,res)=>{const {email,password}=req.body||{};const d=db(),u=d.users.find(x=>x.email.toLowerCase()===String(email||'').toLowerCase());if(!u||!(await bcrypt.compare(password||'',u.passwordHash)))return res.status(401).json({error:'Invalid email or password'});const token=jwt.sign({id:u.id,role:u.role,name:u.name},SECRET,{expiresIn:'8h'});res.json({token,user:publicUser(u)})});
app.get('/api/admins',auth,(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Administrator access required'});const d=db();res.json({admins:d.users.filter(u=>u.role==='admin').map(publicUser)})});
app.post('/api/admins',auth,async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Administrator access required'});const {name,email,password}=req.body||{};if(!name?.trim()||!email?.trim()||!password||password.length<6)return res.status(400).json({error:'Name, email and password (at least 6 characters) are required'});const d=db();if(d.users.some(u=>u.email.toLowerCase()===email.trim().toLowerCase()))return res.status(409).json({error:'An account with this email already exists'});const u={id:crypto.randomUUID(),name:name.trim(),email:email.trim(),role:'admin',passwordHash:await bcrypt.hash(password,10)};d.users.push(u);save(d);res.status(201).json({admin:publicUser(u),message:'Administrator account created successfully'})});
app.put('/api/admins/:id',auth,async(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Administrator access required'});const {name,email,password}=req.body||{};if(!name?.trim()||!email?.trim())return res.status(400).json({error:'Name and email are required'});if(password&&password.length<6)return res.status(400).json({error:'Password must be at least 6 characters'});const d=db(),u=d.users.find(x=>x.id===req.params.id&&x.role==='admin');if(!u)return res.status(404).json({error:'Administrator not found'});if(d.users.some(x=>x.id!==u.id&&x.email.toLowerCase()===email.trim().toLowerCase()))return res.status(409).json({error:'An account with this email already exists'});u.name=name.trim();u.email=email.trim();if(password)u.passwordHash=await bcrypt.hash(password,10);save(d);res.json({admin:publicUser(u),message:'Administrator updated successfully'})});
app.delete('/api/admins/:id',auth,(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Administrator access required'});if(req.user.id===req.params.id)return res.status(400).json({error:'You cannot delete the account you are currently using'});const d=db(),i=d.users.findIndex(x=>x.id===req.params.id&&x.role==='admin');if(i<0)return res.status(404).json({error:'Administrator not found'});if(d.users.filter(x=>x.role==='admin').length<=1)return res.status(400).json({error:'At least one administrator account must remain'});const [admin]=d.users.splice(i,1);save(d);res.json({admin:publicUser(admin),message:'Administrator deleted successfully'})});
app.get('/api/me',auth,(req,res)=>{const d=db();const u=d.users.find(x=>x.id===req.user.id);res.json({user:publicUser(u)})});
app.get('/api/offices',(req,res)=>res.json({offices:[{id:'rajkot-central',name:'Rajkot Municipal Office — Central Zone',area:'Dhebar Road, Rajkot',lat:22.3039,lng:70.8022,distance:1.8,open:true},{id:'rajkot-west',name:'Rajkot Municipal Office — West Zone',area:'Kalawad Road, Rajkot',lat:22.3031,lng:70.7706,distance:4.6,open:true},{id:'rajkot-east',name:'Rajkot Municipal Office — East Zone',area:'150 Feet Ring Road, Rajkot',lat:22.2937,lng:70.8335,distance:5.9,open:true}]}));
app.get('/api/services',(req,res)=>res.json({services:[{id:'aadhaar',name:'Aadhaar Update',desc:'Address, mobile & demographic updates',docs:['Aadhaar card','Address proof','Mobile number'],fee:'₹50'},{id:'pan',name:'PAN Services',desc:'Correction, address or personal details',docs:['PAN card','Aadhaar card','Supporting proof'],fee:'₹110'},{id:'birth',name:'Birth Certificate',desc:'New certificate or correction request',docs:['Hospital record','Parent ID proof','Application form'],fee:'₹20'},{id:'property',name:'Property / Tax',desc:'Municipal property and tax services',docs:['Property ID','Owner ID','Latest tax receipt'],fee:'Varies'},{id:'income',name:'Income / Caste Certificate',desc:'Application and verification assistance',docs:['Aadhaar card','Income proof','Residence proof'],fee:'₹20'},{id:'other',name:'Other Municipal Service',desc:'Get guidance for the right counter',docs:['Valid ID','Relevant supporting document'],fee:'Depends'}]}));
app.get('/api/queue/:officeId',auth,(req,res)=>{const d=db();const workers=d.workers.filter(w=>w.on).length;const tokens=d.tokens.filter(t=>t.officeId===req.params.officeId&&['waiting','serving','missing'].includes(t.status));const waiting=tokens.filter(t=>t.status==='waiting').length;const eta=estimatedQueueWait(waiting,workers);res.json({tokens,workers:d.workers,activeWorkers:workers,waiting,eta,recess:isRecess(),recessMinutesRemaining:recessMinutesRemaining(),capacityPerRound:workers,nowServing:tokens.find(t=>t.status==='serving')||null})});

const SERVICE_FEES = {
  'Aadhaar Update': 50,
  'PAN Services': 110,
  'Birth Certificate': 20,
  'Income / Caste Certificate': 20
};
function razorpayConfigured(){return Boolean(process.env.RAZORPAY_KEY_ID&&process.env.RAZORPAY_KEY_SECRET)}
function feeForService(service){return SERVICE_FEES[service] ?? null}
function makeToken(d, user, {officeId,service,name='Citizen',paymentMethod='office',paymentStatus='pay_at_office',paymentId=null,amount=null}){
  const workers=d.workers.filter(w=>w.on).length;
  const officeTokens=d.tokens.filter(t=>t.officeId===officeId&&['waiting','serving','missing'].includes(t.status));
  const waiting=officeTokens.filter(t=>t.status==='waiting').length;
  const eta=estimatedQueueWait(waiting,workers);
  const num=officeTokens.length?Math.max(...officeTokens.map(t=>Number(t.token.split('-')[1])||0))+1:41;
  const tok={id:crypto.randomUUID(),token:`A-${String(num).padStart(3,'0')}`,name,service,status:'waiting',eta,createdAt:Date.now(),officeId,userId:user.id,bookedDuringRecess:isRecess(),recessDelayMinutes:recessMinutesRemaining(),paymentMethod,paymentStatus,paymentId,amount};
  d.tokens.push(tok);
  d.notifications.unshift({id:crypto.randomUUID(),userId:user.id,title:'Token confirmed',message:`${tok.token} booked successfully. Estimated wait ${eta} min.${paymentMethod==='razorpay'?' Online payment verified.':' Pay the service fee at the office.'}`,time:Date.now(),read:false});
  return {token:tok,qrPayload:`QUEUELESS|${tok.id}|${tok.token}|${officeId}`};
}
app.post('/api/payments/order',auth,async(req,res)=>{
  if(req.user.role!=='citizen')return res.status(403).json({error:'Citizen account required'});
  if(!razorpayConfigured())return res.status(503).json({error:'Online payment is not configured yet. Choose Pay at office, or ask the administrator to configure Razorpay keys.'});
  const {officeId,service}=req.body||{};
  if(!officeId||!service)return res.status(400).json({error:'Office and service are required'});
  const mins=officeClock();if(mins<600||mins>1020)return res.status(400).json({error:'Token booking is available only from 10:00 AM to 5:00 PM.'});
  const amount=feeForService(service);
  if(amount===null)return res.status(400).json({error:'This service has a variable fee and cannot be paid online in this demo. Choose Pay at office.'});
  try{
    const receipt=`ql_${crypto.randomUUID().replace(/-/g,'').slice(0,20)}`;
    const authHeader=Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
    const rr=await fetch('https://api.razorpay.com/v1/orders',{method:'POST',headers:{Authorization:`Basic ${authHeader}`,'Content-Type':'application/json'},body:JSON.stringify({amount:amount*100,currency:'INR',receipt,notes:{userId:req.user.id,officeId,service}})});
    const order=await rr.json();
    if(!rr.ok)return res.status(502).json({error:order.error?.description||'Unable to create Razorpay order'});
    const d=db();d.payments=d.payments||[];
    d.payments.push({orderId:order.id,userId:req.user.id,officeId,service,amount:amount*100,currency:'INR',status:'created',createdAt:Date.now()});save(d);
    res.json({orderId:order.id,amount:order.amount,currency:order.currency,keyId:process.env.RAZORPAY_KEY_ID,service});
  }catch(e){res.status(502).json({error:'Could not connect to Razorpay. Please try again or choose Pay at office.'})}
});
app.post('/api/payments/verify',auth,async(req,res)=>{
  if(!razorpayConfigured())return res.status(503).json({error:'Razorpay is not configured'});
  const {razorpay_order_id,razorpay_payment_id,razorpay_signature,officeId,service,name}=req.body||{};
  if(!razorpay_order_id||!razorpay_payment_id||!razorpay_signature)return res.status(400).json({error:'Payment verification details are incomplete'});
  const d=db();d.payments=d.payments||[];
  const payment=d.payments.find(p=>p.orderId===razorpay_order_id&&p.userId===req.user.id);
  if(!payment)return res.status(404).json({error:'Payment order not found for this account'});
  if(payment.status==='paid'&&payment.tokenId){const existing=d.tokens.find(t=>t.id===payment.tokenId);if(existing)return res.json({token:existing,qrPayload:`QUEUELESS|${existing.id}|${existing.token}|${existing.officeId}`,alreadyProcessed:true})}
  const expected=crypto.createHmac('sha256',process.env.RAZORPAY_KEY_SECRET).update(`${razorpay_order_id}|${razorpay_payment_id}`).digest('hex');
  const a=Buffer.from(expected),b=Buffer.from(String(razorpay_signature));
  if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return res.status(400).json({error:'Payment signature verification failed'});
  try{
    const authHeader=Buffer.from(`${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`).toString('base64');
    const pr=await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(razorpay_payment_id)}`,{headers:{Authorization:`Basic ${authHeader}`}});
    const rp=await pr.json();
    if(!pr.ok||rp.order_id!==razorpay_order_id||rp.status!=='captured'||rp.amount!==payment.amount||rp.currency!=='INR')return res.status(400).json({error:'Razorpay has not confirmed a captured payment. Please check payment status before retrying.'});
    if(payment.officeId!==officeId||payment.service!==service)return res.status(400).json({error:'The paid order does not match the selected office or service'});
    const result=makeToken(d,req.user,{officeId:payment.officeId,service:payment.service,name:name||req.user.name,paymentMethod:'razorpay',paymentStatus:'paid',paymentId:razorpay_payment_id,amount:payment.amount});
    payment.status='paid';payment.paymentId=razorpay_payment_id;payment.tokenId=result.token.id;payment.paidAt=Date.now();save(d);
    return res.status(201).json(result);
  }catch(e){return res.status(502).json({error:'Could not verify payment with Razorpay. If money was deducted, contact the office with your payment ID.'})}
});

app.post('/api/tokens',auth,(req,res)=>{
  if(req.user.role!=='citizen')return res.status(403).json({error:'Citizen account required'});
  const {officeId,service,name='Citizen',paymentMethod='office'}=req.body||{};
  const mins=officeClock();if(mins<600||mins>1020)return res.status(400).json({error:'Token booking is available only from 10:00 AM to 5:00 PM.'});
  if(paymentMethod!=='office')return res.status(400).json({error:'For online payment, complete the Razorpay checkout first.'});
  if(!officeId||!service)return res.status(400).json({error:'Office and service are required'});
  const d=db();const fee=feeForService(service);
  const result=makeToken(d,req.user,{officeId,service,name,paymentMethod:'office',paymentStatus:'pay_at_office',amount:fee===null?null:fee*100});
  save(d);res.status(201).json(result);
});
app.post('/api/tokens/next/call',auth,(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Officer access required'});if(isRecess())return recessError(res);const d=db();const old=d.tokens.find(t=>t.status==='serving');if(old){old.status='done';old.completedAt=Date.now();old.serviceMinutes=Math.max(4,Math.round((Date.now()-(old.calledAt||old.createdAt))/60000))}const next=d.tokens.find(t=>t.status==='waiting');if(!next)return res.json({message:'No waiting token',next:null});next.status='serving';next.eta=0;next.calledAt=Date.now();d.notifications.unshift({id:crypto.randomUUID(),title:'Token called',message:`${next.token} is now being served.`,time:Date.now(),read:false});save(d);res.json({next})});
app.post('/api/tokens/:id/call',auth,(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Officer access required'});if(isRecess())return recessError(res);const d=db();const old=d.tokens.find(t=>t.status==='serving');if(old){old.status='done';old.completedAt=Date.now();old.serviceMinutes=Math.max(4,Math.round((Date.now()-(old.calledAt||old.createdAt))/60000))}const next=d.tokens.find(t=>t.status==='waiting');if(!next)return res.json({message:'No waiting token',next:null});next.status='serving';next.eta=0;next.calledAt=Date.now();d.notifications.unshift({id:crypto.randomUUID(),title:'Token called',message:`${next.token} is now being served.`,time:Date.now(),read:false});save(d);res.json({next})});
app.post('/api/tokens/skip-missing',auth,(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Officer access required'});if(isRecess())return recessError(res);const d=db();const m=d.tokens.find(t=>t.status==='missing');if(m)m.status='skipped';const next=d.tokens.find(t=>t.status==='waiting');if(next){next.status='serving';next.eta=0}save(d);res.json({skipped:m?.token||null,promoted:next||null})});
app.post('/api/workers',auth,(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Officer access required'});const {name,role}=req.body||{};if(!name?.trim()||!role?.trim())return res.status(400).json({error:'Worker name and counter/role are required'});const d=db();const worker={id:crypto.randomUUID(),name:name.trim(),role:role.trim(),on:true};d.workers.push(worker);save(d);res.status(201).json({worker,activeWorkers:d.workers.filter(w=>w.on).length,message:'Worker added successfully'})});
app.post('/api/workers/:id/toggle',auth,(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Officer access required'});const d=db(),w=d.workers.find(x=>x.id===req.params.id);if(!w)return res.status(404).json({error:'Worker not found'});w.on=!w.on;save(d);res.json({worker:w,activeWorkers:d.workers.filter(x=>x.on).length})});
app.put('/api/workers/:id',auth,(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Officer access required'});const {name,role}=req.body||{};if(!name?.trim()||!role?.trim())return res.status(400).json({error:'Worker name and counter/role are required'});const d=db(),w=d.workers.find(x=>x.id===req.params.id);if(!w)return res.status(404).json({error:'Worker not found'});w.name=name.trim();w.role=role.trim();save(d);res.json({worker:w,message:'Worker updated successfully'})});
app.delete('/api/workers/:id',auth,(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Officer access required'});const d=db(),i=d.workers.findIndex(x=>x.id===req.params.id);if(i<0)return res.status(404).json({error:'Worker not found'});const [worker]=d.workers.splice(i,1);save(d);res.json({worker,activeWorkers:d.workers.filter(w=>w.on).length,message:'Worker deleted successfully'})});
app.get('/api/notifications',auth,(req,res)=>{const d=db();res.json({notifications:d.notifications.filter(n=>!n.userId||n.userId===req.user.id).slice(0,20)})});

// Attendance confirmation / no-show prevention. Demo reminders are stored in-app; external SMS/email is not configured.
app.get('/api/attendance',auth,(req,res)=>{const d=db();const tokens=d.tokens.filter(t=>t.userId===req.user.id&&['waiting','serving'].includes(t.status)).map(t=>({id:t.id,token:t.token,service:t.service,officeId:t.officeId,status:t.status,attendanceStatus:t.attendanceStatus||'Needs confirmation',confirmedAt:t.confirmedAt||null,arrivalNote:t.arrivalNote||''}));res.json({tokens,gracePeriodMinutes:10})});
app.post('/api/attendance/:id',auth,(req,res)=>{const allowed=['Coming','Running late','Cancelled'];const status=req.body?.status;if(!allowed.includes(status))return res.status(400).json({error:'Choose Coming, Running late, or Cancelled'});const d=db();const t=d.tokens.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!t)return res.status(404).json({error:'Your active token was not found'});if(!['waiting','serving'].includes(t.status))return res.status(409).json({error:'Attendance can only be updated for an active token'});t.attendanceStatus=status;t.confirmedAt=Date.now();t.arrivalNote=String(req.body?.note||'').slice(0,160);if(status==='Cancelled'){t.status='cancelled';d.slotWaitlist=d.slotWaitlist||[];d.slotWaitlist.push({id:crypto.randomUUID(),userId:req.user.id,name:req.user.name,officeId:t.officeId,service:t.service,createdAt:Date.now(),status:'waiting'});d.recoveredSlots=d.recoveredSlots||[];d.recoveredSlots.push({id:crypto.randomUUID(),officeId:t.officeId,service:t.service,sourceTokenId:t.id,createdAt:Date.now(),claimed:false});}d.notifications.unshift({id:crypto.randomUUID(),userId:req.user.id,title:'Attendance updated',message:status==='Cancelled'?'Appointment cancelled and slot released to recovery.':status==='Running late'?'Late arrival noted. Please contact the office if you exceed its grace period.':'Attendance confirmed. We look forward to seeing you.',time:Date.now(),read:false});save(d);res.json({ok:true,status,token:t.token,message:status==='Cancelled'?'Appointment cancelled and slot added to recovery.':status==='Running late'?'Marked as running late. Office grace-period policy applies.':'Attendance confirmed.'})});

// Slot recovery: citizens can cancel their own waiting token and join a standby list.
app.post('/api/tokens/:id/cancel',auth,(req,res)=>{const d=db();const t=d.tokens.find(x=>x.id===req.params.id&&x.userId===req.user.id);if(!t)return res.status(404).json({error:'Your token was not found'});if(t.status!=='waiting')return res.status(409).json({error:'Only waiting tokens can be cancelled'});t.status='cancelled';d.slotWaitlist=d.slotWaitlist||[];const entry={id:crypto.randomUUID(),userId:req.user.id,name:req.user.name,officeId:t.officeId,service:t.service,createdAt:Date.now(),status:'waiting'};d.slotWaitlist.push(entry);d.recoveredSlots=d.recoveredSlots||[];d.recoveredSlots.push({id:crypto.randomUUID(),officeId:t.officeId,service:t.service,sourceTokenId:t.id,createdAt:Date.now(),claimed:false});save(d);res.json({message:'Token cancelled. You have been added to the standby list for a recovered slot.',waitlistEntry:entry})});
app.get('/api/slots/standby',auth,(req,res)=>{const d=db();res.json({entries:(d.slotWaitlist||[]).filter(x=>x.userId===req.user.id&&x.status==='waiting')})});
app.post('/api/slots/claim',auth,(req,res)=>{const d=db();const entry=(d.slotWaitlist||[]).find(x=>x.id===req.body?.entryId&&x.userId===req.user.id&&x.status==='waiting');if(!entry)return res.status(404).json({error:'Standby request not found'});d.recoveredSlots=d.recoveredSlots||[];const slot=d.recoveredSlots.find(x=>!x.claimed&&x.officeId===entry.officeId&&x.service===entry.service);if(!slot)return res.status(409).json({error:'No recovered slot is available for this service yet. Please try again shortly.'});slot.claimed=true;entry.status='claimed';const made=makeToken(d,{id:req.user.id,name:req.user.name},{officeId:entry.officeId,service:entry.service,name:req.user.name,paymentMethod:'office',paymentStatus:'pay_at_office'});save(d);res.json({token:made.token,qrPayload:made.qrPayload,message:'Recovered slot claimed. Pay at the office.'})});
// Grievance tracker: citizens submit and track cases; officers can review/update them.
app.get('/api/grievances',auth,(req,res)=>{const d=db();const all=d.grievances||[];res.json({grievances:all.filter(g=>req.user.role==='admin'||g.userId===req.user.id).sort((a,b)=>b.createdAt-a.createdAt)})});
app.post('/api/grievances',auth,(req,res)=>{const {category,subject,description}=req.body||{};if(!category||!subject?.trim()||!description?.trim())return res.status(400).json({error:'Category, subject and description are required'});if(subject.length>120||description.length>1500)return res.status(400).json({error:'Subject or description is too long'});const d=db();d.grievances=d.grievances||[];const g={id:crypto.randomUUID(),reference:'GR-'+String(Date.now()).slice(-7),userId:req.user.id,userName:req.user.name,category,subject:subject.trim(),description:description.trim(),status:'Submitted',createdAt:Date.now(),updates:[]};d.grievances.push(g);save(d);res.status(201).json({grievance:g})});
app.patch('/api/grievances/:id',auth,(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Officer access required'});const d=db();const g=(d.grievances||[]).find(x=>x.id===req.params.id);if(!g)return res.status(404).json({error:'Grievance not found'});const allowed=['Submitted','In Review','Resolved','Rejected'];if(!allowed.includes(req.body?.status))return res.status(400).json({error:'Invalid grievance status'});g.status=req.body.status;g.updates.push({status:g.status,note:String(req.body.note||'Status updated by officer').slice(0,300),time:Date.now()});save(d);res.json({grievance:g})});
// Transparent forecast based on current queue and stored completed tokens; no external AI service required.
app.get('/api/forecast/:officeId',auth,(req,res)=>{const d=db();const officeId=req.params.officeId;const all=d.tokens.filter(t=>t.officeId===officeId);const active=all.filter(t=>['waiting','serving','missing'].includes(t.status));const workers=d.workers.filter(w=>w.on).length;const waiting=active.filter(t=>t.status==='waiting').length;const recentDone=all.filter(t=>t.status==='done'&&t.completedAt).slice(-20);const avgService=recentDone.length?Math.max(4,Math.round(recentDone.reduce((n,t)=>n+(t.serviceMinutes||7),0)/recentDone.length)):7;const base=Math.max(5,Math.ceil(waiting/Math.max(1,workers)*avgService));const load=Math.min(100,Math.round(waiting/Math.max(1,workers*4)*100));const band=base<=10?'Low':base<=25?'Moderate':'High';const hours=[{label:'10–11 AM',load:28},{label:'11 AM–12 PM',load:52},{label:'12–1 PM',load:84},{label:'1–2 PM',load:67},{label:'2–3 PM',load:42},{label:'3–4 PM',load:36},{label:'4–5 PM',load:24}];res.json({officeId,generatedAt:Date.now(),waiting,activeWorkers:workers,averageServiceMinutes:avgService,estimatedWaitMinutes:base+recessMinutesRemaining(),load,loadBand:band,confidence:recentDone.length>=5?'Improving with completed-visit data':'Demo estimate; confidence improves as completed visits are recorded',busyPeriods:hours.filter(x=>x.load>=60),hourly:hours,method:'Queue length ÷ active counters × average service duration, plus office recess delay.'})});

app.get('/api/analytics',auth,(req,res)=>{if(req.user.role!=='admin')return res.status(403).json({error:'Officer access required'});const d=db();const completed=d.tokens.filter(t=>t.status==='done').length;const waiting=d.tokens.filter(t=>t.status==='waiting').length;const served=d.tokens.filter(t=>['done','serving'].includes(t.status)).length;res.json({kpis:{todayTokens:d.tokens.length,waiting,completed,activeWorkers:d.workers.filter(w=>w.on).length,serviceRate:Math.min(100,Math.round((served/Math.max(1,d.tokens.length))*100))},hourly:[{hour:'10 AM',tokens:4},{hour:'11 AM',tokens:7},{hour:'12 PM',tokens:9},{hour:'1 PM',tokens:6},{hour:'2 PM',tokens:3}],services:[{name:'Aadhaar',value:32},{name:'PAN',value:24},{name:'Birth',value:18},{name:'Property',value:14},{name:'Certificates',value:12}]})});
app.post('/api/notifications/test',auth,(req,res)=>{const d=db();d.notifications.unshift({id:crypto.randomUUID(),userId:req.user.id,title:'QueueLess smart reminder',message:req.body?.message||'Your turn is approaching. Please start travelling to the office.',time:Date.now(),read:false});save(d);res.json({ok:true})});
app.use(express.static(path.join(__dirname,'..','dist')));
// Vercel imports this Express app as a serverless function. Keep app.listen for local development only.
if (!process.env.VERCEL) {
  app.listen(process.env.PORT || 4000, () => console.log(`QueueLess API running on http://localhost:${process.env.PORT || 4000}`));
}

export default app;
