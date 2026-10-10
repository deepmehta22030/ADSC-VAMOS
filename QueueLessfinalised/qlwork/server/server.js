import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const DATA = path.join(__dirname, 'data.json');
const SECRET = process.env.JWT_SECRET || 'queueless-hackathon-demo-secret-change-me';

const app = express();

app.use(cors());
app.use(express.json());

// Indian Standard Time (IST) helpers
function officeClock() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date());

  const hour = Number(parts.find(p => p.type === 'hour').value);
  const minute = Number(parts.find(p => p.type === 'minute').value);

  return hour * 60 + minute;
}

function officeLocalTime() {
  return new Date().toLocaleTimeString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

function isRecess() {
  const m = officeClock();
  return m >= 750 && m < 810;
}

function recessMinutesRemaining() {
  const m = officeClock();
  return m >= 750 && m < 810 ? 810 - m : 0;
}

function baseQueueWait(waiting, workers) {
  return Math.max(5, Math.ceil(waiting / Math.max(1, workers) * 7));
}

function estimatedQueueWait(waiting, workers) {
  return baseQueueWait(waiting, workers) + recessMinutesRemaining();
}

function recessError(res) {
  return res.status(409).json({
    error: 'Office recess is from 12:30 PM to 1:30 PM. Token calling resumes at 1:30 PM.',
    recess: true
  });
}

const initial = {
  users: [
    {
      id: 'u1',
      name: 'Raj Soni',
      email: 'citizen@demo.com',
      role: 'citizen',
      passwordHash: bcrypt.hashSync('123456', 10)
    },
    {
      id: 'a1',
      name: 'Officer Mehta',
      email: 'admin@demo.com',
      role: 'admin',
      passwordHash: bcrypt.hashSync('admin123', 10)
    }
  ],
  tokens: [
    {
      id: 'tok1',
      token: 'A-041',
      name: 'Priya P.',
      service: 'Aadhaar Update',
      status: 'serving',
      eta: 0,
      createdAt: Date.now() - 3600000,
      officeId: 'rajkot-central'
    },
    {
      id: 'tok2',
      token: 'A-042',
      name: 'Rahul S.',
      service: 'PAN Services',
      status: 'waiting',
      eta: 7,
      createdAt: Date.now() - 1800000,
      officeId: 'rajkot-central'
    },
    {
      id: 'tok3',
      token: 'A-043',
      name: 'Neha R.',
      service: 'Birth Certificate',
      status: 'waiting',
      eta: 14,
      createdAt: Date.now() - 1500000,
      officeId: 'rajkot-central'
    },
    {
      id: 'tok4',
      token: 'A-044',
      name: 'Amit K.',
      service: 'Property / Tax',
      status: 'waiting',
      eta: 21,
      createdAt: Date.now() - 900000,
      officeId: 'rajkot-central'
    },
    {
      id: 'tok5',
      token: 'A-045',
      name: 'Missing citizen',
      service: 'PAN Services',
      status: 'missing',
      eta: 28,
      createdAt: Date.now() - 600000,
      officeId: 'rajkot-central'
    }
  ],
  workers: [
    { id: 'w1', name: 'Mehul Shah', role: 'Counter 1', on: true },
    { id: 'w2', name: 'Riya Patel', role: 'Counter 2', on: true },
    { id: 'w3', name: 'Dev Joshi', role: 'Counter 3', on: true }
  ],
  notifications: []
};

function db() {
  if (!fs.existsSync(DATA)) {
    fs.writeFileSync(DATA, JSON.stringify(initial, null, 2));
  }

  return JSON.parse(fs.readFileSync(DATA, 'utf8'));
}

function save(data) {
  fs.writeFileSync(DATA, JSON.stringify(data, null, 2));
}

function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';

    if (!h.startsWith('Bearer ')) {
      throw new Error('Missing token');
    }

    req.user = jwt.verify(h.slice(7), SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Authentication required' });
  }
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role
  };
}

const SERVICE_FEES = {
  'Aadhaar Update': 50,
  'PAN Services': 110,
  'Birth Certificate': 20,
  'Income / Caste Certificate': 20
};

function razorpayConfigured() {
  return Boolean(
    process.env.RAZORPAY_KEY_ID &&
    process.env.RAZORPAY_KEY_SECRET
  );
}

function feeForService(service) {
  return SERVICE_FEES[service] ?? null;
}

