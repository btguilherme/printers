const assert = require('assert');
const LabelPrinter = require('../js/label-printer.js');

console.log('--- Starting LabelPrinter Unit Tests ---');

// Test 1: Check available generators
const generators = LabelPrinter.generators;
assert.ok(generators.zebra, 'Zebra generator exists');
assert.ok(generators.elgin, 'Elgin generator exists');
assert.ok(generators.argox, 'Argox generator exists');
assert.ok(generators.godex, 'GoDEX generator exists');
assert.ok(generators.hprt, 'HPRT generator exists');
console.log('✓ Generators present for Zebra, Elgin, Argox, GoDEX, and HPRT');

// Test 2: Zebra ZPL generation
const zebraZpl = generators.zebra.generateLabel({
  title: 'TEST ITEM',
  barcode: '123456789',
  qrCode: 'https://test.com',
  details: ['PRICE: $10', 'SKU: 001']
});
assert.ok(zebraZpl.includes('^XA'), 'ZPL starts with ^XA');
assert.ok(zebraZpl.includes('TEST ITEM'), 'ZPL contains title');
assert.ok(zebraZpl.includes('123456789'), 'ZPL contains barcode');
assert.ok(zebraZpl.includes('^XZ'), 'ZPL ends with ^XZ');
console.log('✓ Zebra ZPL generator formatted correctly');

// Test 3: Elgin TSPL generation
const elginTspl = generators.elgin.generateLabel({
  title: 'ELGIN ITEM',
  barcode: '78910',
  qrCode: 'https://elgin.com',
  details: ['LOTE: 123']
});
assert.ok(elginTspl.includes('SIZE 100 mm, 50 mm'), 'TSPL includes size');
assert.ok(elginTspl.includes('ELGIN ITEM'), 'TSPL contains title');
assert.ok(elginTspl.includes('PRINT 1,1'), 'TSPL ends with print command');
console.log('✓ Elgin TSPL generator formatted correctly');

// Test 4: LocalAgentTransport instantiation and format
const agentTransport = new LabelPrinter.transports.LocalAgent({ printerName: 'Zebra_GK420t' });
assert.strictEqual(agentTransport.printerName, 'Zebra_GK420t');
assert.ok(agentTransport.name.includes('Zebra_GK420t'), 'Transport name includes printer name');
console.log('✓ LocalAgentTransport instantiated correctly');

// Test 5: Mock transport print execution
let sentPayload = null;
class MockTransport {
  async send(data) {
    sentPayload = data;
  }
}

const mockPrinter = new LabelPrinter(new MockTransport());
mockPrinter.print('TEST RAW DATA').then(() => {
  assert.strictEqual(sentPayload, 'TEST RAW DATA', 'Data sent through transport matches');
  console.log('✓ LabelPrinter transport send abstraction verified');
  console.log('\nAll tests passed successfully! 🎉');
}).catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
