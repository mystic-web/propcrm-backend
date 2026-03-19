const axios = require('axios');

// ─── Exotel Config (from .env) ────────────────────────────────────────────────
const EXOTEL_SID          = process.env.EXOTEL_SID;           // Account SID
const EXOTEL_API_KEY      = process.env.EXOTEL_API_KEY;        // API Key
const EXOTEL_API_TOKEN    = process.env.EXOTEL_API_TOKEN;      // API Token
const EXOTEL_CALLER_ID    = process.env.EXOTEL_CALLER_ID;      // Virtual number (ExoPhone)
const EXOTEL_SUBDOMAIN    = process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com';

// Base URL for Exotel API
const EXOTEL_BASE = `https://${EXOTEL_API_KEY}:${EXOTEL_API_TOKEN}@${EXOTEL_SUBDOMAIN}/v1/Accounts/${EXOTEL_SID}`;

/**
 * Initiate a click-to-call between sales person and client
 * Exotel calls sales person first → then connects to client → records both sides
 *
 * @param {string} salesPersonNumber  - Sales exec ka phone number (e.g. 9876543210)
 * @param {string} clientNumber       - Client ka phone number
 * @param {string} callerId           - Virtual ExoPhone number
 * @param {object} customField        - Extra data (leadId, execName etc.)
 */
async function initiateCall(salesPersonNumber, clientNumber, callerId, customField = {}) {
  const params = new URLSearchParams({
    From:          salesPersonNumber,    // Sales person ko pehle ring hogi
    To:            clientNumber,         // Client ko connect karega
    CallerId:      callerId || EXOTEL_CALLER_ID,
    Record:        'true',               // Recording ON
    RecordingChannels: 'dual',           // Dono sides record
    // Webhook URLs — Exotel inhe call karta hai events pe
    StatusCallback:         `${process.env.BACKEND_URL}/webhook/exotel/status`,
    StatusCallbackEvents:   'terminal',  // Call end hone pe
  });

  // Custom field — lead ka data store karne ke liye
  if (customField.leadId)   params.append('CustomField', JSON.stringify(customField));

  try {
    const response = await axios.post(
      `${EXOTEL_BASE}/Calls/connect.json`,
      params.toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return { success: true, callSid: response.data?.Call?.Sid, data: response.data };
  } catch (err) {
    const msg = err.response?.data || err.message;
    console.error('Exotel call error:', msg);
    return { success: false, error: msg };
  }
}

/**
 * Fetch recording URL for a completed call
 * @param {string} callSid - Exotel Call SID
 */
async function getRecordingUrl(callSid) {
  try {
    const res = await axios.get(`${EXOTEL_BASE}/Calls/${callSid}/Recordings.json`);
    const recordings = res.data?.Items || [];
    if (!recordings.length) return null;
    // Latest recording
    const rec = recordings[recordings.length - 1];
    return {
      url:      rec.Uri,
      duration: rec.Duration,
      sid:      rec.Sid,
    };
  } catch (err) {
    console.error('Fetch recording error:', err.response?.data || err.message);
    return null;
  }
}

/**
 * Get call details (status, duration, timestamps)
 * @param {string} callSid
 */
async function getCallDetails(callSid) {
  try {
    const res = await axios.get(`${EXOTEL_BASE}/Calls/${callSid}.json`);
    return res.data?.Call || null;
  } catch (err) {
    console.error('Get call error:', err.response?.data || err.message);
    return null;
  }
}

module.exports = { initiateCall, getRecordingUrl, getCallDetails };