function makeToken(data, user, {
  officeId,
  service,
  name = 'Citizen',
  paymentMethod = 'office',
  paymentStatus = 'pay_at_office',
  paymentId = null,
  amount = null
}) {
  const workers = data.workers.filter(w => w.on).length;

  const officeTokens = data.tokens.filter(t =>
    t.officeId === officeId &&
    ['waiting', 'serving', 'missing'].includes(t.status)
  );

  const waiting = officeTokens.filter(t => t.status === 'waiting').length;
  const eta = estimatedQueueWait(waiting, workers);

  const num = officeTokens.length
    ? Math.max(...officeTokens.map(t =>
        Number(t.token.split('-')[1]) || 0
      )) + 1
    : 41;

  const token = {
    id: crypto.randomUUID(),
    token: `A-${String(num).padStart(3, '0')}`,
    name,
    service,
    status: 'waiting',
    eta,
    createdAt: Date.now(),
    officeId,
    userId: user.id,
    bookedDuringRecess: isRecess(),
    recessDelayMinutes: recessMinutesRemaining(),
    paymentMethod,
    paymentStatus,
    paymentId,
    amount
  };

  data.tokens.push(token);

  data.notifications.unshift({
    id: crypto.randomUUID(),
    userId: user.id,
    title: 'Token confirmed',
    message: `${token.token} booked successfully. Estimated wait ${eta} min.${
      paymentMethod === 'razorpay'
        ? ' Online payment verified.'
        : ' Pay the service fee at the office.'
    }`,
    time: Date.now(),
    read: false
  });

  return {
    token,
    qrPayload: `QUEUELESS|${token.id}|${token.token}|${officeId}`
  };
}

// Health endpoint
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'QueueLess API',
    time: new Date().toISOString()
  });
});

// Office status
app.get('/api/office-status', (req, res) => {
  const m = officeClock();
  const recess = m >= 750 && m < 810;
  const bookingWindow = m >= 600 && m <= 1020;

  res.json({
    recess,
    bookingWindow,
    localTime: officeLocalTime(),
    recessStart: '12:30 PM',
    recessEnd: '1:30 PM',
    bookingStart: '10:00 AM',
    bookingEnd: '5:00 PM',
    message: recess
      ? 'Office recess is in progress. Tokens can still be booked; waiting estimates include the remaining break. Service resumes at 1:30 PM.'
      : bookingWindow
        ? 'Office booking window is open.'
        : 'Token booking is available only from 10:00 AM to 5:00 PM.'
  });
});

// Register
app.post('/api/auth/register', async (req, res) => {
  const {
    name,
    email,
    password,
    role = 'citizen'
  } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({
      error: 'Name, email and password are required'
    });
  }

  const data = db();

  if (data.users.some(u =>
    u.email.toLowerCase() === email.toLowerCase()
  )) {
    return res.status(409).json({
      error: 'Account already exists'
    });
  }

  const user = {
    id: crypto.randomUUID(),
    name,
    email,
    role: role === 'admin' ? 'citizen' : role,
    passwordHash: await bcrypt.hash(password, 10)
  };

  data.users.push(user);
  save(data);

  const token = jwt.sign(
    { id: user.id, role: user.role, name: user.name },
    SECRET,
    { expiresIn: '8h' }
  );

  res.json({ token, user: publicUser(user) });
});

// Login
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  const data = db();

  const user = data.users.find(u =>
    u.email.toLowerCase() === String(email || '').toLowerCase()
  );

  if (!user || !(await bcrypt.compare(password || '', user.passwordHash))) {
    return res.status(401).json({
      error: 'Invalid email or password'
    });
  }

  const token = jwt.sign(
    { id: user.id, role: user.role, name: user.name },
    SECRET,
    { expiresIn: '8h' }
  );

  res.json({ token, user: publicUser(user) });
});

// Administrators
app.get('/api/admins', auth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Administrator access required'
    });
  }

  const data = db();

  res.json({
    admins: data.users.filter(u => u.role === 'admin').map(publicUser)
  });
});

app.post('/api/admins', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Administrator access required'
    });
  }

  const { name, email, password } = req.body || {};

  if (!name?.trim() || !email?.trim() || !password || password.length < 6) {
    return res.status(400).json({
      error: 'Name and email and password (at least 6 characters) are required'
    });
  }

  const data = db();

  if (data.users.some(u =>
    u.email.toLowerCase() === email.trim().toLowerCase()
  )) {
    return res.status(409).json({
      error: 'An account with this email already exists'
    });
  }

  const user = {
    id: crypto.randomUUID(),
    name: name.trim(),
    email: email.trim(),
    role: 'admin',
    passwordHash: await bcrypt.hash(password, 10)
  };

  data.users.push(user);
  save(data);

  res.status(201).json({
    admin: publicUser(user),
    message: 'Administrator account created successfully'
  });
});

