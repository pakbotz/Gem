import http from 'node:http';

const port = Number(process.env.PORT ?? 8000);
const field = (value, source, page = 1) => ({
  value,
  page_number: page,
  source_text: source,
  review_reason: null,
});

const demoResult = {
  demo_mode: true,
  requires_review: true,
  documents: [{
    source_file: 'DEMO RESPONSE — sample itemized bill',
    source_index: 1,
    pages: [{
      page_number: 1,
      text: 'SAMPLE MEDICAL CENTER\nOffice visit\nDate of service: 2026-10-14\nCPT 99213\nTotal charges: $1,055.00\nPatient responsibility: $211.00',
    }],
    provider_name: field('Sample Medical Center', 'SAMPLE MEDICAL CENTER'),
    total_billed: field('1055.00', 'Total charges: $1,055.00'),
    total_adjustments: field(null, null),
    patient_responsibility: field('211.00', 'Patient responsibility: $211.00'),
    currency: field('USD', 'SAMPLE BILL — USD'),
    line_items: [{
      service_date: field('2026-10-14', 'Date of service: 2026-10-14'),
      code: field('99213', 'CPT 99213'),
      description: field('Office visit', 'Office visit'),
      charged_amount: field('1055.00', 'Total charges: $1,055.00'),
      adjustments: field(null, null),
      patient_responsibility: field('211.00', 'Patient responsibility: $211.00'),
    }],
    review_notes: ['Demo-only values. They were not extracted from your selected document. No Medicare comparison was performed.'],
  }],
};

const server = http.createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*');
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  if (request.method !== 'POST' || request.url !== '/ocr') {
    response.writeHead(404).end('Not found');
    return;
  }

  // Consume the request without storing or parsing the selected document.
  request.resume();
  request.on('end', () => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(demoResult));
  });
});

server.listen(port, '0.0.0.0', () => {
  console.log(`BillBacked demo API listening on http://0.0.0.0:${port}/ocr`);
  console.log('Demo response only: uploaded document bytes are ignored and not stored.');
});
