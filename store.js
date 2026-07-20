// Minimal file-based lead store. No external dependencies required.
// Leads are kept in data/leads.json as a JSON array. Fine for the volume a
// solo agent or small team generates; swap for a real database later if needed.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'leads.json');

function ensureStore() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]', 'utf8');
}

function readAll() {
  ensureStore();
  const raw = fs.readFileSync(DATA_FILE, 'utf8');
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeAll(leads) {
  ensureStore();
  fs.writeFileSync(DATA_FILE, JSON.stringify(leads, null, 2), 'utf8');
}

function insertLead(lead) {
  const leads = readAll();
  const nextId = leads.length ? Math.max(...leads.map(l => l.id)) + 1 : 1;
  const record = {
    id: nextId,
    created_at: new Date().toISOString(),
    status: 'New',
    called_at: null,
    ...lead
  };
  leads.push(record);
  writeAll(leads);
  return record;
}

function updateLeadStatus(id, status) {
  const leads = readAll();
  const idx = leads.findIndex(l => l.id === Number(id));
  if (idx === -1) return null;
  leads[idx].status = status;
  if (status === 'Called' && !leads[idx].called_at) {
    leads[idx].called_at = new Date().toISOString();
  }
  writeAll(leads);
  return leads[idx];
}

function queryLeads({ status, q } = {}) {
  let leads = readAll();
  if (status) leads = leads.filter(l => l.status === status);
  if (q) {
    const needle = q.toLowerCase();
    leads = leads.filter(l =>
      [l.full_name, l.phone, l.email, l.zip_code]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(needle))
    );
  }
  leads.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return leads;
}

module.exports = { insertLead, updateLeadStatus, queryLeads, readAll };
