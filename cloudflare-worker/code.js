// Cloudflare Worker - EOD API Handlers

// Example database connection (mock)
const db = require('./db');
const { logAudit } = require('./audit');

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const url = new URL(request.url);
  const method = request.method;

  if (url.pathname.startsWith('/endofday/record')) {
    if (method === 'GET') {
      return await fetchEodRecord(url.searchParams);
    } else if (method === 'POST') {
      return await createEodRecord(request);
    }
  }

  if (url.pathname.startsWith('/endofday/contacts')) {
    if (method === 'GET') {
      return await listContacts();
    } else if (method === 'POST') {
      return await createContact(request);
    }
    const contactId = url.pathname.split('/').pop();
    if (method === 'PUT') {
      return await updateContact(contactId, request);
    } else if (method === 'DELETE') {
      return await deleteContact(contactId);
    }
  }

  return new Response('Endpoint not found', { status: 404 });
}

async function fetchEodRecord(params) {
  const date = params.get('date');
  const record = await db.getEodRecord(date);
  logAudit('Fetched EOD record', { date });
  return new Response(JSON.stringify(record), { status: 200, headers: { 'Content-Type': 'application/json' }});
}

async function createEodRecord(request) {
  const data = await request.json();
  const result = await db.createEodRecord(data);
  logAudit('Created EOD record', result);
  return new Response('EOD record created', { status: 201 });
}

async function listContacts() {
  const contacts = await db.getContacts();
  logAudit('Listed contacts');
  return new Response(JSON.stringify(contacts), { status: 200, headers: { 'Content-Type': 'application/json' }});
}

async function createContact(request) {
  const data = await request.json();
  const result = await db.createContact(data);
  logAudit('Created contact', result);
  return new Response('Contact created', { status: 201 });
}

async function updateContact(id, request) {
  const data = await request.json();
  const result = await db.updateContact(id, data);
  logAudit('Updated contact', { id });
  return new Response('Contact updated', { status: 200 });
}

async function deleteContact(id) {
  await db.deleteContact(id);
  logAudit('Deleted contact', { id });
  return new Response('Contact deleted', { status: 204 });
}
