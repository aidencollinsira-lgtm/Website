// Zero-dependency Node.js server: public lead form + password-protected dashboard.
// Run with: node server.js   (no `npm install` required)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const store = require('./store');

const PORT = process.env.PORT || 3000;
const DASH_USER = process.env.DASHBOARD_USER;
const DASH_PASS = process.env.DASHBOARD_PASSWORD;

if (!DASH_USER || !DASH_PASS) {
  console.error('DASHBOARD_USER and DASHBOARD_PASSWORD environment variables must both be set. Refusing to start with no or default credentials.');
  process.exit(1);
}

const PUBLIC_DIR = path.join(__dirname, 'public');
const STATUSES = ['New', 'Called', 'Interested', 'NotInterested'];
const REQUIRED_FIELDS = ['full_name', 'phone', 'zip_code'];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'"
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, ...headers });
  res.end(body);
}

function sendJson(res, status, obj) {
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json' });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 1e6) { reject(new Error('Payload too large')); req.destroy(); return; }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function checkAuth(req) {
  const header = req.headers['authorization'] || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme !== 'Basic' || !encoded) return false;
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const idx = decoded.indexOf(':');
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  return user === DASH_USER && pass === DASH_PASS;
}

// In-memory brute-force guard for the dashboard login, keyed by client IP.
const LOGIN_ATTEMPTS = new Map(); // ip -> { count, firstFailure, lockedUntil }
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // failures older than this don't count
const LOGIN_LOCKOUT_MS = 5 * 60 * 1000; // lockout duration once max attempts hit

function getClientIp(req) {
  // Render sites are fronted by Cloudflare, which strips any client-supplied
  // CF-Connecting-IP and always overwrites it with the real connecting IP —
  // that makes it trustworthy, unlike X-Forwarded-For, whose leftmost entry
  // is whatever the client sent and can be freely spoofed to bypass rate
  // limits (e.g. `curl -H "X-Forwarded-For: 1.2.3.4"`).
  const cfIp = req.headers['cf-connecting-ip'];
  if (cfIp) return cfIp.trim();
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) {
    const parts = fwd.split(',').map(s => s.trim());
    return parts[parts.length - 1];
  }
  return req.socket.remoteAddress;
}

