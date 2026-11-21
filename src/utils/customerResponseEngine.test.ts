import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInventoryContextPayload,
  filterCustomerInquiries,
  validateInquiryInput,
} from './customerResponseEngine';
import {
  createSeedCustomerInquiries,
  createSeedProducts,
  createSeedPurchaseOrders,
  createSeedSuppliers,
  createSeedTransactions,
} from '../data/seedData';

test('filterCustomerInquiries filters by status and search text', () => {
  const inquiries = createSeedCustomerInquiries();
  const openOnly = filterCustomerInquiries(inquiries, '', 'Open');
  assert.equal(openOnly.length, 3);
  assert.ok(openOnly.every((i) => i.status === 'Open'));

  const matchaSearch = filterCustomerInquiries(inquiries, 'matcha', 'all');
  assert.equal(matchaSearch.length, 1);
  assert.equal(matchaSearch[0].customerName, 'Owen Gallagher');
});

test('validateInquiryInput checks required fields and email format', () => {
  const invalid = validateInquiryInput({
    customerName: '',
    customerEmail: 'bad-email',
    subject: '',
    message: '',
  });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.customerName);
  assert.ok(invalid.errors.customerEmail);
  assert.ok(invalid.errors.subject);
  assert.ok(invalid.errors.message);

  const valid = validateInquiryInput({
    customerName: 'Sam Lee',
    customerEmail: 'sam@example.com',
    subject: 'Stock check',
    message: 'Are bags available?',
  });
  assert.equal(valid.valid, true);
});

test('buildInventoryContextPayload packages live metrics, products, and open POs', () => {
  const products = createSeedProducts();
  const suppliers = createSeedSuppliers();
  const transactions = createSeedTransactions();
  const pos = createSeedPurchaseOrders();

  const ctx = buildInventoryContextPayload(products, suppliers, transactions, pos);
  assert.equal(ctx.products.length, products.length);
  assert.equal(ctx.openPurchaseOrders.length, 3);
  assert.ok(ctx.summaryMetrics.inventoryCostValue > 0);
});