app.put('/api/admins/:id', auth, async (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Administrator access required'
    });
  }

  const { name, email, password } = req.body || {};

  if (!name?.trim() || !email?.trim()) {
    return res.status(400).json({
      error: 'Name and email are required'
    });
  }

  if (password && password.length < 6) {
    return res.status(400).json({
      error: 'Password must be at least 6 characters'
    });
  }

  const data = db();
  const user = data.users.find(u =>
    u.id === req.params.id && u.role === 'admin'
  );

  if (!user) {
    return res.status(404).json({
      error: 'Administrator not found'
    });
  }

  if (data.users.some(u =>
    u.id !== user.id &&
    u.email.toLowerCase() === email.trim().toLowerCase()
  )) {
    return res.status(409).json({
      error: 'An account with this email already exists'
    });
  }

  user.name = name.trim();
  user.email = email.trim();

  if (password) {
    user.passwordHash = await bcrypt.hash(password, 10);
  }

  save(data);

  res.json({
    admin: publicUser(user),
    message: 'Administrator updated successfully'
  });
});

app.delete('/api/admins/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Administrator access required'
    });
  }

  if (req.user.id === req.params.id) {
    return res.status(400).json({
      error: 'You cannot delete the account you are currently using'
    });
  }

  const data = db();
  const index = data.users.findIndex(u =>
    u.id === req.params.id && u.role === 'admin'
  );

  if (index < 0) {
    return res.status(404).json({
      error: 'Administrator not found'
    });
  }

  if (data.users.filter(u => u.role === 'admin').length <= 1) {
    return res.status(400).json({
      error: 'At least one administrator account must remain'
    });
  }

  const [admin] = data.users.splice(index, 1);
  save(data);

  res.json({ admin, message: 'Administrator deleted successfully' });
});

// Current user
app.get('/api/me', auth, (req, res) => {
  const data = db();
  const user = data.users.find(u => u.id === req.user.id);

  res.json({ user: publicUser(user) });
});

// Offices
app.get('/api/offices', (req, res) => {
  res.json({
    offices: [
      {
        id: 'rajkot-central',
        name: 'Rajkot Municipal Office — Central Zone',
        area: 'Dhebar Road, Rajkot',
        lat: 22.3039,
        lng: 70.8022,
        distance: 1.8,
        open: true
      },
      {
        id: 'rajkot-west',
        name: 'Rajkot Municipal Office — West Zone',
        area: 'Kalawad Road, Rajkot',
        lat: 22.3031,
        lng: 70.7706,
        distance: 4.6,
        open: true
      },
      {
        id: 'rajkot-east',
        name: 'Rajkot Municipal Office — East Zone',
        area: '150 Feet Ring Road, Rajkot',
        lat: 22.2937,
        lng: 70.8335,
        distance: 5.9,
        open: true
      }
    ]
  });
});

// Services
app.get('/api/services', (req, res) => {
  res.json({
    services: [
      {
        id: 'aadhaar',
        name: 'Aadhaar Update',
        desc: 'Address, mobile & demographic updates',
        docs: ['Aadhaar card', 'Address proof', 'Mobile number'],
        fee: '₹50'
      },
      {
        id: 'pan',
        name: 'PAN Services',
        desc: 'Correction, address or personal details',
        docs: ['PAN card', 'Aadhaar card', 'Supporting proof'],
        fee: '₹110'
      },
      {
        id: 'birth',
        name: 'Birth Certificate',
        desc: 'New certificate or correction request',
        docs: ['Hospital record', 'Parent ID proof', 'Application form'],
        fee: '₹20'
      },
      {
        id: 'property',
        name: 'Property / Tax',
        desc: 'Municipal property and tax services',
        docs: ['Property ID', 'Owner ID', 'Latest tax receipt'],
        fee: 'Varies'
      },
      {
        id: 'income',
        name: 'Income / Caste Certificate',
        desc: 'Application and verification assistance',
        docs: ['Aadhaar card', 'Income proof', 'Residence proof'],
        fee: '₹20'
      },
      {
        id: 'other',
        name: 'Other Municipal Service',
        desc: 'Get guidance for the right counter',
        docs: ['Valid ID', 'Relevant supporting document'],
        fee: 'Depends'
      }
    ]
  });
});