// In-memory rate limit for public lead submissions, to blunt bot/spam flooding.
const SUBMIT_ATTEMPTS = new Map(); // ip -> { count, windowStart }
const SUBMIT_MAX = 8;
const SUBMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function isSubmitRateLimited(ip) {
  const now = Date.now();
  const entry = SUBMIT_ATTEMPTS.get(ip);
  if (!entry || now - entry.windowStart > SUBMIT_WINDOW_MS) {
    SUBMIT_ATTEMPTS.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > SUBMIT_MAX;
}

function requireAuth(req, res) {
  const ip = getClientIp(req);
  const entry = LOGIN_ATTEMPTS.get(ip);
  const now = Date.now();

  if (entry && entry.lockedUntil > now) {
    res.writeHead(429, {
      ...SECURITY_HEADERS,
      'Retry-After': String(Math.ceil((entry.lockedUntil - now) / 1000)),
      'Content-Type': 'text/plain'
    });
    res.end('Too many failed login attempts. Try again later.');
    return false;
  }

  if (checkAuth(req)) {
    LOGIN_ATTEMPTS.delete(ip);
    return true;
  }

  if (!entry || now - entry.firstFailure > LOGIN_WINDOW_MS) {
    LOGIN_ATTEMPTS.set(ip, { count: 1, firstFailure: now, lockedUntil: 0 });
  } else {
    entry.count += 1;
    if (entry.count >= LOGIN_MAX_ATTEMPTS) entry.lockedUntil = now + LOGIN_LOCKOUT_MS;
    LOGIN_ATTEMPTS.set(ip, entry);
  }

  res.writeHead(401, {
    ...SECURITY_HEADERS,
    'WWW-Authenticate': 'Basic realm="ALC Insurance Group Dashboard"',
    'Content-Type': 'text/plain'
  });
  res.end('Authentication required');
  return false;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function csvEscape(val) {
  if (val === null || val === undefined) return '';
  let s = String(val);
  // Neutralize spreadsheet formula injection (CWE-1236): a leading =, +, -, or @
  // would otherwise be interpreted as a formula when the CSV is opened in Excel/Sheets.
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(PUBLIC_DIR, filePath);
  if (!fullPath.startsWith(PUBLIC_DIR)) { send(res, 403, 'Forbidden'); return; }

  fs.readFile(fullPath, (err, content) => {
    if (err) { send(res, 404, 'Not found'); return; }
    const ext = path.extname(fullPath);
    send(res, 200, content, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  });
}

async function handleCreateLead(req, res) {
  if (isSubmitRateLimited(getClientIp(req))) {
    return sendJson(res, 429, { error: 'Too many submissions from this address. Please try again later.' });
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return sendJson(res, 400, { error: 'Invalid request body' });
  }

  for (const field of REQUIRED_FIELDS) {
    if (!body[field] || String(body[field]).trim() === '') {
      return sendJson(res, 400, { error: `Missing required field: ${field.replace('_', ' ')}` });
    }
  }
  if (!body.consent_given) {
    return sendJson(res, 400, { error: 'Consent checkbox must be checked to submit.' });
  }

  const record = store.insertLead({
    full_name: String(body.full_name).trim(),
    phone: String(body.phone).trim(),
    email: body.email ? String(body.email).trim() : null,
    zip_code: String(body.zip_code).trim(),
    coverage_type: body.coverage_type || null,
    current_insurance_status: body.current_insurance_status || null,
    household_size: body.household_size || null,
    age_range: body.age_range || null,
    best_time_to_call: body.best_time_to_call || null,
    best_day_to_call: body.best_day_to_call || null,
    consent_given: !!body.consent_given
  });

  sendJson(res, 201, { ok: true, id: record.id });
}

async function handleUpdateStatus(req, res, id) {
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return sendJson(res, 400, { error: 'Invalid request body' });
  }
  if (!STATUSES.includes(body.status)) {
    return sendJson(res, 400, { error: 'Invalid status' });
  }
  const updated = store.updateLeadStatus(id, body.status);
  if (!updated) return sendJson(res, 404, { error: 'Lead not found' });
  sendJson(res, 200, { ok: true });
}

function handleCsvExport(req, res, filters) {
  const leads = store.queryLeads(filters);
  const cols = ['id', 'created_at', 'full_name', 'phone', 'email', 'zip_code', 'coverage_type',
    'current_insurance_status', 'household_size', 'age_range', 'best_time_to_call',
    'best_day_to_call', 'status', 'consent_given', 'called_at'];
  const lines = [cols.join(',')];
  for (const l of leads) lines.push(cols.map(c => csvEscape(l[c])).join(','));
  send(res, 200, lines.join('\n'), {
    'Content-Type': 'text/csv',
    'Content-Disposition': 'attachment; filename="leads.csv"'
  });
}

function renderDashboard(leads, filters) {
  const rows = leads.map(l => `
    <tr>
      <td>${escapeHtml(l.created_at)}</td>
      <td>${escapeHtml(l.full_name)}</td>
      <td><a class="call-link" href="tel:${escapeHtml(l.phone)}">${escapeHtml(l.phone)}</a></td>
      <td>${l.email ? escapeHtml(l.email) : '&mdash;'}</td>
      <td>${escapeHtml(l.zip_code)}</td>
      <td>${l.coverage_type ? escapeHtml(l.coverage_type) : '&mdash;'}</td>
      <td>${l.current_insurance_status ? escapeHtml(l.current_insurance_status) : '&mdash;'}</td>
      <td>${l.age_range ? escapeHtml(l.age_range) : '&mdash;'}</td>
      <td>${[l.best_day_to_call, l.best_time_to_call].filter(Boolean).map(escapeHtml).join(' / ') || '&mdash;'}</td>
      <td><span class="badge ${l.status}">${escapeHtml(l.status)}</span></td>
      <td>
        <select class="status-select" data-id="${l.id}">
          ${STATUSES.map(s => `<option value="${s}" ${s === l.status ? 'selected' : ''}>${s}</option>`).join('')}
        </select>
      </td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>ALC Insurance Group | Leads Dashboard</title>
<link rel="stylesheet" href="/style.css" />
</head>
<body>
<div class="dash-wrap">
  <div class="dash-header">
    <h1>ALC Insurance Group Dashboard</h1>
    <span class="count-pill">${leads.length} lead${leads.length === 1 ? '' : 's'}</span>
  </div>

  <form class="toolbar" method="get" action="/dashboard">
    <input type="text" name="q" placeholder="Search name, phone, email, ZIP" value="${escapeHtml(filters.q || '')}" />
    <select name="status">
      <option value="">All statuses</option>
      ${STATUSES.map(s => `<option value="${s}" ${filters.status === s ? 'selected' : ''}>${s}</option>`).join('')}
    </select>
    <button class="btn" type="submit">Filter</button>
    <a class="btn" href="/dashboard">Reset</a>
    <a class="btn" href="/api/dashboard/leads.csv">Export CSV</a>
  </form>

  ${leads.length === 0 ? `<div class="empty-state">No leads yet. Once someone submits the form, they'll show up here.</div>` : `
  <table>
    <thead>
      <tr>
        <th>Submitted</th>
        <th>Name</th>
        <th>Phone</th>
        <th>Email</th>
        <th>ZIP</th>
        <th>Coverage</th>
        <th>Current status</th>
        <th>Age</th>
        <th>Best time to call</th>
        <th>Status</th>
        <th>Update</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>
  `}
</div>

<script>
document.querySelectorAll('.status-select').forEach(sel => {
  sel.addEventListener('change', async () => {
    const id = sel.dataset.id;
    await fetch('/api/dashboard/leads/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: sel.value })
    });
    location.reload();
  });
});
</script>
</body>
</html>`;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  try {
    if (req.method === 'POST' && pathname === '/api/leads') {
      return await handleCreateLead(req, res);
    }

    if (pathname === '/dashboard' || pathname.startsWith('/api/dashboard')) {
      if (!requireAuth(req, res)) return;

      if (req.method === 'GET' && pathname === '/dashboard') {
        const filters = { status: url.searchParams.get('status') || '', q: url.searchParams.get('q') || '' };
        const leads = store.queryLeads(filters);
        return send(res, 200, renderDashboard(leads, filters), { 'Content-Type': 'text/html; charset=utf-8' });
      }

      if (req.method === 'GET' && pathname === '/api/dashboard/leads.csv') {
        const filters = { status: url.searchParams.get('status') || '', q: url.searchParams.get('q') || '' };
        return handleCsvExport(req, res, filters);
      }

      const patchMatch = pathname.match(/^\/api\/dashboard\/leads\/(\d+)$/);
      if (req.method === 'PATCH' && patchMatch) {
        return await handleUpdateStatus(req, res, patchMatch[1]);
      }

      return send(res, 404, 'Not found');
    }

    if (req.method === 'GET') {
      return serveStatic(req, res, pathname);
    }

    send(res, 405, 'Method not allowed');
  } catch (err) {
    console.error(err);
    sendJson(res, 500, { error: 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Dashboard: http://localhost:${PORT}/dashboard (user: ${DASH_USER})`);
});
