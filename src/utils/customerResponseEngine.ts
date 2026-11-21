import {
  CustomerInquiry,
  CustomerInquiryStatus,
  Product,
  PurchaseOrder,
  StockTransaction,
  Supplier,
} from '../types/inventory';
import { computeDashboardMetrics, getStockStatus } from './inventoryEngine';

export function filterCustomerInquiries(
  inquiries: CustomerInquiry[],
  search: string,
  status: 'all' | CustomerInquiryStatus
): CustomerInquiry[] {
  const q = search.trim().toLowerCase();
  return inquiries.filter((inq) => {
    if (status !== 'all' && inq.status !== status) return false;
    if (q) {
      const matchName = inq.customerName.toLowerCase().includes(q);
      const matchEmail = inq.customerEmail.toLowerCase().includes(q);
      const matchSubject = inq.subject.toLowerCase().includes(q);
      const matchOrder = (inq.orderRef ?? '').toLowerCase().includes(q);
      if (!matchName && !matchEmail && !matchSubject && !matchOrder) return false;
    }
    return true;
  });
}

export function validateInquiryInput(input: {
  customerName: string;
  customerEmail: string;
  subject: string;
  message: string;
}): { valid: boolean; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  if (!input.customerName.trim()) errors.customerName = 'Customer name is required.';
  if (!input.customerEmail.trim() || !input.customerEmail.includes('@')) {
    errors.customerEmail = 'Valid customer email is required.';
  }
  if (!input.subject.trim()) errors.subject = 'Subject is required.';
  if (!input.message.trim()) errors.message = 'Customer message is required.';

  return {
    valid: Object.keys(errors).length === 0,
    errors,
  };
}

export function buildInventoryContextPayload(
  products: Product[],
  suppliers: Supplier[],
  transactions: StockTransaction[],
  purchaseOrders: PurchaseOrder[]
) {
  const metrics = computeDashboardMetrics(products, purchaseOrders);
  return {
    summaryMetrics: {
      totalProducts: metrics.totalProducts,
      totalStockUnits: metrics.totalStockUnits,
      inventoryCostValue: Number(metrics.inventoryValue.toFixed(2)),
      lowStockCount: metrics.lowStockCount,
      outOfStockCount: metrics.outOfStockCount,
      pendingPurchaseOrders: metrics.pendingPoCount,
    },
    products: products.map((p) => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      category: p.category,
      quantity: p.quantity,
      reorderPoint: p.reorderPoint,
      status: getStockStatus(p.quantity, p.reorderPoint),
      unitCost: p.unitCost,
      sellingPrice: p.sellingPrice,
      supplierName: suppliers.find((s) => s.id === p.supplierId)?.companyName ?? 'Unassigned',
    })),
    openPurchaseOrders: purchaseOrders
      .filter((po) => po.status !== 'Received')
      .map((po) => ({
        poNumber: po.poNumber,
        productId: po.productId,
        productName: po.productName,
        quantity: po.quantity,
        expectedDate: po.expectedDate,
        status: po.status,
        supplierName: po.supplierName,
      })),
    suppliers: suppliers.map((s) => ({
      id: s.id,
      companyName: s.companyName,
      deliveryStatus: s.deliveryStatus,
      leadTimeDays: s.leadTimeDays,
    })),
    recentTransactions: transactions.slice(0, 10).map((t) => ({
      date: t.date,
      productName: t.productName,
      type: t.type,
      quantityChange: t.quantityChange,
      counterparty: t.counterparty,
    })),
  };
}