// Queue
app.get('/api/queue/:officeId', auth, (req, res) => {
  const data = db();
  const workers = data.workers.filter(w => w.on).length;

  const tokens = data.tokens.filter(t =>
    t.officeId === req.params.officeId &&
    ['waiting', 'serving', 'missing'].includes(t.status)
  );

  const waiting = tokens.filter(t => t.status === 'waiting').length;
  const eta = estimatedQueueWait(waiting, workers);

  res.json({
    tokens,
    workers: data.workers,
    activeWorkers: workers,
    waiting,
    eta,
    recess: isRecess(),
    recessMinutesRemaining: recessMinutesRemaining(),
    capacityPerRound: workers,
    nowServing: tokens.find(t => t.status === 'serving') || null
  });
});

// Create Razorpay order
app.post('/api/payments/order', auth, async (req, res) => {
  if (req.user.role !== 'citizen') {
    return res.status(403).json({
      error: 'Citizen account required'
    });
  }

  if (!razorpayConfigured()) {
    return res.status(503).json({
      error: 'Online payment is not configured yet. Choose Pay at office, or ask the administrator to configure Razorpay keys.'
    });
  }

  const { officeId, service } = req.body || {};

  if (!officeId || !service) {
    return res.status(400).json({
      error: 'Office and service are required'
    });
  }

  const mins = officeClock();

  if (mins < 600 || mins > 1020) {
    return res.status(400).json({
      error: 'Token booking is available only from 10:00 AM to 5:00 PM.'
    });
  }

  const amount = feeForService(service);

  if (amount === null) {
    return res.status(400).json({
      error: 'This service has a variable fee and cannot be paid online in this demo. Choose Pay at office.'
    });
  }

  try {
    const receipt = `ql_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;

    const authHeader = Buffer.from(
      `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
    ).toString('base64');

    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${authHeader}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        amount: amount * 100,
        currency: 'INR',
        receipt,
        notes: { userId: req.user.id, officeId, service }
      })
    });

    const order = await response.json();

    if (!response.ok) {
      return res.status(502).json({
        error: order.error?.description || 'Unable to create Razorpay order'
      });
    }

    const data = db();
    data.payments = data.payments || [];

    data.payments.push({
      orderId: order.id,
      userId: req.user.id,
      officeId,
      service,
      amount: amount * 100,
      currency: 'INR',
      status: 'created',
      createdAt: Date.now()
    });

    save(data);

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
      service
    });
  } catch {
    res.status(502).json({
      error: 'Could not connect to Razorpay. Please try again or choose Pay at office.'
    });
  }
});

// Verify Razorpay payment
app.post('/api/payments/verify', auth, async (req, res) => {
  if (!razorpayConfigured()) {
    return res.status(503).json({
      error: 'Razorpay is not configured'
    });
  }

  const {
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    officeId,
    service,
    name
  } = req.body || {};

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({
      error: 'Payment verification details are incomplete'
    });
  }

  const data = db();
  data.payments = data.payments || [];

  const payment = data.payments.find(p =>
    p.orderId === razorpay_order_id && p.userId === req.user.id
  );

  if (!payment) {
    return res.status(404).json({
      error: 'Payment order not found for this account'
    });
  }

  if (payment.status === 'paid' && payment.tokenId) {
    const existing = data.tokens.find(t => t.id === payment.tokenId);

    if (existing) {
      return res.json({
        token: existing,
        qrPayload: `QUEUELESS|${existing.id}|${existing.token}|${existing.officeId}`,
        alreadyProcessed: true
      });
    }
  }

  const expected = crypto
    .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  const a = Buffer.from(expected);
  const b = Buffer.from(String(razorpay_signature));

  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(400).json({
      error: 'Payment signature verification failed'
    });
  }

  try {
    const authHeader = Buffer.from(
      `${process.env.RAZORPAY_KEY_ID}:${process.env.RAZORPAY_KEY_SECRET}`
    ).toString('base64');

    const response = await fetch(
      `https://api.razorpay.com/v1/payments/${encodeURIComponent(razorpay_payment_id)}`,
      { headers: { Authorization: `Basic ${authHeader}` } }
    );

    const rp = await response.json();

    if (
      !response.ok ||
      rp.order_id !== razorpay_order_id ||
      rp.status !== 'captured' ||
      rp.amount !== payment.amount ||
      rp.currency !== 'INR'
    ) {
      return res.status(400).json({
        error: 'Razorpay has not confirmed a captured payment. Please check payment status before retrying.'
      });
    }

    if (payment.officeId !== officeId || payment.service !== service) {
      return res.status(400).json({
        error: 'The paid order does not match the selected office or service'
      });
    }

    const result = makeToken(data, req.user, {
      officeId: payment.officeId,
      service: payment.service,
      name: name || req.user.name,
      paymentMethod: 'razorpay',
      paymentStatus: 'paid',
      paymentId: razorpay_payment_id,
      amount: payment.amount
    });

    payment.status = 'paid';
    payment.paymentId = razorpay_payment_id;
    payment.tokenId = result.token.id;
    payment.paidAt = Date.now();

    save(data);

    return res.status(201).json(result);
  } catch {
    return res.status(502).json({
      error: 'Could not verify payment with Razorpay. If money was deducted, contact the office with your payment ID.'
    });
  }
});

