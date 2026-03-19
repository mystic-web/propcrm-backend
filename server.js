require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const crypto   = require('crypto');
const axios    = require('axios');
const { initiateCall, getRecordingUrl, getCallDetails } = require('./exotel');

const app  = express();
const PORT = process.env.PORT || 5000;

// ─── In-memory store (replace with DB in production) ─────────────────────────
let leads = [];
let calls = [];   // call logs with recording URLs

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));  // Exotel sends form data

// ─── Helpers ─────────────────────────────────────────────────────────────────
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2,6); }

function verifyMetaSignature(req) {
  const sig = req.headers['x-hub-signature-256'];
  if (!sig || !process.env.META_APP_SECRET) return true;
  const expected = 'sha256=' + crypto.createHmac('sha256', process.env.META_APP_SECRET)
    .update(JSON.stringify(req.body)).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

async function fetchMetaLeadData(leadgenId) {
  try {
    const res = await axios.get(`https://graph.facebook.com/v18.0/${leadgenId}`, {
      params: { access_token: process.env.META_PAGE_ACCESS_TOKEN, fields: 'field_data,created_time,ad_name,form_id' }
    });
    return res.data;
  } catch (err) { console.error('Meta API error:', err.response?.data || err.message); return null; }
}

function parseMetaFields(fieldData = []) {
  const map = {};
  fieldData.forEach(f => { map[f.name.toLowerCase().replace(/\s+/g,'_')] = f.values?.[0] || ''; });
  return map;
}

function metaToCRMLead(metaData, rawFields) {
  const f = parseMetaFields(rawFields);
  return {
    id: uid(), name: f.full_name||f.name||(f.first_name+(f.last_name?' '+f.last_name:''))||'Unknown',
    mobile: f.phone_number||f.mobile||f.contact_number||'',
    email: f.email||'', project: f.project||f.property||metaData?.ad_name||'',
    budget: f.budget||'', source: 'Meta', status: 'New Lead', assign: '', followup: '', notes: `Meta Lead: ${metaData?.id||''}`,
    date: new Date().toISOString().split('T')[0],
    timeline: [{ t: 'Lead received from Meta Ads', d: new Date().toLocaleDateString('en-IN') }],
    metaLeadId: metaData?.id||'',
  };
}

// ─── EXOTEL WEBHOOK ───────────────────────────────────────────────────────────
// Exotel yahan POST karta hai jab call khatam ho
// Automatically recording URL milta hai + call log save hota hai
app.post('/webhook/exotel/status', async (req, res) => {
  res.sendStatus(200); // Exotel ko jaldi 200 dena zaroori hai

  const {
    CallSid, Status, Direction, From, To,
    RecordingUrl, RecordingDuration,
    StartTime, EndTime, Duration,
    CustomField,
  } = req.body;

  console.log(`📞 Exotel call ended | SID: ${CallSid} | Status: ${Status} | Duration: ${Duration}s`);

  // Parse custom field to get leadId
  let customData = {};
  try { customData = JSON.parse(CustomField || '{}'); } catch {}

  // Recording URL aane mein thoda time lagta hai — 5 sec wait karo
  let recordingUrl = RecordingUrl;
  let recordingDuration = RecordingDuration;

  if (!recordingUrl && CallSid) {
    await new Promise(r => setTimeout(r, 5000));
    const rec = await getRecordingUrl(CallSid);
    if (rec) { recordingUrl = rec.url; recordingDuration = rec.duration; }
  }

  // Determine client number (To field mein client ka number hota hai)
  const clientNumber = Direction === 'outbound-api' ? To : From;

  // Lead dhundho mobile number se
  const lead = customData.leadId
    ? leads.find(l => l.id === customData.leadId)
    : leads.find(l => l.mobile === clientNumber || l.mobile === clientNumber.replace(/^\+91/, ''));

  const callLog = {
    id:               uid(),
    callSid:          CallSid,
    leadId:           lead?.id || customData.leadId || '',
    leadName:         lead?.name || customData.leadName || 'Unknown',
    leadMobile:       clientNumber || '',
    project:          lead?.project || '',
    execName:         customData.execName || '',
    execMobile:       Direction === 'outbound-api' ? From : To,
    status:           Status,           // completed, no-answer, busy, failed
    duration:         parseInt(Duration) || 0,
    recordingUrl:     recordingUrl || null,
    recordingDuration:parseInt(recordingDuration) || 0,
    startTime:        StartTime,
    endTime:          EndTime,
    outcome:          mapStatusToOutcome(Status, parseInt(Duration)),
    notes:            '',
    fileName:         recordingUrl ? `call_${CallSid}.mp3` : null,
    timestamp:        new Date().toISOString(),
    source:           'exotel',
  };

  calls.unshift(callLog); // Latest pehle

  // Lead timeline update karo
  if (lead) {
    const timelineEntry = {
      t: `📞 Call ${callLog.outcome} (${callLog.duration}s)${recordingUrl ? ' — recording available' : ''}`,
      d: new Date().toLocaleDateString('en-IN'),
    };
    lead.timeline = [...(lead.timeline || []), timelineEntry];
    console.log(`✅ Call logged for lead: ${lead.name}`);
  }

  // Admin ko console pe dikhao
  console.log(`🎙 Recording: ${recordingUrl || 'NOT AVAILABLE'}`);
});

function mapStatusToOutcome(status, duration) {
  if (status === 'completed' && duration > 10) return 'Answered';
  if (status === 'completed' && duration <= 10) return 'Short Call';
  if (status === 'no-answer') return 'No Answer';
  if (status === 'busy') return 'Busy';
  if (status === 'failed') return 'Failed';
  return status || 'Unknown';
}

// ─── CLICK-TO-CALL API ────────────────────────────────────────────────────────
// Frontend yahan call karta hai jab sales person 📞 button dabata hai
app.post('/api/calls/initiate', async (req, res) => {
  const { leadId, execMobile, execName } = req.body;

  const lead = leads.find(l => l.id === leadId);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  if (!lead.mobile) return res.status(400).json({ error: 'Lead mobile number missing' });
  if (!execMobile) return res.status(400).json({ error: 'Executive mobile number required' });

  console.log(`📞 Initiating call: ${execName} (${execMobile}) → ${lead.name} (${lead.mobile})`);

  const result = await initiateCall(
    execMobile,
    lead.mobile,
    process.env.EXOTEL_CALLER_ID,
    { leadId: lead.id, leadName: lead.name, execName, execMobile }
  );

  if (!result.success) {
    return res.status(500).json({ error: 'Call initiation failed', details: result.error });
  }

  // Pending call log banao (webhook update karega baad mein)
  const pendingCall = {
    id: uid(), callSid: result.callSid, leadId: lead.id,
    leadName: lead.name, leadMobile: lead.mobile, project: lead.project,
    execName, execMobile, status: 'in-progress', duration: 0,
    recordingUrl: null, outcome: 'In Progress',
    timestamp: new Date().toISOString(), source: 'exotel',
  };
  calls.unshift(pendingCall);

  // Lead timeline
  lead.timeline = [...(lead.timeline||[]), {
    t: `📞 Call initiated by ${execName}`,
    d: new Date().toLocaleDateString('en-IN')
  }];

  res.json({ success: true, callSid: result.callSid, message: `Calling ${execName}... Client will be connected shortly` });
});

// ─── CALLS API ────────────────────────────────────────────────────────────────
app.get('/api/calls', (req, res) => {
  const { leadId, date, exec } = req.query;
  let result = [...calls];
  if (leadId) result = result.filter(c => c.leadId === leadId);
  if (date)   result = result.filter(c => c.timestamp.startsWith(date));
  if (exec)   result = result.filter(c => c.execName === exec);
  res.json({ success: true, total: result.length, calls: result });
});

app.put('/api/calls/:id', (req, res) => {
  const idx = calls.findIndex(c => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Call not found' });
  calls[idx] = { ...calls[idx], ...req.body };
  res.json({ success: true, call: calls[idx] });
});

app.delete('/api/calls/:id', (req, res) => {
  const idx = calls.findIndex(c => c.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  calls.splice(idx, 1);
  res.json({ success: true });
});

// ─── LEADS API ────────────────────────────────────────────────────────────────
app.get('/api/leads', (req, res) => {
  let result = [...leads];
  const { status, source, search } = req.query;
  if (status) result = result.filter(l => l.status === status);
  if (source) result = result.filter(l => l.source === source);
  if (search) result = result.filter(l => l.name.toLowerCase().includes(search.toLowerCase()) || l.mobile.includes(search));
  res.json({ success: true, total: result.length, leads: result });
});

app.post('/api/leads', (req, res) => {
  const lead = req.body;
  if (!lead.name || !lead.mobile) return res.status(400).json({ error: 'Name and mobile required' });
  const dup = leads.find(l => l.mobile === lead.mobile);
  if (dup) return res.status(409).json({ error: 'Duplicate mobile', existing: dup });
  const newLead = { id: uid(), ...lead, date: new Date().toISOString().split('T')[0], timeline: [{ t: 'Lead created', d: new Date().toLocaleDateString('en-IN') }] };
  leads.push(newLead);
  res.status(201).json({ success: true, lead: newLead });
});

app.put('/api/leads/:id', (req, res) => {
  const idx = leads.findIndex(l => l.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Lead not found' });
  leads[idx] = { ...leads[idx], ...req.body };
  res.json({ success: true, lead: leads[idx] });
});

app.delete('/api/leads/:id', (req, res) => {
  const idx = leads.findIndex(l => l.id === req.params.id);
  if (idx < 0) return res.status(404).json({ error: 'Not found' });
  leads.splice(idx, 1);
  res.json({ success: true });
});

app.get('/api/stats', (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  res.json({
    total: leads.length,
    byStatus: leads.reduce((a,l)=>{ a[l.status]=(a[l.status]||0)+1; return a; },{}),
    bySource: leads.reduce((a,l)=>{ a[l.source]=(a[l.source]||0)+1; return a; },{}),
    bookings: leads.filter(l=>l.status==='Booking Done').length,
    totalCalls: calls.length,
    todayCalls: calls.filter(c=>c.timestamp.startsWith(today)).length,
    callsAnswered: calls.filter(c=>c.outcome==='Answered').length,
  });
});

// ─── META WEBHOOK ─────────────────────────────────────────────────────────────
app.get('/webhook/meta', (req, res) => {
  if (req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===process.env.META_VERIFY_TOKEN)
    return res.status(200).send(req.query['hub.challenge']);
  res.sendStatus(403);
});

app.post('/webhook/meta', async (req, res) => {
  res.sendStatus(200);
  if (!verifyMetaSignature(req) || req.body.object !== 'page') return;
  for (const entry of req.body.entry||[]) {
    for (const change of entry.changes||[]) {
      if (change.field !== 'leadgen') continue;
      const leadgenId = change.value?.leadgen_id;
      if (!leadgenId) continue;
      const metaData = await fetchMetaLeadData(leadgenId);
      if (!metaData) continue;
      const crmLead = metaToCRMLead(metaData, metaData.field_data);
      if (crmLead.mobile && leads.find(l=>l.mobile===crmLead.mobile)) continue;
      leads.push(crmLead);
      console.log(`📥 Meta lead: ${crmLead.name}`);
    }
  }
});

// Test endpoints
app.post('/api/test/meta-lead', (req, res) => {
  const testLead = { id:uid(), name:req.body.name||'Test Lead', mobile:req.body.mobile||'9'+Math.floor(Math.random()*900000000+100000000), email:req.body.email||'test@test.com', project:req.body.project||'Test Project', budget:req.body.budget||'70 Lakhs', source:'Meta', status:'New Lead', assign:'', followup:'', notes:'Simulated Meta lead', date:new Date().toISOString().split('T')[0], timeline:[{t:'Test Meta lead created',d:new Date().toLocaleDateString('en-IN')}] };
  leads.push(testLead);
  res.status(201).json({ success:true, lead:testLead });
});

// Simulate Exotel webhook (for testing without real Exotel)
app.post('/api/test/exotel-call', (req, res) => {
  const lead = leads[0];
  if (!lead) return res.status(400).json({ error: 'No leads available' });
  const testCall = {
    id: uid(), callSid: 'TEST_'+uid(),
    leadId: lead.id, leadName: lead.name, leadMobile: lead.mobile,
    project: lead.project||'', execName: req.body.execName||'Priya Singh',
    execMobile: '9876500001', status: 'completed', duration: Math.floor(Math.random()*300+60),
    recordingUrl: null, // Real mein Exotel ka URL hoga
    recordingDuration: Math.floor(Math.random()*300+60),
    outcome: ['Answered','No Answer','Interested','Follow-up Required'][Math.floor(Math.random()*4)],
    notes: 'Simulated call for testing',
    timestamp: new Date().toISOString(), source: 'exotel',
    fileName: 'test_recording.mp3',
  };
  calls.unshift(testCall);
  lead.timeline = [...(lead.timeline||[]), { t:`📞 Test call — ${testCall.outcome} (${testCall.duration}s)`, d:new Date().toLocaleDateString('en-IN') }];
  console.log(`🧪 Test Exotel call: ${testCall.leadName} | ${testCall.outcome}`);
  res.status(201).json({ success:true, call:testCall });
});

app.listen(PORT, () => {
  console.log(`\n🚀 PropCRM Backend — http://localhost:${PORT}`);
  console.log(`   Exotel webhook  : POST /webhook/exotel/status`);
  console.log(`   Click-to-call   : POST /api/calls/initiate`);
  console.log(`   Meta webhook    : POST /webhook/meta`);
  console.log(`   Test call       : POST /api/test/exotel-call\n`);
});
