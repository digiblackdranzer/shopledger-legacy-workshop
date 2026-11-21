var test = require('node:test');
var assert = require('node:assert/strict');
var pricing = require('../lib/pricing');
var invoice = require('../lib/invoice');
var reports = require('../lib/reports');

function makeOrder(overrides) {
  return Object.assign({
    id: 7001,
    date: '21/11/2026',
    customer: 'Characterization Customer',
    paymentMode: 'cash',
    status: 'completed',
    coupon: 'WELCOME',
    items: [{ id: 1, name: 'Rice', sku: 'RICE-1', hsn: '1006', price: 1000, qty: 1 }],
    subtotal: 1000,
    discount: 50,
    tax: 47.5,
    total: 997.5
  }, overrides || {});
}

test('invoice figures match the customer-billed pricing totals for HSN items and a coupon', function () {
  var items = [
    { id: 1, name: 'Rice', sku: 'RICE-1', hsn: '1006', price: 1000, qty: 1 },
    { id: 2, name: 'Tea', sku: 'TEA-1', hsn: '0902', price: 200, qty: 1 }
  ];
  var billed = pricing.computeTotals(items, 'WELCOME');
  var order = makeOrder({
    coupon: 'WELCOME',
    items: items,
    subtotal: billed.subtotal,
    discount: billed.discount,
    tax: billed.tax,
    total: billed.total
  });
  var invoiceFigures = invoice.computeInvoiceFigures(order);

  assert.equal(invoiceFigures.subtotal, billed.subtotal);
  assert.equal(invoiceFigures.discount, billed.discount);
  assert.equal(invoiceFigures.tax, billed.tax);
  assert.equal(invoiceFigures.total, billed.total);
  assert.deepEqual(invoiceFigures.rows.map(function (row) { return row.gstPercent; }), [5, 18]);
  assert.equal(invoiceFigures.cgst + invoiceFigures.sgst, billed.tax);
});

test('order pricing uses HSN GST and discounts before GST', function () {
  var item = { id: 1, name: 'Rice', hsn: '1006', price: 1000, qty: 1 };
  var orderTotals = pricing.computeTotals([item], 'WELCOME');

  assert.equal(orderTotals.subtotal, 1000);
  assert.equal(orderTotals.discount, 50);
  assert.equal(orderTotals.tax, 47.5);
  assert.equal(orderTotals.cgst, 23.75);
  assert.equal(orderTotals.sgst, 23.75);
  assert.equal(orderTotals.total, 997.5);
});

test('invoice figures use the same HSN GST and discount-before-tax calculation as billing', function () {
  var item = { id: 1, name: 'Rice', hsn: '1006', price: 1000, qty: 1 };
  var invoiceFigures = invoice.computeInvoiceFigures(makeOrder());

  assert.equal(invoiceFigures.subtotal, 1000);
  assert.equal(invoiceFigures.rows[0].gstPercent, 5);
  assert.equal(invoiceFigures.tax, 47.5);
  assert.equal(invoiceFigures.cgst, 23.75);
  assert.equal(invoiceFigures.sgst, 23.75);
  assert.equal(invoiceFigures.discount, 50);
  assert.equal(invoiceFigures.total, 997.5);
  assert.equal(pricing.computeTotals([item], 'WELCOME').total, 997.5);
});

test('invoice honors the configured coupon minimum subtotal', function () {
  var order = makeOrder({
    coupon: 'SAVE10',
    items: [{ id: 1, name: 'Rice', hsn: '1006', price: 100, qty: 1 }],
    subtotal: 100,
    discount: 0,
    tax: 5,
    total: 105
  });
  var invoiceFigures = invoice.computeInvoiceFigures(order);

  assert.equal(invoiceFigures.subtotal, 100);
  assert.equal(invoiceFigures.discount, 0);
  assert.equal(invoiceFigures.rows[0].gstPercent, 5);
  assert.equal(invoiceFigures.total, 105);
});

test('invoice honors the configured SAVE10 discount cap', function () {
  var items = [{ id: 1, name: 'Rice', hsn: '1006', price: 2000, qty: 1 }];
  var order = makeOrder({
    coupon: 'SAVE10',
    items: items,
    subtotal: 2000,
    discount: 150,
    tax: 92.5,
    total: 1942.5
  });
  var ledgerTotals = pricing.computeTotals(items, 'SAVE10');
  var invoiceFigures = invoice.computeInvoiceFigures(order);

  assert.equal(ledgerTotals.discount, 150);
  assert.equal(invoiceFigures.tax, 92.5);
  assert.equal(invoiceFigures.discount, 150);
  assert.equal(invoiceFigures.rows[0].gstPercent, 5);
  assert.equal(invoiceFigures.total, 1942.5);
});

test('invoice rendering omits the reconciliation notice when billed totals match', function () {
  var html = invoice.render(makeOrder());

  assert.doesNotMatch(html, /Accountant Reconciliation Notice/);
  assert.match(html, /Invoice Total<\/td><td class="r">₹997\.50/);
});

test('reconciliation marks billed active orders as matched and omits cancelled orders', function () {
  var activeOrder = makeOrder();
  var cancelledOrder = makeOrder({ id: 7002, status: 'cancelled' });
  var result = reports.getGstReconciliation({ orders: [activeOrder, cancelledOrder] });

  assert.equal(result.totalChecked, 1);
  assert.equal(result.mismatchCount, 0);
  assert.equal(result.rows[0].orderId, 7001);
  assert.equal(result.rows[0].ledgerTotal, 997.5);
  assert.equal(result.rows[0].invoiceTotal, 997.5);
  assert.equal(result.rows[0].delta, 0);
  assert.equal(result.rows[0].matched, true);
});