// Generate token using office payment
app.post('/api/tokens', auth, (req, res) => {
  if (req.user.role !== 'citizen') {
    return res.status(403).json({
      error: 'Citizen account required'
    });
  }

  const {
    officeId,
    service,
    name = 'Citizen',
    paymentMethod = 'office'
  } = req.body || {};

  const mins = officeClock();

  if (mins < 600 || mins > 1020) {
    return res.status(400).json({
      error: 'Token booking is available only from 10:00 AM to 5:00 PM.'
    });
  }

  if (paymentMethod !== 'office') {
    return res.status(400).json({
      error: 'For online payment, complete the Razorpay checkout first.'
    });
  }

  if (!officeId || !service) {
    return res.status(400).json({
      error: 'Office and service are required'
    });
  }

  const data = db();
  const fee = feeForService(service);

  const result = makeToken(data, req.user, {
    officeId,
    service,
    name,
    paymentMethod: 'office',
    paymentStatus: 'pay_at_office',
    amount: fee === null ? null : fee * 100
  });

  save(data);

  res.status(201).json(result);
});

// Call next token
app.post('/api/tokens/next/call', auth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Officer access required'
    });
  }

  if (isRecess()) return recessError(res);

  const data = db();
  const old = data.tokens.find(t => t.status === 'serving');

  if (old) {
    old.status = 'done';
    old.completedAt = Date.now();
    old.serviceMinutes = Math.max(
      4,
      Math.round((Date.now() - (old.calledAt || old.createdAt)) / 60000)
    );
  }

  const next = data.tokens.find(t => t.status === 'waiting');

  if (!next) {
    return res.json({ message: 'No waiting token', next: null });
  }

  next.status = 'serving';
  next.eta = 0;
  next.calledAt = Date.now();

  data.notifications.unshift({
    id: crypto.randomUUID(),
    title: 'Token called',
    message: `${next.token} is now being served.`,
    time: Date.now(),
    read: false
  });

  save(data);
  res.json({ next });
});

app.post('/api/tokens/:id/call', auth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Officer access required'
    });
  }

  if (isRecess()) return recessError(res);

  const data = db();
  const old = data.tokens.find(t => t.status === 'serving');

  if (old) {
    old.status = 'done';
    old.completedAt = Date.now();
    old.serviceMinutes = Math.max(
      4,
      Math.round((Date.now() - (old.calledAt || old.createdAt)) / 60000)
    );
  }

  const next = data.tokens.find(t => t.status === 'waiting');

  if (!next) {
    return res.json({ message: 'No waiting token', next: null });
  }

  next.status = 'serving';
  next.eta = 0;
  next.calledAt = Date.now();

  data.notifications.unshift({
    id: crypto.randomUUID(),
    title: 'Token called',
    message: `${next.token} is now being served.`,
    time: Date.now(),
    read: false
  });

  save(data);
  res.json({ next });
});

// Skip missing token
app.post('/api/tokens/skip-missing', auth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Officer access required'
    });
  }

  if (isRecess()) return recessError(res);

  const data = db();
  const missing = data.tokens.find(t => t.status === 'missing');

  if (missing) missing.status = 'skipped';

  const next = data.tokens.find(t => t.status === 'waiting');

  if (next) {
    next.status = 'serving';
    next.eta = 0;
  }

  save(data);

  res.json({
    skipped: missing?.token || null,
    promoted: next || null
  });
});

// Workers
app.post('/api/workers', auth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Officer access required'
    });
  }

  const { name, role } = req.body || {};

  if (!name?.trim() || !role?.trim()) {
    return res.status(400).json({
      error: 'Worker name and counter/role are required'
    });
  }

  const data = db();

  const worker = {
    id: crypto.randomUUID(),
    name: name.trim(),
    role: role.trim(),
    on: true
  };

  data.workers.push(worker);
  save(data);

  res.status(201).json({
    worker,
    activeWorkers: data.workers.filter(w => w.on).length,
    message: 'Worker added successfully'
  });
});

app.post('/api/workers/:id/toggle', auth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Officer access required'
    });
  }

  const data = db();
  const worker = data.workers.find(w => w.id === req.params.id);

  if (!worker) {
    return res.status(404).json({ error: 'Worker not found' });
  }

  worker.on = !worker.on;
  save(data);

  res.json({
    worker,
    activeWorkers: data.workers.filter(w => w.on).length
  });
});

app.put('/api/workers/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Officer access required'
    });
  }

  const { name, role } = req.body || {};

  if (!name?.trim() || !role?.trim()) {
    return res.status(400).json({
      error: 'Worker name and counter/role are required'
    });
  }

  const data = db();
  const worker = data.workers.find(w => w.id === req.params.id);

  if (!worker) {
    return res.status(404).json({ error: 'Worker not found' });
  }

  worker.name = name.trim();
  worker.role = role.trim();

  save(data);

  res.json({
    worker,
    message: 'Worker updated successfully'
  });
});

app.delete('/api/workers/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Officer access required'
    });
  }

  const data = db();
  const index = data.workers.findIndex(w => w.id === req.params.id);

  if (index < 0) {
    return res.status(404).json({ error: 'Worker not found' });
  }

  const [worker] = data.workers.splice(index, 1);
  save(data);

  res.json({
    worker,
    activeWorkers: data.workers.filter(w => w.on).length,
    message: 'Worker deleted successfully'
  });
});

// Notifications
app.get('/api/notifications', auth, (req, res) => {
  const data = db();

  res.json({
    notifications: data.notifications
      .filter(n => !n.userId || n.userId === req.user.id)
      .slice(0, 20)
  });
});

// Attendance
app.get('/api/attendance', auth, (req, res) => {
  const data = db();

  const tokens = data.tokens
    .filter(t =>
      t.userId === req.user.id &&
      ['waiting', 'serving'].includes(t.status)
    )
    .map(t => ({
      id: t.id,
      token: t.token,
      service: t.service,
      officeId: t.officeId,
      status: t.status,
      attendanceStatus: t.attendanceStatus || 'Needs confirmation',
      confirmedAt: t.confirmedAt || null,
      arrivalNote: t.arrivalNote || ''
    }));

  res.json({ tokens, gracePeriodMinutes: 10 });
});

app.post('/api/attendance/:id', auth, (req, res) => {
  const allowed = ['Coming', 'Running late', 'Cancelled'];
  const status = req.body?.status;

  if (!allowed.includes(status)) {
    return res.status(400).json({
      error: 'Choose Coming, Running late, or Cancelled'
    });
  }

  const data = db();
  const token = data.tokens.find(t =>
    t.id === req.params.id && t.userId === req.user.id
  );

  if (!token) {
    return res.status(404).json({
      error: 'Your active token was not found'
    });
  }

  if (!['waiting', 'serving'].includes(token.status)) {
    return res.status(409).json({
      error: 'Attendance can only be updated for an active token'
    });
  }

  token.attendanceStatus = status;
  token.confirmedAt = Date.now();
  token.arrivalNote = String(req.body?.note || '').slice(0, 160);

  if (status === 'Cancelled') {
    token.status = 'cancelled';

    data.slotWaitlist = data.slotWaitlist || [];
    data.slotWaitlist.push({
      id: crypto.randomUUID(),
      userId: req.user.id,
      name: req.user.name,
      officeId: token.officeId,
      service: token.service,
      createdAt: Date.now(),
      status: 'waiting'
    });

    data.recoveredSlots = data.recoveredSlots || [];
    data.recoveredSlots.push({
      id: crypto.randomUUID(),
      officeId: token.officeId,
      service: token.service,
      sourceTokenId: token.id,
      createdAt: Date.now(),
      claimed: false
    });
  }

  data.notifications.unshift({
    id: crypto.randomUUID(),
    userId: req.user.id,
    title: 'Attendance updated',
    message: status === 'Cancelled'
      ? 'Appointment cancelled and slot released to recovery.'
      : status === 'Running late'
        ? 'Late arrival noted. Please contact the office if you exceed its grace period.'
        : 'Attendance confirmed. We look forward to seeing you.',
    time: Date.now(),
    read: false
  });

  save(data);

  res.json({
    ok: true,
    status,
    token: token.token,
    message: status === 'Cancelled'
      ? 'Appointment cancelled and slot added to recovery.'
      : status === 'Running late'
        ? 'Marked as running late. Office grace-period policy applies.'
        : 'Attendance confirmed.'
  });
});

// Slot recovery
app.post('/api/tokens/:id/cancel', auth, (req, res) => {
  const data = db();

  const token = data.tokens.find(t =>
    t.id === req.params.id && t.userId === req.user.id
  );

  if (!token) {
    return res.status(404).json({ error: 'Your token was not found' });
  }

  if (token.status !== 'waiting') {
    return res.status(409).json({
      error: 'Only waiting tokens can be cancelled'
    });
  }

  token.status = 'cancelled';

  data.slotWaitlist = data.slotWaitlist || [];
  const entry = {
    id: crypto.randomUUID(),
    userId: req.user.id,
    name: req.user.name,
    officeId: token.officeId,
    service: token.service,
    createdAt: Date.now(),
    status: 'waiting'
  };

  data.slotWaitlist.push(entry);

  data.recoveredSlots = data.recoveredSlots || [];
  data.recoveredSlots.push({
    id: crypto.randomUUID(),
    officeId: token.officeId,
    service: token.service,
    sourceTokenId: token.id,
    createdAt: Date.now(),
    claimed: false
  });

  save(data);

  res.json({
    message: 'Token cancelled. You have been added to the standby list for a recovered slot.',
    waitlistEntry: entry
  });
});

app.get('/api/slots/standby', auth, (req, res) => {
  const data = db();

  res.json({
    entries: (data.slotWaitlist || []).filter(
      x => x.userId === req.user.id && x.status === 'waiting'
    )
  });
});

app.post('/api/slots/claim', auth, (req, res) => {
  const data = db();

  const entry = (data.slotWaitlist || []).find(x =>
    x.id === req.body?.entryId &&
    x.userId === req.user.id &&
    x.status === 'waiting'
  );

  if (!entry) {
    return res.status(404).json({
      error: 'Standby request not found'
    });
  }

  data.recoveredSlots = data.recoveredSlots || [];

  const slot = data.recoveredSlots.find(x =>
    !x.claimed &&
    x.officeId === entry.officeId &&
    x.service === entry.service
  );

  if (!slot) {
    return res.status(409).json({
      error: 'No recovered slot is available for this service yet. Please try again shortly.'
    });
  }

  slot.claimed = true;
  entry.status = 'claimed';

  const made = makeToken(
    data,
    { id: req.user.id, name: req.user.name },
    {
      officeId: entry.officeId,
      service: entry.service,
      name: req.user.name,
      paymentMethod: 'office',
      paymentStatus: 'pay_at_office'
    }
  );

  save(data);

  res.json({
    token: made.token,
    qrPayload: made.qrPayload,
    message: 'Recovered slot claimed. Pay at the office.'
  });
});

// Grievances
app.get('/api/grievances', auth, (req, res) => {
  const data = db();
  const all = data.grievances || [];

  res.json({
    grievances: all
      .filter(g => req.user.role === 'admin' || g.userId === req.user.id)
      .sort((a, b) => b.createdAt - a.createdAt)
  });
});

app.post('/api/grievances', auth, (req, res) => {
  const { category, subject, description } = req.body || {};

  if (!category || !subject?.trim() || !description?.trim()) {
    return res.status(400).json({
      error: 'Category, subject and description are required'
    });
  }

  if (subject.length > 120 || description.length > 1500) {
    return res.status(400).json({
      error: 'Subject or description is too long'
    });
  }

  const data = db();
  data.grievances = data.grievances || [];

  const grievance = {
    id: crypto.randomUUID(),
    reference: 'GR-' + String(Date.now()).slice(-7),
    userId: req.user.id,
    userName: req.user.name,
    category,
    subject: subject.trim(),
    description: description.trim(),
    status: 'Submitted',
    createdAt: Date.now(),
    updates: []
  };

  data.grievances.push(grievance);
  save(data);

  res.status(201).json({ grievance });
});

app.patch('/api/grievances/:id', auth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Officer access required'
    });
  }

  const data = db();

  const grievance = (data.grievances || []).find(
    g => g.id === req.params.id
  );

  if (!grievance) {
    return res.status(404).json({ error: 'Grievance not found' });
  }

  const allowed = ['Submitted', 'In Review', 'Resolved', 'Rejected'];

  if (!allowed.includes(req.body?.status)) {
    return res.status(400).json({
      error: 'Invalid grievance status'
    });
  }

  grievance.status = req.body.status;

  grievance.updates.push({
    status: grievance.status,
    note: String(req.body.note || 'Status updated by officer').slice(0, 300),
    time: Date.now()
  });

  save(data);

  res.json({ grievance });
});

// Queue forecast
app.get('/api/forecast/:officeId', auth, (req, res) => {
  const data = db();
  const officeId = req.params.officeId;

  const all = data.tokens.filter(t => t.officeId === officeId);

  const active = all.filter(t =>
    ['waiting', 'serving', 'missing'].includes(t.status)
  );

  const workers = data.workers.filter(w => w.on).length;
  const waiting = active.filter(t => t.status === 'waiting').length;

  const recentDone = all
    .filter(t => t.status === 'done' && t.completedAt)
    .slice(-20);

  const avgService = recentDone.length
    ? Math.max(
        4,
        Math.round(
          recentDone.reduce((n, t) => n + (t.serviceMinutes || 7), 0) /
          recentDone.length
        )
      )
    : 7;

  const base = Math.max(
    5,
    Math.ceil(waiting / Math.max(1, workers) * avgService)
  );

  const load = Math.min(
    100,
    Math.round(waiting / Math.max(1, workers * 4) * 100)
  );

  const band = base <= 10 ? 'Low' : base <= 25 ? 'Moderate' : 'High';

  const hours = [
    { label: '10–11 AM', load: 28 },
    { label: '11 AM–12 PM', load: 52 },
    { label: '12–1 PM', load: 84 },
    { label: '1–2 PM', load: 67 },
    { label: '2–3 PM', load: 42 },
    { label: '3–4 PM', load: 36 },
    { label: '4–5 PM', load: 24 }
  ];

  res.json({
    officeId,
    generatedAt: Date.now(),
    waiting,
    activeWorkers: workers,
    averageServiceMinutes: avgService,
    estimatedWaitMinutes: base + recessMinutesRemaining(),
    load,
    loadBand: band,
    confidence: recentDone.length >= 5
      ? 'Improving with completed-visit data'
      : 'Demo estimate; confidence improves as completed visits are recorded',
    busyPeriods: hours.filter(x => x.load >= 60),
    hourly: hours,
    method: 'Queue length ÷ active counters × average service duration, plus office recess delay.'
  });
});

// Analytics
app.get('/api/analytics', auth, (req, res) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      error: 'Officer access required'
    });
  }

  const data = db();

  const completed = data.tokens.filter(t => t.status === 'done').length;
  const waiting = data.tokens.filter(t => t.status === 'waiting').length;
  const served = data.tokens.filter(t =>
    ['done', 'serving'].includes(t.status)
  ).length;

  res.json({
    kpis: {
      todayTokens: data.tokens.length,
      waiting,
      completed,
      activeWorkers: data.workers.filter(w => w.on).length,
      serviceRate: Math.min(
        100,
        Math.round(served / Math.max(1, data.tokens.length) * 100)
      )
    },
    hourly: [
      { hour: '10 AM', tokens: 4 },
      { hour: '11 AM', tokens: 7 },
      { hour: '12 PM', tokens: 9 },
      { hour: '1 PM', tokens: 6 },
      { hour: '2 PM', tokens: 3 }
    ],
    services: [
      { name: 'Aadhaar', value: 32 },
      { name: 'PAN', value: 24 },
      { name: 'Birth', value: 18 },
      { name: 'Property', value: 14 },
      { name: 'Certificates', value: 12 }
    ]
  });
});

// Test notification
app.post('/api/notifications/test', auth, (req, res) => {
  const data = db();

  data.notifications.unshift({
    id: crypto.randomUUID(),
    userId: req.user.id,
    title: 'QueueLess smart reminder',
    message: req.body?.message ||
      'Your turn is approaching. Please start travelling to the office.',
    time: Date.now(),
    read: false
  });

  save(data);

  res.json({ ok: true });
});

// Serve frontend static files when available
app.use(express.static(path.join(__dirname, '..', 'dist')));

// Vercel imports this Express app as a serverless function.
// Run a persistent listener only during local development.
if (!process.env.VERCEL) {
  app.listen(process.env.PORT || 4000, () => {
    console.log(
      `QueueLess API running on http://localhost:${process.env.PORT || 4000}`
    );
  });
}

export default app;
